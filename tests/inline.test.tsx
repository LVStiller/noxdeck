import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, SessionRateLimit } from 'claude-code'
import { cellsOf } from '../hooks/view'
import { BAR, engine, failedRun, K, PANE, READ_RESULT, SPAWN, start, SURFACES, test, TODOS } from './helpers'
import type { World } from './helpers'

// The pane seated inline above the prompt. What the engine takes around the
// body there is Claude Code 2.1.319's: a round border and its padding, 4
// columns, and the border's 2 rows (`BORDER_COLUMNS`, `chromeRows`). The kit
// draws no surface, so `paint` lays the tree out as the terminal does for the
// few layouts this view uses, and each test checks the rows it gives.

const FRAME_COLUMNS = 4

/** The pane inline in a terminal of `terminal` columns, its body `rows` rows high. */
const inline = (terminal: number, rows = 12) => ({
  ...PANE,
  props: { ...PANE.props, placement: 'inline' as const, bodyColumns: terminal - FRAME_COLUMNS, scroll: { offset: 0, bodyRows: rows } },
})

type Node = string | { type: string; props?: Record<string, unknown>; children?: readonly Node[] }
type Block = { rows: string[]; width: number }

const propsOf = (node: Node) => (typeof node === 'string' ? {} : (node.props ?? {}))
const numberOf = (value: unknown) => (typeof value === 'number' ? value : 0)
const textOf = (node: Node): string => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''))
const paddedTo = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - cellsOf(text)))

/** Boxes side by side: one that grows takes what the others leave; with `flexWrap` they break into rows. */
function drawRow(children: readonly Node[], room: number, props: Record<string, unknown>): Block {
  const leftOf = (kid: Node) => numberOf(propsOf(kid).marginLeft)
  const taken = children.filter(kid => propsOf(kid).flexGrow === undefined).reduce((sum, kid) => sum + leftOf(kid) + draw(kid, room).width, 0)
  const blocks = children.map(kid => {
    const isGrowing = propsOf(kid).flexGrow !== undefined
    const drawn = draw(kid, isGrowing ? Math.max(1, room - taken) : room)
    return { rows: [...Array<string>(numberOf(propsOf(kid).marginTop)).fill(''), ...drawn.rows], left: leftOf(kid), width: isGrowing ? Math.max(drawn.width, room - taken) : drawn.width }
  })
  const lines: (typeof blocks)[] = [[]]
  let used = 0
  for (const block of blocks) {
    if (props.flexWrap === 'wrap' && used > 0 && used + block.width > room) {
      lines.push([])
      used = 0
    }
    lines.at(-1)?.push(block)
    used += block.left + block.width
  }
  const between = props.justifyContent === 'space-between' ? Math.max(0, room - used) : 0
  const rows = lines.flatMap(line => {
    const height = Math.max(0, ...line.map(block => block.rows.length))
    return Array.from({ length: height }, (_, row) =>
      line.map((block, i) => ' '.repeat(block.left + (i === 0 ? 0 : between)) + paddedTo(block.rows[row] ?? '', block.width)).join(''),
    )
  })
  return { rows, width: Math.max(0, ...rows.map(cellsOf)) }
}

/** A node's rows in `room` cells, as the terminal lays it out. */
function draw(node: Node, room: number): Block {
  if (typeof node === 'string') return { rows: [node], width: cellsOf(node) }
  const props = propsOf(node)
  const children = node.children ?? []
  if (node.type === 'Text') {
    const text = textOf(node)
    const shown = props.wrap === 'truncate-start' && cellsOf(text) > room ? `…${[...text].slice(1 - room).join('')}` : text
    return { rows: [shown], width: cellsOf(shown) }
  }
  if (node.type === 'Image') {
    const columns = numberOf(props.columns)
    return { rows: Array<string>(numberOf(props.rows)).fill((props.alt === ' ' ? ' ' : '▒').repeat(columns)), width: columns }
  }
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

type Mounted = { drawn: () => Promise<unknown>; unmount: () => Promise<void>; findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]>; press: (q: { key: string }) => Promise<unknown> }

/** The tree's rows; no row wider than the body, none past its rows, no frame but the engine's. */
async function rowsOf(ui: Mounted, terminal: number, bodyRows: number): Promise<string[]> {
  const body = terminal - FRAME_COLUMNS
  const rows = draw((await ui.drawn()) as Node, body).rows.map(row => row.replaceAll(' ', ' ').trimEnd())
  for (const row of rows) expect(`${cellsOf(row) <= body} ${row}`).toBe(`true ${row}`)
  expect(rows.length).toBeLessThanOrEqual(bodyRows)
  expect((await ui.findAll({ type: 'Box' })).filter(box => box.props.borderStyle !== undefined)).toEqual([])
  return rows
}

/** The pane's rows on the Live tab, bars as `[n]` for their cells. */
async function live($: Engine, terminal: number, bodyRows = 12): Promise<string[]> {
  const ui = await $.ui.mount({ ...inline(terminal, bodyRows), surface: 'terminal' })
  const rows = await rowsOf(ui, terminal, bodyRows)
  await ui.unmount()
  return rows.map(row => row.replace(/[█│]{2,}/, bar => `[${bar.length}]`))
}

/** Two columns as a side-by-side row: `left` in its cells, then `right`. */
const beside = (left: string, cells: number, right: string) => `${left.padEnd(cells)}${right}`
/** The columns' title row: CONTEXT and its fill in `width` cells. */
const contextHead = (width: number) => `CONTEXT${'58 % · 116k / 200k'.padStart(width - 7)}`

/** A reset time as a local date: Wednesday, November 11, 2026 at `hours`:`minutes`. */
const wednesday = (hours: number, minutes: number) => new Date(2026, 10, 11, hours, minutes).toISOString()
const FIVE_HOURS: SessionRateLimit = { kind: 'five_hour', percentUsed: 38, resetsAt: wednesday(18, 30) }
const WEEK: SessionRateLimit = { kind: 'seven_day', percentUsed: 33, resetsAt: wednesday(0, 0) }
const LIMITS = [['the 5h limit', FIVE_HOURS], ['the week', WEEK]] as const

const HEARTS = '♥ ♥ ♥ ♡ ♡'
const TITLE = 'noxdeck  Changes  Agents  Live'
const RADAR = 'RADAR · Hotspots view.tsx 1×'
/** The growth this session's samples show: 14k a turn, four turns to go. */
const GROWTH = 'Ø +14k/Turn · Auto-Compact in ~4 Turns'
const GROWTH_SHORT = 'Ø +14k/Turn · Compact ~4 Turns'

/**
 * A session at work: a measured window, two turns' growth, the file in hand.
 * The first drawing holds the probe, the first tick blits it, so the terminal
 * has answered whether it draws pictures.
 */
async function session($: Engine, on: On, world: World = {}) {
  const limits = world.rateLimits ?? [WEEK]
  const clock = engine(on, { messages: [76 * K, 76 * K, 62 * K, 76 * K], ...world, rateLimits: limits })
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash') return failedRun($, e)
    if (e.tool === 'TodoWrite') return { result: { oldTodos: [], newTodos: e.todos } }
    return e.tool === 'Edit' ? { result: { filePath: e.file_path, structuredPatch: [], originalFile: 'x' } } : READ_RESULT
  })
  await start($)
  await $.session.measure({ context: { window: 200 * K, tokens: 116 * K, percent: 58 }, rateLimits: limits, changed: ['context'] })
  for (const turnId of ['t1', 't2']) await $.turn.complete({ turnId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  await $.turn.start({ text: '', turnId: 't3' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/hooks/view.tsx', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...inline(100), surface: 'terminal' })
  await ui.unmount()
  await clock.advance(1000)
  return clock
}

const PICTURES: World = { images: 'ok' }
const loop = async ($: Engine) => {
  for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Bash', command: 'just test', description: 'Run the tests' })
}

describe('the inline view at real widths', () => {
  for (const [name, limit] of LIMITS) {
    for (const [picture, world] of [['pictures', PICTURES], ['no pictures', {}]] as const) {
      test(`every width with ${name} and ${picture}: side by side from 80 columns, the owl only there and only with pictures`, async ($, on) => {
        await session($, on, { ...world, rateLimits: [limit] })
        for (const terminal of [36, 40, 49, 50, 60, 79, 80, 99, 100, 109, 120, 200]) {
          const ui = await $.ui.mount({ ...inline(terminal), surface: 'terminal' })
          const rows = await rowsOf(ui, terminal, 12)
          const owls = (await ui.findAll({ type: 'Image' })).filter(image => image.props.alt !== ' ')
          await ui.unmount()
          expect([terminal, rows.length, owls.length]).toEqual([terminal, terminal >= 80 ? 6 : 5, terminal >= 80 && picture === 'pictures' ? 1 : 0])
          expect(rows[0]).toBe(TITLE)
        }
      })
    }
  }

  test('60 columns with the week: the state, the limit and its reset in a row, the bar, one RADAR row', async ($, on) => {
    await session($, on)
    expect(await live($, 60)).toEqual([TITLE, 'arbeitet · ✎ bearbeitet view.tsx', `${HEARTS}  Woche · 67 % übrig · Reset Mi 00:00`, '[37] 58 % · 116k / 200k', RADAR])
  })

  test('60 columns with the 5h limit: the same rows, its own words', async ($, on) => {
    await session($, on, { rateLimits: [FIVE_HOURS] })
    expect((await live($, 60))[2]).toBe(`${HEARTS}  5h-Limit · 62 % übrig · Reset 18:30`)
  })

  test('80 columns with the week, no pictures: the two columns with the long growth', async ($, on) => {
    await session($, on)
    expect(await live($, 80)).toEqual([
      TITLE,
      beside('STATUS · arbeitet', 36, contextHead(40)),
      beside('✎ bearbeitet view.tsx', 36, '[40]'),
      beside(`${HEARTS}  Woche · 67 % übrig`, 36, '● messages ≈38 %  ● tools ≈9 %  +3'),
      beside('Reset Mi 00:00', 36, GROWTH),
      RADAR,
    ])
  })

  test('80 columns with the week and pictures: the owl beside STATUS, CONTEXT keeps 33 cells, the short growth', async ($, on) => {
    await session($, on, PICTURES)
    expect(await live($, 80)).toEqual([
      TITLE,
      beside('STATUS · arbeitet', 43, contextHead(33)),
      `${beside('✎ bearbeitet view.tsx', 35, '▒▒▒▒▒▒  ')}[33]`,
      `${beside(`${HEARTS}  Woche · 67 % übrig`, 35, '▒▒▒▒▒▒  ')}● messages ≈38 % ● tools ≈9 % +3`,
      `${beside('Reset Mi 00:00', 35, '▒▒▒▒▒▒  ')}${GROWTH_SHORT}`,
      RADAR,
    ])
  })

  test('the short growth is the owl\'s alone: without it a line too long is cut', { options: { language: 'en' } }, async ($, on) => {
    await session($, on, { window: 1000 * K, autoCompact: { window: 1000 * K, threshold: 967 * K, source: 'auto' } })
    expect((await live($, 80))[4]).toBe(beside('Reset Wed 00:00', 36, 'avg +14k/Turn · Auto-Compact in ~61 Tur…'))
  })

  test('100 columns with the week and pictures: the owl, the long growth, which fits', async ($, on) => {
    await session($, on, PICTURES)
    const rows = await live($, 100)
    expect(rows[2]).toBe(`${beside('✎ bearbeitet view.tsx', 35, '▒▒▒▒▒▒  ')}[53]`)
    expect(rows[3]).toBe(`${beside(`${HEARTS}  Woche · 67 % übrig`, 35, '▒▒▒▒▒▒  ')}● messages ≈38 %  ● tools ≈9 %  ● mcp ≈6 %  +2`)
    expect(rows[4]).toBe(`${beside('Reset Mi 00:00', 35, '▒▒▒▒▒▒  ')}${GROWTH}`)
  })

  test('100 columns with the week, no pictures: CONTEXT takes the owl\'s cells, the legend closes up for one more', async ($, on) => {
    await session($, on)
    const rows = await live($, 100)
    expect(rows[2]).toBe(beside('✎ bearbeitet view.tsx', 36, '[60]'))
    expect(rows[3]).toBe(beside(`${HEARTS}  Woche · 67 % übrig`, 36, '● messages ≈38 % ● tools ≈9 % ● mcp ≈6 % ● memory ≈3 % +1'))
  })

  test('side by side from exactly 80 columns; 79 keep one column', async ($, on) => {
    await session($, on, PICTURES)
    expect((await live($, 79)).length).toBe(5)
    expect((await live($, 80)).length).toBe(6)
  })

  test('the limit gives way word by word, the share left never', async ($, on) => {
    await session($, on)
    expect((await live($, 50))[2]).toBe(`${HEARTS}  Woche · 67 % übrig · Reset Mi 00:00`)
    expect((await live($, 49))[2]).toBe(`${HEARTS}  67 % · Reset Mi 00:00`)
    expect((await live($, 36))[2]).toBe(`${HEARTS}  67 % · Reset Mi 00:00`)
    expect((await live($, 35))[2]).toBe(`${HEARTS}  67 %`)
  })

  test('the bar style draws in the same cells', BAR, async ($, on) => {
    await session($, on)
    expect((await live($, 60))[2]).toBe(`${'▊'.repeat(10)} Woche · 67 % übrig · Reset Mi 00:00`)
    expect((await live($, 80))[3]).toMatch(/^▊{10} Woche · 67 % übrig +●/)
  })

  test('the bar keeps its cells where the tokens would take them: the share stays', async ($, on) => {
    await session($, on)
    expect((await live($, 35))[3]).toBe('[12] 58 % · 116k / 200k')
    expect((await live($, 34))[3]).toBe('[25] 58 %')
  })

  test('on the other surfaces the view draws too, no pictures', async ($, on) => {
    await session($, on, PICTURES)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...inline(100), surface })
      expect((await ui.findAll({ type: 'Image' })).filter(image => image.props.alt !== ' ').length).toBe(surface === 'terminal' ? 1 : 0)
      await ui.unmount()
    }
  })

  test('in English the widths hold, the short growth and the counts in its words', { options: { language: 'en' } }, async ($, on) => {
    await session($, on, PICTURES)
    expect((await live($, 60))[1]).toBe('working · ✎ Editing view.tsx')
    expect((await live($, 60))[2]).toBe(`${HEARTS}  week · 67% left · Reset Wed 00:00`)
    expect((await live($, 80))[4]).toBe(`${beside('Reset Wed 00:00', 35, '▒▒▒▒▒▒  ')}avg +14k/Turn · Compact ~4 Turns`)
    expect((await live($, 60, 3))[0]).toBe(`${TITLE}${'+2 hidden'.padStart(56 - TITLE.length)}`)
  })

  test('the dock keeps its frames', async ($, on) => {
    await session($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.findAll({ type: 'Box' })).filter(box => box.props.borderStyle === 'round').length).toBeGreaterThan(1)
    await ui.unmount()
  })
})

describe('the owl inline', () => {
  test('it needs pictures: the block owl does not stand in', async ($, on) => {
    await session($, on)
    expect((await live($, 100)).join('\n')).not.toMatch(/▒|[▀▄]/)
  })

  test('the style without pictures has none', { options: { noxStyle: 'klassisch' } }, async ($, on) => {
    await session($, on, PICTURES)
    expect((await live($, 100)).join('\n')).not.toContain('▒')
  })

  test('with neither limit nor measurement the block has two rows and the owl stays out', async ($, on) => {
    await session($, on, { ...PICTURES, rateLimits: [], isMeasured: false })
    expect((await live($, 100)).join('\n')).not.toContain('▒')
  })

  test('with no limit CONTEXT\'s rows hold it', async ($, on) => {
    await session($, on, { ...PICTURES, rateLimits: [] })
    const rows = await live($, 100)
    expect(rows.length).toBe(6)
    expect(rows[4]).toContain('▒▒▒▒▒▒')
  })

  test('too low for two columns it goes with them', async ($, on) => {
    await session($, on, PICTURES)
    expect((await live($, 100, 6)).join('\n')).toContain('▒')
    expect((await live($, 100, 5)).join('\n')).not.toContain('▒')
  })

  test('the probe stands in the title row on every tab: a blit answers only what is drawn', async ($, on) => {
    await session($, on)
    const ui = await $.ui.mount({ ...inline(60), surface: 'terminal' })
    for (const key of ['tab-live', 'tab-changes', 'tab-agents']) {
      await ui.press({ key })
      const title = ((await ui.drawn()) as { children: readonly Node[] }).children[0]
      expect(JSON.stringify(title)).toContain('"key":"probe"')
    }
    await ui.unmount()
  })

  test('the style without pictures draws no probe', { options: { noxStyle: 'klassisch' } }, async ($, on) => {
    await session($, on)
    const ui = await $.ui.mount({ ...inline(60), surface: 'terminal' })
    expect(await ui.find({ type: 'Image', key: 'probe' })).toBeUndefined()
    await ui.unmount()
  })

  test('a session seated inline learns from the probe in the title row, and its picture is swapped in place', async ($, on) => {
    const blits: NonNullable<World['blits']> = []
    const clock = await session($, on, { ...PICTURES, blits })
    expect(blits.some(blit => blit.key === 'probe')).toBe(true)
    const ui = await $.ui.mount({ ...inline(100), surface: 'terminal' })
    await clock.advance(3000)
    await ui.unmount()
    expect(blits.some(blit => blit.key === 'mini')).toBe(true)
  })

  test('the state beside it follows its hop: done, then ready; without it the caption\'s 30 s stay', async ($, on) => {
    const clock = await session($, on, PICTURES)
    await $.turn.complete({ turnId: 't3', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    expect((await live($, 100))[1]).toContain('STATUS · fertig')
    await clock.advance(10_000)
    expect((await live($, 100))[1]).toContain('STATUS · bereit')
    expect((await live($, 60))[1]).toMatch(/^fertig · /)
  })
})

describe('what does not fit is cut visibly', () => {
  test('too low for all five rows: the last ones go and the title row counts them', async ($, on) => {
    await session($, on)
    expect(await live($, 60, 3)).toEqual([`${TITLE}${'+2 ausgeblendet'.padStart(56 - TITLE.length)}`, 'arbeitet · ✎ bearbeitet view.tsx', `${HEARTS}  Woche · 67 % übrig · Reset Mi 00:00`])
    expect((await live($, 60, 1)).length).toBe(1)
    expect((await live($, 60, 1))[0]).toContain('+4 ausgeblendet')
    expect((await live($, 60, 5)).join('\n')).not.toContain('ausgeblendet')
  })

  test('too low for two columns the one column stands in, at any width', async ($, on) => {
    await session($, on)
    const rows = await live($, 100, 5)
    expect(rows.length).toBe(5)
    expect(rows[1]).toBe('arbeitet · ✎ bearbeitet view.tsx')
  })

  test('where the count does not fit noxdeck gives way, then its word', async ($, on) => {
    await session($, on)
    expect((await live($, 44, 3))[0]).toBe('  Changes  Agents  Live  +2 ausgeblendet')
    expect((await live($, 40, 3))[0]).toMatch(/ Live +\+2$/)
  })

  test('narrower than the tabs the count keeps a place in their second row', async ($, on) => {
    await session($, on)
    const rows = await live($, 28, 3)
    expect(rows.length).toBe(3)
    expect(rows[1]).toBe(' +3')
  })

  test('a file too long for its row, cut with an ellipsis', async ($, on) => {
    await session($, on)
    await $.tool.call({ tool: 'Edit', file_path: `/proj/${'long-name-'.repeat(6)}.tsx`, old_string: 'a', new_string: 'b' })
    expect((await live($, 60))[1]).toMatch(/^arbeitet · ✎ bearbeitet long-name-.*…$/)
    expect((await live($, 80))[2]?.slice(0, 34)).toMatch(/^✎ bearbeitet long-name-.*…$/)
  })

  test('RADAR in one row: what fits, the rest counted; a first entry too long for it cut, the count kept', async ($, on) => {
    await session($, on)
    for (const file of ['model.ts', 'radar.ts', 'themes.ts', 'strings.ts']) await $.tool.call({ tool: 'Read', file_path: `/proj/hooks/${file}` })
    const row = (await live($, 60)).at(-1)
    expect(row).toMatch(/^RADAR · Hotspots \S+ 1×, \S+ 1× · \+\d$/)
    const narrow = (await live($, 36)).at(-1)
    expect(narrow).toMatch(/^RADAR · Hotspots .*\+\d$/)
  })

  test('RADAR with nothing to note says so', async ($, on) => {
    engine(on)
    await start($)
    expect((await live($, 60)).at(-1)).toBe('RADAR · keine Auffälligkeiten')
  })

  test('PLAN in RADAR\'s place: done of all, the running step, the others counted; the step gives way, the count stays', async ($, on) => {
    await session($, on, { tools: ['TodoWrite'] })
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
    expect((await live($, 100)).at(-1)).toBe('PLAN 2/4 · ◉ Wiring it into the header · +3 weitere Schritte')
    expect((await live($, 60)).at(-1)).toBe('PLAN 2/4 · ◉ Wiring it into the h… · +3 weitere Schritte')
    expect((await live($, 44)).at(-1)).toBe('PLAN 2/4 · ◉ Wiring it into the he… · +3')
  })

  test('no plan yet: one word', async ($, on) => {
    await session($, on, { tools: ['TodoWrite'] })
    expect((await live($, 60)).at(-1)).toBe('PLAN · kein Plan aktiv')
  })

  test('the loop warning takes RADAR\'s row and PLAN\'s, and stays when rows go', async ($, on) => {
    await session($, on)
    await loop($)
    const warning = '⚠ dreht sich im Kreis: Bash · Run the tests (3×)'
    expect((await live($, 60)).at(-1)).toBe(warning)
    expect((await live($, 100)).at(-1)).toBe(warning)
    expect((await live($, 60, 2))[1]).toBe(warning)
    expect((await live($, 60, 2))[0]).toContain('+3 ausgeblendet')
    expect((await live($, 40)).at(-1)).toBe('⚠ dreht sich im Kreis: Bash · … (3×)')
  })

  test('the loop warning stands over a plan too', async ($, on) => {
    await session($, on, { tools: ['TodoWrite'] })
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
    await loop($)
    expect((await live($, 100)).at(-1)).toBe('⚠ dreht sich im Kreis: Bash · Run the tests (3×)')
  })

  test('a limit past its reset says so', async ($, on) => {
    const clock = await session($, on, { rateLimits: [{ kind: 'seven_day', percentUsed: 33, resetsAt: new Date(1_100_000).toISOString() }] })
    await clock.advance(200_000)
    expect(await live($, 60)).toContain('Woche · zurückgesetzt')
    const wide = (await live($, 100)).join('\n')
    expect(wide).toContain('Woche · zurückgesetzt')
    expect(wide).not.toContain('Reset ')
  })

  test('off a subscription: no limit row, nothing in its place', async ($, on) => {
    await session($, on, { rateLimits: [] })
    expect((await live($, 60)).length).toBe(4)
  })

  test('not measured yet: CONTEXT says so', async ($, on) => {
    await session($, on, { isMeasured: false })
    expect(await live($, 60)).toContain('Context noch nicht gemessen')
  })

  test('an approval waits in the accent, in both views', async ($, on) => {
    on('classic.PermissionRequest', () => ({}))
    await session($, on)
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'x' } })
    const accent = async (terminal: number) => {
      const ui = await $.ui.mount({ ...inline(terminal), surface: 'terminal' })
      const texts = await ui.findAll({ type: 'Text' })
      await ui.unmount()
      return texts.some(found => found.props.color === 'claude' && /Freigabe/.test(String((found as unknown as { text: string }).text)))
    }
    expect(await accent(60)).toBe(true)
    expect(await accent(100)).toBe(true)
  })
})

describe('Changes and Agents inline', () => {
  async function tab($: Engine, key: 'tab-changes' | 'tab-agents', terminal: number, bodyRows: number): Promise<string[]> {
    const ui = await $.ui.mount({ ...inline(terminal, bodyRows), surface: 'terminal' })
    await ui.press({ key })
    const rows = await rowsOf(ui, terminal, bodyRows)
    await ui.unmount()
    return rows
  }

  const FILES = ['a', 'b', 'c', 'd', 'e', 'f'].map(name => `/proj/src/${name}.ts`)

  async function changed($: Engine, on: On) {
    engine(on)
    const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' a', '+b'] }
    on('tool.call', (_, e) => (e.tool === 'Edit' ? { result: { filePath: e.file_path, structuredPatch: [hunk], originalFile: 'x' } } : READ_RESULT))
    await start($)
    for (const file_path of FILES) await $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })
  }

  test('Changes: the title row, a head, the files that fit, the rest counted, no frame', async ($, on) => {
    await changed($, on)
    const rows = await tab($, 'tab-changes', 60, 5)
    expect(rows.length).toBe(5)
    expect(rows[0]).toContain('noxdeck')
    expect(rows[1]).toBe('CHANGES  6 Dateien · +6 −0')
    expect(rows[2]).toMatch(/^src\/[af]\.ts +\+1 −0$/)
    expect(rows[4]).toBe('+4 weitere Dateien')
  })

  test('Changes: where all fit, no count', async ($, on) => {
    await changed($, on)
    const rows = await tab($, 'tab-changes', 60, 12)
    expect(rows.length).toBe(8)
    expect(rows.join('\n')).not.toContain('weitere')
  })

  test('Changes: nothing yet, in a word; no room but the title row: the count says so', async ($, on) => {
    engine(on)
    await start($)
    expect((await tab($, 'tab-changes', 60, 12))[1]).toBe('CHANGES · noch keine Änderungen')
    expect((await tab($, 'tab-changes', 60, 1))[0]).toContain('+1 ausgeblendet')
  })

  test('Changes: files without lines where a row is left, else in the title row\'s count', async ($, on) => {
    engine(on)
    on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/proj/x.md', hunks: [] }], moreFiles: 3, unavailable: true } } }))
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'make fmt' })
    expect((await tab($, 'tab-changes', 60, 4))[3]).toBe('+3 Dateien ohne Zeilen (n/a)')
    expect((await tab($, 'tab-changes', 60, 3))[0]).toContain('+1 ausgeblendet')
  })

  async function agents($: Engine, on: On) {
    const list: AgentInfo[] = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, description: `review part ${i}`, type: 'general-purpose', status: 'running' }))
    engine(on, { agents: list })
    on('agent.spawn', (_, e) => ({ model: 'm', agentId: list.find(one => one.description === e.description)?.id ?? 'x' }))
    await start($)
    for (const one of list) await $.agent.spawn({ ...SPAWN, description: one.description })
  }

  test('Agents: the title row, the compact view, the rest counted, no frame', async ($, on) => {
    await agents($, on)
    const rows = await tab($, 'tab-agents', 60, 5)
    expect(rows.length).toBe(5)
    expect(rows[1]).toMatch(/^ AGENTS /)
    expect(rows[4]).toBe(' +6 ◉')
  })

  test('Agents: no room but the title row: the count says so', async ($, on) => {
    await agents($, on)
    expect((await tab($, 'tab-agents', 60, 1))[0]).toContain('+1 ausgeblendet')
  })

  test('Agents: the way back stands on top while a row is left under it, else it is counted', async ($, on) => {
    await agents($, on)
    const viewing = (rows: number) => ({ ...inline(60, rows), props: { ...inline(60, rows).props, view: { agentId: 'a1' } } })
    const drawn = async (rows: number) => {
      const ui = await $.ui.mount({ ...viewing(rows), surface: 'terminal' })
      await ui.press({ key: 'tab-agents' })
      const found = await rowsOf(ui, 60, rows)
      await ui.unmount()
      return found
    }
    expect((await drawn(6)).join('\n')).toContain('review part 1')
    expect((await drawn(3))[0]).toContain('+1 ausgeblendet')
  })
})

describe('the height the pane asks for', () => {
  test('it asks for its rows inline; the dock\'s columns stay', async ($, on) => {
    const opened: NonNullable<World['opened']> = []
    engine(on, { opened })
    await start($)
    expect(opened.at(-1)).toMatchObject({ rows: 12, columns: 52 })
  })
})
