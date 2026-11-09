import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, BuiltinToolResults, On, TurnUsage } from 'claude-code'
import { MAX_RUNS, NO_LEDGER, withAgent } from '../hooks/model'
import { cellsOf } from '../hooks/view'
import type { AgentLedger } from '../types'
import { ANSWERED, engine, has, K, PANE, READ_RESULT, SPAWN, start, SURFACES, test } from './helpers'
import type { Found } from './helpers'

// The Agents tab by workflow run (version 1.1): a run's agents carry its
// `workflow.runId` from their spawn, its name comes from the Workflow tool's
// result. Each run agent's first turn here carries its prompt as is, as with
// the harness's frame turned off (CLAUDE_CODE_WORKFLOW_PROMPT_PROVENANCE):
// agents.test.tsx proves the framed turn names the same spawn.

/** A model request's usage: `read` tokens read from the cache, nothing else. */
const usageOf = (read: number): TurnUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: 0,
  model: 'claude-opus-5-5',
})

/** One model request of a loop, read to its end. */
async function step($: Engine, loop: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 3, agentId: loop })
  let read = await stream.next()
  while (read.done !== true) read = await stream.next()
}

type Ending = 'answer' | 'error' | 'aborted'

/**
 * A session the tests start runs and agents in: each loop's request reads
 * `tokens[id]` (1k where none is given); the Workflow tool answers each call
 * with the run `launch` named; the agent list names the Agent tool's agents.
 */
async function session($: Engine, on: On, tokens: Readonly<Record<string, number>> = {}) {
  const world = { agents: [] as AgentInfo[] }
  const clock = engine(on, world)
  // A spawn's answer is never read; an Agent tool's agent is named by the list.
  on('agent.spawn', (_, e) => ({ model: 'm', agentId: world.agents.find(one => one.description === e.description)?.id ?? 'unread' }))
  const launched: BuiltinToolResults['Workflow'][] = []
  on('tool.call', (_, e) => (e.tool === 'Workflow' ? { result: launched.shift() } : READ_RESULT))
  on('turn.step', async function* (_, e) {
    yield { kind: 'text' as const, index: 0, text: 'not kept' }
    return { turnId: e.turnId, index: e.index, answer: 'not kept', toolUses: [], stopReason: 'end_turn' as const, usage: usageOf(tokens[e.agentId ?? ''] ?? K) }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.view', () => ({ value: {} }))
  /** When each agent's turn started: its turn lasts until it ends, as the clock says. */
  const started = new Map<string, number>()
  await start($)
  return {
    clock,
    /**
     * The Workflow tool starting a run: its result in the shape Claude Code
     * 2.1.319 answered (live check 2026-11-08), its ids and paths free values.
     */
    launch: async (runId: string, workflowName: string) => {
      launched.push({
        status: 'async_launched',
        taskId: `task-${runId}`,
        taskType: 'local_workflow',
        workflowName,
        runId,
        summary: 'a test run',
        transcriptDir: '/proj/transcripts',
        scriptPath: '/proj/run.js',
      })
      await $.tool.call({ tool: 'Workflow', scriptPath: '/proj/run.js' })
    },
    /** A run's agent: the script's agent() spawning it, its first turn, one request. */
    runAgent: async (runId: string, id: string, description: string, agentIndex = 1) => {
      const prompt = `the task of ${id}`
      await $.agent.spawn({ ...SPAWN, prompt, description, subagentType: 'workflow-subagent', workflow: { runId, agentIndex } })
      started.set(id, clock.now())
      await $.turn.start({ text: prompt, turnId: id, agentId: id })
      await step($, id)
    },
    /** An Agent tool's subagent, listed while it runs: of no run. */
    toolAgent: async (id: string, description: string) => {
      world.agents = [...world.agents, { id, description, type: 'general-purpose', status: 'running' }]
      await $.agent.spawn({ ...SPAWN, description })
      started.set(id, clock.now())
      await $.turn.start({ text: '', turnId: id, agentId: id })
      await step($, id)
    },
    /** An agent's turn ending: done, failed or stopped. */
    finish: async (id: string, reason: Ending = 'answer') => {
      const status = reason === 'answer' ? 'completed' : reason === 'error' ? 'failed' : 'killed'
      world.agents = world.agents.map(one => (one.id === id ? { ...one, status } : one))
      const durationMs = clock.now() - (started.get(id) ?? clock.now())
      await $.turn.complete({ turnId: id, agentId: id, durationMs, ...ANSWERED, isAborted: reason === 'aborted', reason })
    },
  }
}

type Session = Awaited<ReturnType<typeof session>>

/** The agents of the mass run: m1 to m45, each having processed its number in thousands (ok:7 7k), so a figure tells its line. */
const MASS_TOKENS: Readonly<Record<string, number>> = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`m${i + 1}`, (i + 1) * K]))

/**
 * The run of the user's live check (2026-11-09), `nox-test-masse`: 45
 * agents, ok:1 to ok:45, each `agentIndex` the number in its name; their
 * loops start in another order, the even ones first, as siblings held for
 * their leader's first answer do. All finished 30 s later.
 */
async function massRun(s: Session) {
  await s.launch('wf_m', 'nox-test-masse')
  const evens = Array.from({ length: 22 }, (_, i) => 2 * (i + 1))
  const odds = Array.from({ length: 23 }, (_, i) => 2 * i + 1)
  for (const i of [...evens, ...odds]) {
    await s.runAgent('wf_m', `m${i}`, `ok:${i}`, i)
    await s.clock.advance(100)
  }
  await s.clock.advance(30_000)
  for (const i of [...evens, ...odds]) await s.finish(`m${i}`)
}

/** ok:1 to ok:n, as their lines name them. */
const okNames = (n: number) => Array.from({ length: n }, (_, i) => `ok:${i + 1}`)

/** The pane on the Agents tab, docked, wide and tall enough for the full card unless told otherwise. */
async function agentsTab($: Engine, surface: (typeof SURFACES)[number], columns = 90, rows = 80) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: rows } }, surface })
  await ui.press({ key: 'tab-agents' })
  return ui
}

type Mounted = { findAll: (q: { type: string }) => Promise<(Found & { key?: string })[]> }

/** The tab's rows: each Button's key and text (the tabs aside), and each line counting what has no line of its own. */
const drawnRows = async (ui: Mounted) => [
  ...(await ui.findAll({ type: 'Button' })).filter(found => !found.key?.startsWith('tab-')).map(found => [found.key ?? '', found.text.trimEnd()] as const),
  ...(await ui.findAll({ type: 'Text' })).filter(found => /^\+\d+ [◉✓]$/.test(found.text)).map(found => ['', found.text] as const),
]

const rowsOf = async (ui: Mounted) => Object.fromEntries(await drawnRows(ui))

/** The line a run's head or the older line stands in, no press acts on: found by its words. */
const lineOf = async (ui: Mounted, pattern: RegExp) => (await ui.findAll({ type: 'Text' })).find(found => found.props.wrap !== undefined && pattern.test(found.text))?.text.trimEnd()

// ---------------------------------------------------------------- painting the inline pane

// The pane inline above the prompt, laid out as the terminal does for the
// layouts this view uses (as in inline.test.tsx): the engine's frame takes 4
// columns around the body.
const FRAME_COLUMNS = 4

const inline = (terminal: number, rows: number) => ({
  ...PANE,
  props: { ...PANE.props, placement: 'inline' as const, bodyColumns: terminal - FRAME_COLUMNS, scroll: { offset: 0, bodyRows: rows } },
  viewport: { columns: terminal, rows: 40, isFullscreen: true },
})

type Node = string | { type: string; props?: Record<string, unknown>; children?: readonly Node[] }
type Block = { rows: string[]; width: number }
const propsOf = (node: Node) => (typeof node === 'string' ? {} : (node.props ?? {}))
const numberOf = (value: unknown) => (typeof value === 'number' ? value : 0)
const textOf = (node: Node): string => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''))
const paddedTo = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - cellsOf(text)))

function drawRow(children: readonly Node[], room: number, props: Record<string, unknown>): Block {
  const leftOf = (kid: Node) => numberOf(propsOf(kid).marginLeft)
  const taken = children.filter(kid => propsOf(kid).flexGrow === undefined).reduce((sum, kid) => sum + leftOf(kid) + draw(kid, room).width, 0)
  const blocks = children.map(kid => {
    const isGrowing = propsOf(kid).flexGrow !== undefined
    const drawn = draw(kid, isGrowing ? Math.max(1, room - taken) : room)
    return { rows: drawn.rows, left: leftOf(kid), width: isGrowing ? Math.max(drawn.width, room - taken) : drawn.width }
  })
  const used = blocks.reduce((sum, block) => sum + block.left + block.width, 0)
  const between = props.justifyContent === 'space-between' ? Math.max(0, room - used) : 0
  const height = Math.max(0, ...blocks.map(block => block.rows.length))
  const rows = Array.from({ length: height }, (_, row) =>
    blocks.map((block, i) => ' '.repeat(block.left + (i === 0 ? 0 : between)) + paddedTo(block.rows[row] ?? '', block.width)).join(''),
  )
  return { rows, width: Math.max(0, ...rows.map(cellsOf)) }
}

function draw(node: Node, room: number): Block {
  if (typeof node === 'string') return { rows: [node], width: cellsOf(node) }
  const props = propsOf(node)
  const children = node.children ?? []
  if (node.type === 'Text') return { rows: [textOf(node)], width: cellsOf(textOf(node)) }
  if (node.type === 'Image') return { rows: Array<string>(numberOf(props.rows)).fill(' '.repeat(numberOf(props.columns))), width: numberOf(props.columns) }
  if (node.type === 'Button') return drawRow(children, room, {})
  const inset = numberOf(props.paddingX)
  const width = typeof props.width === 'number' ? props.width : room
  const inner = width - 2 * inset
  const body: Block =
    props.flexDirection === 'column'
      ? { rows: children.flatMap(kid => draw(kid, inner).rows), width: Math.max(0, ...children.map(kid => draw(kid, inner).width)) }
      : drawRow(children, inner, props)
  return { rows: body.rows.map(row => ' '.repeat(inset) + row), width: typeof props.width === 'number' ? props.width : body.width + 2 * inset }
}

/** The Agents tab inline in a terminal of `terminal` columns, `rows` rows of body, after a press on `press` where one is given: its rows as drawn. */
async function inlineRows($: Engine, terminal: number, rows: number, press?: string): Promise<string[]> {
  const ui = await $.ui.mount({ ...inline(terminal, rows), surface: 'terminal' })
  await ui.press({ key: 'tab-agents' })
  if (press !== undefined) await ui.press({ key: press })
  const drawn = draw((await ui.drawn()) as Node, terminal - FRAME_COLUMNS).rows.map(row => row.replaceAll(' ', ' ').trimEnd())
  for (const row of drawn) expect(`${cellsOf(row) <= terminal - FRAME_COLUMNS} ${row}`).toBe(`true ${row}`)
  await ui.unmount()
  return drawn
}

describe('Agents by workflow run', () => {
  test('a line per run, by its runId, named by the Workflow tool\'s result: its agents, what they processed, how long; two runs of one workflow are two lines; closed until opened', async ($, on) => {
    const s = await session($, on, { a1: 10 * K, a2: 20 * K, b1: 40 * K, c1: 4 * K, c2: 6 * K, x1: 7 * K })
    await s.launch('wf_a', 'review-changes')
    await s.runAgent('wf_a', 'a1', 'review:bugs', 1)
    await s.runAgent('wf_a', 'a2', 'verify:model.ts', 2)
    await s.clock.advance(60_000)
    await s.finish('a1')
    await s.finish('a2')
    await s.launch('wf_b', 'explore-api')
    await s.runAgent('wf_b', 'b1', 'explore:routes')
    await s.clock.advance(30_000)
    await s.finish('b1')
    await s.launch('wf_c', 'review-changes')
    await s.runAgent('wf_c', 'c1', 'review:bugs', 1)
    await s.runAgent('wf_c', 'c2', 'verify:model.ts', 2)
    await s.clock.advance(10_000)
    await s.finish('c1')
    await s.finish('c2')
    // A run whose Workflow call noxdeck did not hear: by its id.
    await s.runAgent('wf_x', 'x1', 'scan:all')
    await s.clock.advance(5_000)
    await s.finish('x1')
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      // The newest first, a line each, closed; no agent of theirs shows.
      expect((await drawnRows(ui)).map(([key]) => key).filter(key => key.startsWith('group-run:'))).toEqual([
        'group-run:wf_x',
        'group-run:wf_c',
        'group-run:wf_b',
        'group-run:wf_a',
      ])
      const lines = await rowsOf(ui)
      expect(lines['group-run:wf_a']).toMatch(/^✓ ▸ review-changes ×2 +30k +1:00$/)
      expect(lines['group-run:wf_c']).toMatch(/^✓ ▸ review-changes ×2 +10k +0:10$/)
      expect(lines['group-run:wf_b']).toMatch(/^✓ ▸ explore-api ×1 +40k +0:30$/)
      expect(lines['group-run:wf_x']).toMatch(/^✓ ▸ Workflow wf_x ×1 +7k +0:05$/)
      for (const id of ['a1', 'a2', 'b1', 'c1', 'c2', 'x1']) expect(lines[id]).toBeUndefined()
      // Opened: its agents under it by their whole names; the other runs stay closed.
      await ui.press({ key: 'group-run:wf_a' })
      const opened = await rowsOf(ui)
      expect(opened['group-run:wf_a']).toMatch(/^✓ ▾ review-changes ×2 /)
      expect(opened.a1).toMatch(/^ {4}review:bugs +▆+ +10k +1:00$/)
      expect(opened.a2).toMatch(/^ {4}verify:model\.ts +▆+ +20k +1:00$/)
      expect(opened.c1).toBeUndefined()
      await ui.press({ key: 'group-run:wf_a' })
      // A bar per run in the timeline, by its name.
      const texts = await ui.findAll({ type: 'Text' })
      for (const name of ['review-changes', 'explore-api', 'Workflow wf_x']) expect(has(texts, new RegExp(`^${name} *$`))).toBe(true)
      await ui.unmount()
      // The compact view (8 rows; the desktop's frame takes one more): a line each, its time and what it processed; the older line, wf_a's 30k and wf_b's 40k.
      const short = await agentsTab($, surface, 90, surface === 'terminal' ? 8 : 9)
      expect(await drawnRows(short)).toEqual([
        ['group-run:wf_x', '✓ ▸ Workflow wf_x ×1 0:05 · 7k'],
        ['group-run:wf_c', '✓ ▸ review-changes ×2 0:10 · 10k'],
      ])
      expect(await lineOf(short, /ältere/)).toBe('+2 ältere Läufe · 70k')
      await short.unmount()
    }
  })

  test('a running run: its head with no fold, every running agent by its whole name and what it does, its finished ones in a line the person opens', async ($, on) => {
    const s = await session($, on, { r1: 10 * K, r2: 20 * K, r3: 5 * K })
    await s.launch('wf_r', 'audit-i18n')
    await s.runAgent('wf_r', 'r3', 'audit:done', 1)
    await s.finish('r3')
    await s.runAgent('wf_r', 'r1', 'audit:de', 2)
    await s.runAgent('wf_r', 'r2', 'audit:en', 3)
    await $.tool.call({ tool: 'Read', file_path: '/proj/strings.ts', agentId: 'r1' })
    await s.clock.advance(20_000)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      const texts = await ui.findAll({ type: 'Text' })
      // Its head on the accent, bold, all three counted; no fold to press.
      expect(texts.some(found => found.text === '◉ audit-i18n ×3' && found.props.backgroundColor === 'claude' && found.props.bold === true)).toBe(true)
      expect(await ui.find({ type: 'Button', key: 'group-run:wf_r' })).toBeUndefined()
      const lines = await rowsOf(ui)
      expect(lines.r1).toMatch(/^ {2}◉ audit:de +10k +0:20$/)
      expect(lines.r2).toMatch(/^ {2}◉ audit:en +20k +0:20$/)
      expect(has(texts, /^ {4}→ Read strings\.ts · vor 20 s$/)).toBe(true)
      // Its finished agent in a line under them, closed: what it processed, from its start to its end.
      expect(lines['group-done:wf_r']).toMatch(/^ {2}✓ ▸ 1 fertig +5k +0:00$/)
      expect(lines.r3).toBeUndefined()
      await ui.press({ key: 'group-done:wf_r' })
      expect((await rowsOf(ui)).r3).toMatch(/^ {6}audit:done /)
      await ui.press({ key: 'group-done:wf_r' })
      await ui.unmount()
      // The compact view: its head, its running agents with their calls, its finished ones' line.
      const short = await agentsTab($, surface, 48, 12)
      expect(await lineOf(short, /×3/)).toBe('◉ audit-i18n ×3 0:20 · 35k')
      const compact = await rowsOf(short)
      expect(compact.r1).toBe('  ◉ audit:de 0:20 · 10k → Read strings.ts')
      expect(compact.r2).toBe('  ◉ audit:en 0:20 · 20k')
      expect(compact['group-done:wf_r']).toBe('  ✓ ▸ 1 fertig 5k')
      await short.unmount()
    }
  })

  test('the head counts every agent since load, those past the list\'s 50 too, by how they ended; a run\'s line keeps its count and tokens, opened it says how many left the list', async ($, on) => {
    const ledgers: AgentLedger[] = []
    on('state.set', { plugin: 'noxdeck' }, (_, e, next) => {
      if (e.key === 'agentLedger') ledgers.push((e.value as { value: AgentLedger }).value)
      return next(e)
    })
    const s = await session($, on)
    await s.launch('wf_big', 'bulk')
    // Sixty agents, one after the other; the first failed, so did the second, the third was stopped.
    for (let i = 0; i < 60; i += 1) {
      await s.runAgent('wf_big', `b${i}`, `bulk:f${i}`, i + 1)
      await s.finish(`b${i}`, i < 2 ? 'error' : i === 2 ? 'aborted' : 'answer')
    }
    await s.clock.advance(1000)
    // The ten oldest left the list: counted by how they ended, in all and in their run.
    const ledger = ledgers.at(-1) ?? NO_LEDGER
    expect(ledger.gone).toEqual({ completed: 7, failed: 2, killed: 1, ended: 0 })
    expect(ledger.goneLoose).toBe(0)
    expect(ledger.runs.map(run => [run.id, run.name, run.agents, run.past.ended])).toEqual([['wf_big', 'bulk', 60, { completed: 7, failed: 2, killed: 1, ended: 0 }]])
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      expect(has(await ui.findAll({ type: 'Text' }), /^ ?57 fertig · 2 fehlgeschlagen · 1 abgebrochen ?$/)).toBe(true)
      // Its line: all sixty, their tokens, the failed and the stopped in the accent's glyphs.
      expect((await rowsOf(ui))['group-run:wf_big']).toMatch(/^✗ ▸ bulk ×60 · 2 ✗ · 1 ■ +60k /)
      await ui.press({ key: 'group-run:wf_big' })
      const opened = await rowsOf(ui)
      expect(Object.keys(opened).filter(key => /^b\d+$/.test(key))).toHaveLength(50)
      expect(opened.b9).toBeUndefined()
      expect(opened.b10).toMatch(/^ {4}bulk:f10 /)
      expect(has(await ui.findAll({ type: 'Text' }), /^ {4}\+10 nicht mehr in der Liste$/)).toBe(true)
      await ui.press({ key: 'group-run:wf_big' })
      await ui.unmount()
      const short = await agentsTab($, surface, 90, surface === 'terminal' ? 8 : 9)
      expect(has(await short.findAll({ type: 'Text' }), /^ 57 ✓ · 2 ✗ · 1 ■ · verarbeitet 60k$/)).toBe(true)
      await short.unmount()
    }
  })

  test('the head counts the Agent tool\'s agents past the 50 too, and the agents that left with no run are the older line\'s', async ($, on) => {
    const s = await session($, on)
    for (let i = 0; i < 55; i += 1) {
      await s.toolAgent(`t${i}`, `task ${i}`)
      await s.finish(`t${i}`)
    }
    await s.clock.advance(1000)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface, 90, 200)
      expect(has(await ui.findAll({ type: 'Text' }), /^ ?55 fertig ?$/)).toBe(true)
      expect(await lineOf(ui, /ältere/)).toBe('+5 ältere Agents · 5k')
      await ui.unmount()
    }
  })

  test('the older line: in the compact view the runs that do not fit leave it the oldest first, counted with the agents of no run that left and what they all processed', async ($, on) => {
    const s = await session($, on, { p1: 3 * K, ...Object.fromEntries([0, 1, 2, 3, 4, 5].map(i => [`r${i}`, (i + 1) * 10 * K])) })
    await s.toolAgent('p1', 'plan refactor')
    await s.finish('p1')
    for (const i of [0, 1, 2, 3, 4, 5]) {
      await s.launch(`wf_${i}`, `run-${i}`)
      await s.runAgent(`wf_${i}`, `r${i}`, `step:${i}`)
      await s.clock.advance(1000)
      await s.finish(`r${i}`)
    }
    for (const surface of SURFACES) {
      // 9 rows (the desktop's frame takes one more): the three newest runs, then one line for the rest.
      const short = await agentsTab($, surface, 90, surface === 'terminal' ? 9 : 10)
      const keys = (await drawnRows(short)).map(([key]) => key)
      expect(keys).toEqual(['group-run:wf_5', 'group-run:wf_4', 'group-run:wf_3'])
      // run-0, -1 and -2 (10k + 20k + 30k) and plan refactor (3k): 63k.
      expect(await lineOf(short, /ältere/)).toBe('+3 ältere Läufe und 1 Agent · 63k')
      await short.unmount()
    }
  })

  test('the older line in the full card: where the card has not the rows, the oldest finished runs go there before the compact view does', async ($, on) => {
    const s = await session($, on, Object.fromEntries([0, 1, 2, 3, 4, 5].map(i => [`r${i}`, (i + 1) * 10 * K])))
    for (const i of [0, 1, 2, 3, 4, 5]) {
      await s.launch(`wf_${i}`, `run-${i}`)
      await s.runAgent(`wf_${i}`, `r${i}`, `step:${i}`)
      await s.clock.advance(1000)
      await s.finish(`r${i}`)
    }
    for (const surface of SURFACES) {
      // Shrunk a row at a time: the full card, without the timeline, then with fewer runs and the older line; the compact view last.
      const seen: string[] = []
      for (let rows = 40; rows >= 6; rows -= 1) {
        const ui = await agentsTab($, surface, 90, rows)
        const isCompact = (await ui.find({ type: 'Button', key: 'processed' })) === undefined
        const runs = (await drawnRows(ui)).filter(([key]) => key.startsWith('group-run:')).length
        const older = await lineOf(ui, /ältere/)
        seen.push(isCompact ? 'compact' : `${runs}${older === undefined ? '' : ` + ${older}`}`)
        await ui.unmount()
      }
      // One run there saves no row, the older line taking its place: two at least, run-0 and run-1 (10k + 20k).
      const steps = seen.filter((one, i) => one !== seen[i - 1])
      expect(steps.slice(0, 2)).toEqual(['6', '4 + +2 ältere Läufe · 30k'])
      // The newest run always keeps its line there: where it does not fit, the compact view.
      expect(steps.filter(one => one !== 'compact').every(one => !one.startsWith('0'))).toBe(true)
      expect(steps.at(-1)).toBe('compact')
    }
  })

  test(`at most ${MAX_RUNS} runs keep a line: the oldest leaves, counted with its agents in the older line, its tokens in the Agents pot`, async ($, on) => {
    expect(MAX_RUNS).toBe(30)
    let ledger = NO_LEDGER
    for (let i = 0; i <= MAX_RUNS; i += 1) ledger = withAgent(withAgent(ledger, `a${i}`, { id: `wf_${i}`, at: i }), `b${i}`, { id: `wf_${i}`, at: i })
    expect(ledger.runs.map(run => run.id)).toEqual(Array.from({ length: MAX_RUNS }, (_, i) => `wf_${i + 1}`))
    expect(ledger.runsOlder).toEqual({ runs: 1, agents: 2 })
    // An agent counted once: named again, its run does not count it twice.
    expect(withAgent(ledger, 'a30', { id: 'wf_30', at: 99 }).runs.at(-1)?.agents).toBe(2)

    const s = await session($, on)
    for (let i = 0; i <= MAX_RUNS; i += 1) {
      await s.launch(`wf_${i}`, `run-${i}`)
      await s.runAgent(`wf_${i}`, `r${i}`, `step:${i}`)
      await s.finish(`r${i}`)
    }
    await s.clock.advance(1000)
    const ui = await agentsTab($, 'terminal', 90, 200)
    const keys = (await drawnRows(ui)).map(([key]) => key).filter(key => key.startsWith('group-run:'))
    expect(keys).toHaveLength(MAX_RUNS)
    expect(keys).not.toContain('group-run:wf_0')
    expect(await lineOf(ui, /ältere|älterer/)).toBe('+1 älterer Lauf · 1k')
    expect(has(await ui.findAll({ type: 'Text' }), /^ ?31 fertig ?$/)).toBe(true)
    expect(has(await ui.findAll({ type: 'Text' }), /Agents 31k/)).toBe(true)
    await ui.unmount()
  })

  test('the compact view from about 100 columns: the finished in two columns, filled down the first, then down the second, the newest first, their figures right-aligned; below that in one', async ($, on) => {
    const s = await session($, on)
    for (const i of [0, 1, 2, 3, 4]) {
      await s.launch(`wf_${i}`, `run-${i}`)
      await s.runAgent(`wf_${i}`, `r${i}`, `step:${i}`)
      await s.clock.advance(1000)
      await s.finish(`r${i}`)
    }
    await s.runAgent('wf_live', 'live1', 'watch:logs')
    await s.clock.advance(1000)
    // 100 columns: the body 96, the view's 94 in two columns of 45 with ` │ ` between them; run-4 and run-3 down the first, run-2 and the older line down the second.
    const wide = await inlineRows($, 100, 6)
    expect(wide.slice(1)).toEqual([
      ' AGENTS 1 ◉ · 5 ✓ · verarbeitet 6k',
      ' ◉ Workflow wf_live ×1 0:01 · 1k',
      '   ◉ watch:logs 0:01 · 1k',
      ` ${'✓ ▸ run-4 ×1'.padEnd(38)}1k 0:01 │ ${'✓ ▸ run-2 ×1'.padEnd(38)}1k 0:01`,
      ` ${'✓ ▸ run-3 ×1'.padEnd(38)}1k 0:01 │ +2 ältere Läufe · 2k`,
    ])
    // 90 columns: one column, the same lines one under another as far as they go.
    const narrow = await inlineRows($, 90, 6)
    expect(narrow.slice(1)).toEqual([
      ' AGENTS 1 ◉ · 5 ✓ · verarbeitet 6k',
      ' ◉ Workflow wf_live ×1 0:01 · 1k',
      '   ◉ watch:logs 0:01 · 1k',
      ' ✓ ▸ run-4 ×1 0:01 · 1k',
      ' +4 ältere Läufe · 4k',
    ])
  })

  test('an opened run of 45 agents in two columns stands whole in one: its agents in the order its script started them, those with no row counted („+38 weitere“); at 100 to 109 columns no line wraps, each figure in its entry\'s line, right-aligned in its column', async ($, on) => {
    const s = await session($, on, MASS_TOKENS)
    await s.toolAgent('x1', 'Explore Ordnerstruktur')
    await s.finish('x1')
    await s.launch('wf_a', 'run-a')
    await s.runAgent('wf_a', 'a1', 'step:a')
    await s.clock.advance(12 * 60_000)
    await s.finish('a1')
    await massRun(s)
    await s.launch('wf_c', 'run-c')
    await s.runAgent('wf_c', 'c1', 'step:c')
    await s.clock.advance(1000)
    await s.finish('c1')
    for (let terminal = 100; terminal <= 109; terminal += 1) {
      // The run opened once, at 100 columns: the compact view keeps it open at every width after.
      const drawn = await inlineRows($, terminal, 12, terminal === 100 ? 'group-run:wf_m' : undefined)
      expect(drawn[1]).toBe(' AGENTS 48 ✓ · verarbeitet 1M')
      // The body's 12 rows: the head, then ten rows of two columns.
      const body = drawn.slice(2)
      expect(body).toHaveLength(10)
      const cell = Math.floor((terminal - FRAME_COLUMNS - 2 - 3) / 2)
      // No line wraps: in every row the first column ends where ` │ ` stands, the second no wider than its own.
      for (const row of body) expect(row.indexOf(' │')).toBe(1 + cell)
      const first = body.map(row => row.slice(1, 1 + cell))
      const second = body.map(row => row.slice(cell + 4))
      for (const one of second) expect(cellsOf(one)).toBeLessThanOrEqual(cell)
      // Down the first column: the newest run, then the opened one whole: its head, its first seven agents in
      // their script's order (their loops started the even ones first), the other 38 counted under them.
      expect(first[0]).toMatch(/^✓ ▸ run-c ×1 /)
      expect(first[1]).toMatch(/^✓ ▾ nox-test-masse ×45 /)
      expect(first.slice(2, 9).map(one => one.trim().split(/ +/)[0])).toEqual(okNames(7))
      expect(first[9]?.trimEnd()).toBe('    +38 weitere')
      // None of its agents in the second column: it goes on down from the top with the runs after it.
      expect(second.some(one => one.includes('ok:'))).toBe(false)
      expect(second[0]).toMatch(/^✓ ▸ run-a ×1 /)
      expect(second[1]).toMatch(/^✓ Explore Ordnerstruktur /)
      expect(second.slice(2).every(one => one.trim() === '')).toBe(true)
      // Each agent's figures in its own line: ok:7 processed 7k; the time in that line too.
      for (const [i, one] of first.slice(2, 9).entries()) expect(one).toMatch(new RegExp(`^ {4}ok:${i + 1} +${i + 1}k +0:3\\d$`))
      // Right-aligned in each column: every time ends where its column does, every figure processed where the others do.
      for (const column of [first, second]) {
        const figured = column.filter(one => /\d+:\d\d$/.test(one))
        expect(figured.length).toBeGreaterThan(1)
        for (const one of figured) expect(cellsOf(one)).toBe(cell)
        expect(new Set(figured.map(one => one.replace(/ +\d+:\d\d$/, '').length)).size).toBe(1)
      }
      // run-a's 12:00 and run-c's 0:01 in one column of times: 0:01 one cell further in.
      expect(second[0]).toMatch(/ 1k 12:00$/)
      expect(first[0]).toMatch(/ 1k {2}0:01$/)
    }
  })

  test('two columns: an opened run whose column has not the rows for its head, an agent and its count begins atop the second; for the older line it gives up an agent', async ($, on) => {
    // 50 agents: every one still in the list.
    const s = await session($, on, MASS_TOKENS)
    await s.launch('wf_a', 'run-a')
    await s.runAgent('wf_a', 'a1', 'step:a')
    await s.clock.advance(1000)
    await s.finish('a1')
    await massRun(s)
    // Four runs after it.
    for (const i of [1, 2, 3, 4]) {
      await s.launch(`wf_${i}`, `run-${i}`)
      await s.runAgent(`wf_${i}`, `r${i}`, `step:${i}`)
      await s.clock.advance(1000)
      await s.finish(`r${i}`)
    }
    // 8 rows inline: the head, then six rows of two columns.
    const body = (await inlineRows($, 100, 8, 'group-run:wf_m')).slice(2)
    expect(body).toHaveLength(6)
    const first = body.map(row => row.slice(1, 46).trimEnd())
    const second = body.map(row => row.slice(49))
    // The first column: the four runs, the newest first; two rows left, no room for the opened run's head, an agent and its count.
    expect(first.slice(0, 4).map(one => one.split(/ +/)[2])).toEqual(['run-4', 'run-3', 'run-2', 'run-1'])
    expect(first.slice(4)).toEqual(['', ''])
    // The second: the opened run whole from its top, its agents in their script's order, one given up for the older line (run-a) under it.
    expect(second[0]).toMatch(/^✓ ▾ nox-test-masse ×45 /)
    expect(second.slice(1, 4).map(one => one.trim().split(/ +/)[0])).toEqual(okNames(3))
    expect(second[4]).toBe('    +42 weitere')
    expect(second[5]).toBe('+1 älterer Lauf · 1k')
  })

  test('a run\'s agents in the order its script started them, whichever loop started first: in the full card and in one column, those with no row counted under them', async ($, on) => {
    const s = await session($, on, MASS_TOKENS)
    await massRun(s)
    for (const surface of SURFACES) {
      // The full card: all 45 in their script's order.
      const ui = await agentsTab($, surface)
      await ui.press({ key: 'group-run:wf_m' })
      const keys = (await drawnRows(ui)).map(([key]) => key).filter(key => /^m\d+$/.test(key))
      expect(keys).toEqual(Array.from({ length: 45 }, (_, i) => `m${i + 1}`))
      await ui.press({ key: 'group-run:wf_m' })
      await ui.unmount()
    }
    // The compact view in one column, inline at 90 columns: its head, its first eight agents in their script's order, the rest counted.
    const body = (await inlineRows($, 90, 12, 'group-run:wf_m')).slice(2)
    expect(body[0]).toMatch(/^ ✓ ▾ nox-test-masse ×45 /)
    expect(body.slice(1, 9).map(row => row.trim().split(' ')[0])).toEqual(okNames(8))
    expect(body.slice(1, 9).every((row, i) => row === `     ok:${i + 1} ${i + 1}k`)).toBe(true)
    expect(body[9]).toBe('     +37 weitere')
    expect(body).toHaveLength(10)
  })

  test('one column: an opened run\'s count under its agents takes in those no longer in the list', async ($, on) => {
    // Sixty agents, the ten oldest no longer in the list.
    const s = await session($, on)
    await s.launch('wf_big', 'bulk')
    for (let i = 0; i < 60; i += 1) {
      await s.runAgent('wf_big', `b${i}`, `bulk:f${i}`, i + 1)
      await s.finish(`b${i}`)
    }
    // Inline at 90 columns: the run's head, the eight oldest still in the list, then the 52 others: 42 with no row, 10 no longer in the list.
    const body = (await inlineRows($, 90, 12, 'group-run:wf_big')).slice(2)
    expect(body[0]).toMatch(/^ ✓ ▾ bulk ×60 /)
    expect(body.slice(1, 9).map(row => row.trim().split(' ')[0])).toEqual(Array.from({ length: 8 }, (_, i) => `bulk:f${10 + i}`))
    expect(body[9]).toBe('     +52 weitere')
  })

  test('two columns: as few rows as hold every line, the first column filled first', async ($, on) => {
    const s = await session($, on)
    for (const i of [1, 2, 3]) {
      await s.launch(`wf_${i}`, `run-${i}`)
      await s.runAgent(`wf_${i}`, `r${i}`, `step:${i}`)
      await s.clock.advance(1000)
      await s.finish(`r${i}`)
    }
    // 12 rows inline, three runs: two rows, not three down the first column.
    const body = (await inlineRows($, 100, 12)).slice(2)
    expect(body).toEqual([` ${'✓ ▸ run-3 ×1'.padEnd(38)}1k 0:01 │ ${'✓ ▸ run-1 ×1'.padEnd(38)}1k 0:01`, ` ${'✓ ▸ run-2 ×1'.padEnd(38)}1k 0:01 │`])
  })

  test('two columns: an opened run that the lines before it would leave no place keeps one, the lowest of them giving way to the older line', async ($, on) => {
    // 50 agents: every one still in the list.
    const s = await session($, on, MASS_TOKENS)
    await massRun(s)
    for (const i of [1, 2, 3, 4, 5]) {
      await s.launch(`wf_${i}`, `run-${i}`)
      await s.runAgent(`wf_${i}`, `r${i}`, `step:${i}`)
      await s.clock.advance(1000)
      await s.finish(`r${i}`)
    }
    // Opened where the rows hold it, then 5 rows inline: three rows of two columns, five newer runs before it.
    await inlineRows($, 100, 12, 'group-run:wf_m')
    const body = (await inlineRows($, 100, 5)).slice(2)
    const first = body.map(row => row.slice(1, 46).trimEnd())
    const second = body.map(row => row.slice(49))
    expect(first.map(one => one.split(/ +/)[2])).toEqual(['run-5', 'run-4', 'run-3'])
    // run-2 and run-1 give way: the opened run's head and its count, the older line under them.
    expect(second[0]).toMatch(/^✓ ▾ nox-test-masse ×45 /)
    expect(second.slice(1)).toEqual(['    +45 weitere', '+2 ältere Läufe · 2k'])
  })

  test('one column: with two runs opened, an agent the count would have taken the row of comes back', async ($, on) => {
    const s = await session($, on)
    await s.launch('wf_b', 'run-b')
    for (const i of [1, 2, 3]) await s.runAgent('wf_b', `b${i}`, `b:${i}`, i)
    await s.clock.advance(1000)
    for (const i of [1, 2, 3]) await s.finish(`b${i}`)
    await s.launch('wf_a', 'run-a')
    for (const i of [1, 2]) await s.runAgent('wf_a', `a${i}`, `a:${i}`, i)
    await s.clock.advance(1000)
    for (const i of [1, 2]) await s.finish(`a${i}`)
    await inlineRows($, 90, 12, 'group-run:wf_a')
    await inlineRows($, 90, 12, 'group-run:wf_b')
    // Five rows for seven lines: run-a whole, its two agents; run-b's three counted under its head.
    const body = (await inlineRows($, 90, 7)).slice(2)
    expect(body).toEqual([' ✓ ▾ run-a ×2 0:01 · 2k', '     a:1 1k', '     a:2 1k', ' ✓ ▾ run-b ×3 0:01 · 3k', '     +3 weitere'])
  })

  test('an opened run missing only agents no longer in the list says so: „+2 nicht mehr in der Liste“', async ($, on) => {
    const s = await session($, on)
    // Three agents of an older run, then 49 of a newer one: the two oldest leave the list.
    await s.launch('wf_x', 'run-x')
    for (const i of [0, 1, 2]) await s.runAgent('wf_x', `x${i}`, `x:${i}`, i + 1)
    await s.clock.advance(1000)
    for (const i of [0, 1, 2]) await s.finish(`x${i}`)
    await s.launch('wf_y', 'run-y')
    for (let i = 0; i < 49; i += 1) {
      await s.runAgent('wf_y', `y${i}`, `y:${i}`, i + 1)
      await s.finish(`y${i}`)
    }
    const body = (await inlineRows($, 90, 12, 'group-run:wf_x')).slice(2)
    expect(body.slice(1)).toEqual([' ✓ ▾ run-x ×3 0:01 · 3k', '     x:2 1k', '     +2 nicht mehr in der Liste'])
  })

  test('in English: an opened run\'s agents with no row, „+37 more“', { options: { language: 'en' } }, async ($, on) => {
    const s = await session($, on, MASS_TOKENS)
    await massRun(s)
    const body = (await inlineRows($, 100, 12, 'group-run:wf_m')).slice(2)
    expect(body.map(row => row.trimEnd()).at(-1)).toBe('     +37 more')
  })

  test('a running agent whose call has no room beside its name shows it in a line under it, with how long ago it started; with room, in its line', async ($, on) => {
    const s = await session($, on)
    await s.toolAgent('t1', 'review the authentication middleware')
    await s.launch('wf_r', 'audit')
    await s.runAgent('wf_r', 'r1', 'audit:the session store and its cookies')
    await $.tool.call({ tool: 'Read', file_path: '/proj/hooks/session-store.ts', agentId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/hooks/register.tsx', agentId: 'r1' })
    await s.clock.advance(3000)
    for (const surface of SURFACES) {
      // A narrow compact view (45 columns): each call in a line of its own, at the agent's indent.
      const short = await agentsTab($, surface, 45, 12)
      const texts = await short.findAll({ type: 'Text' })
      const lines = await rowsOf(short)
      expect(lines.t1).toMatch(/^◉ review the .*… 0:03 · 1k$/)
      expect(lines.r1).toMatch(/^ {2}◉ audit:the .*… 0:03 · 1k$/)
      expect(has(texts, /^ {2}→ Read session-store\.ts · vor 3 s$/)).toBe(true)
      expect(has(texts, /^ {4}→ Read register\.tsx · vor 3 s$/)).toBe(true)
      await short.unmount()
      // The full card shortened at 45 columns: the same.
      const shortened = await agentsTab($, surface, 45, 22)
      expect(has(await shortened.findAll({ type: 'Text' }), /^ {4}→ Read register\.tsx · vor 3 s$/)).toBe(true)
      await shortened.unmount()
      // The compact view at 120 columns: each call in the agent's own line, no line under it.
      const wide = await agentsTab($, surface, 120, 10)
      expect(await wide.find({ type: 'Button', key: 'processed' })).toBeUndefined()
      const wideLines = await rowsOf(wide)
      expect(wideLines.t1).toBe('◉ review the authentication middleware 0:03 · 1k → Read session-store.ts')
      expect(wideLines.r1).toBe('  ◉ audit:the session store and its cookies 0:03 · 1k → Read register.tsx')
      expect(has(await wide.findAll({ type: 'Text' }), /· vor 3 s$/)).toBe(false)
      await wide.unmount()
    }
  })

  test('the compact view: a finished group the person opened stays longer than a closed run\'s line, so a press shows what it opened', async ($, on) => {
    const s = await session($, on)
    // An older group of no run, two agents; a newer run of two; three agents running.
    await s.toolAgent('c1', 'check: a.ts')
    await s.toolAgent('c2', 'check: b.ts')
    await s.clock.advance(1000)
    await s.finish('c1')
    await s.finish('c2')
    await s.launch('wf_0', 'run-0')
    await s.runAgent('wf_0', 'r0a', 'step:a', 1)
    await s.runAgent('wf_0', 'r0b', 'step:b', 2)
    await s.clock.advance(1000)
    await s.finish('r0a')
    await s.finish('r0b')
    for (const name of ['alpha', 'bravo', 'charlie']) await s.toolAgent(`t-${name}`, `${name} task`)
    await s.clock.advance(1000)
    for (const surface of SURFACES) {
      const short = await agentsTab($, surface, 90, surface === 'terminal' ? 10 : 11)
      // The running agents, the run's line, the group's head: as many rows as there are.
      expect((await drawnRows(short)).map(([key]) => key)).toEqual(['t-charlie', 't-bravo', 't-alpha', 'group-run:wf_0', 'group-check'])
      // The group opened: its agents have no row and are counted; the run's line, closed, gives way to that line, the group's head stays.
      await short.press({ key: 'group-check' })
      expect((await drawnRows(short)).map(([key]) => key)).toEqual(['t-charlie', 't-bravo', 't-alpha', 'group-check'])
      expect((await rowsOf(short))['group-check']).toBe('✓ ▾ check ×2 2k')
      // run-0 (2k), and the group's two agents with no row.
      expect(await lineOf(short, /älterer/)).toBe('+1 älterer Lauf und 2 Agents · 2k')
      await short.press({ key: 'group-check' })
      await short.unmount()
    }
  })

  test('in English: the older line, a running run\'s finished agents, the agents no longer in the list', { options: { language: 'en' } }, async ($, on) => {
    const s = await session($, on)
    await s.launch('wf_big', 'bulk')
    for (let i = 0; i < 52; i += 1) {
      await s.runAgent('wf_big', `b${i}`, `bulk:f${i}`, i + 1)
      await s.finish(`b${i}`)
    }
    await s.runAgent('wf_big', 'live1', 'bulk:last', 53)
    await s.launch('wf_old', 'past-run')
    for (let i = 0; i < 3; i += 1) {
      await s.runAgent('wf_old', `o${i}`, `old:${i}`, i + 1)
      await s.finish(`o${i}`)
    }
    await s.clock.advance(1000)
    const ui = await agentsTab($, 'terminal', 90, 200)
    expect((await rowsOf(ui))['group-done:wf_big']).toMatch(/^ {2}✓ ▸ 52 done /)
    await ui.press({ key: 'group-done:wf_big' })
    expect(has(await ui.findAll({ type: 'Text' }), /^ {6}\+\d+ no longer in the list$/)).toBe(true)
    await ui.press({ key: 'group-done:wf_big' })
    await ui.unmount()
    // 8 rows: the running run and the older line for the finished one.
    const short = await agentsTab($, 'terminal', 90, 8)
    expect(await lineOf(short, /older/)).toBe('+1 older run · 3k')
    await short.unmount()
  })
})
