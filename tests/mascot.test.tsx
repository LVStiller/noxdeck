import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import {
  FRAME_MS,
  GLAD_MS,
  HOP_MS,
  mascotRows,
  MINI_ROWS,
  MINI_STILL,
  miniGridOf,
  miniPoseOf,
  miniRows,
  poseOf,
  sceneOf,
  SLEEP_AFTER_MS,
  STARTLE_MS,
  STILL,
  WAVE_MS,
  YAWN_AFTER_MS,
  gridOf,
} from '../hooks/mascot'
import type { Animations, Scene } from '../hooks/mascot'
import { themeOf } from '../hooks/themes'
import type { Activity, ContextSnapshot, Cues, MiniPose } from '../types'
import {
  SURFACES,
  test,
  PANE,
  K,
  P,
  engine,
  start,
  SPAWN,
  MOOD,
  captionOf,
  BAR,
  TWO_LINES,
  FRAMES,
  labelOf,
  MINI_FRAMES,
  miniLabelOf,
  TALL,
  SHORT,
  poseIn,
  owlOf,
  shownPose,
  posesOver,
  frameOfLabel,
  framesIn,
  RUN,
  READ_RESULT,
  HOUR,
  ANSWERED,
  BASH_OK,
  failedRun,
  textsAt,
  has,
} from './helpers'
import type { World, Size } from './helpers'

/** Four frames a second at most: the gap a pose holds at least, independent of the mod's own step. */
const MIN_FRAME_GAP_MS = 1000 / 4

describe('mascot Nox at rest', () => {
  test('breathes a pixel up and down, blinks, glances left and right', async ($, on) => {
    const clock = engine(on)
    await start($)
    const seen = await posesOver($, clock, 20_000)
    expect([...framesIn(seen)].sort()).toEqual(['blink', 'idle', 'lookLeft', 'lookRight'])
    expect(seen.has('idle')).toBe(true)
    expect(seen.has('idle+inhale')).toBe(true)
  })

  test('after a long rest it yawns, then sleeps with rising z; opening the pane wakes it', async ($, on) => {
    const clock = engine(on)
    await start($)
    await clock.advance(YAWN_AFTER_MS - 1000)
    expect(framesIn(await posesOver($, clock, 750))).not.toContain('yawn')
    await clock.advance(250)
    expect(frameOfLabel(await shownPose($))).toBe('yawn')
    await clock.advance(SLEEP_AFTER_MS - YAWN_AFTER_MS)
    const asleep = await posesOver($, clock, 6000)
    expect([...framesIn(asleep)].sort()).toEqual(['sleep', 'sleepRising', 'sleepStill'])
    expect([...asleep].some(label => label.includes('+inhale'))).toBe(true)
    await $.command.run({ command: 'noxdeck', args: '', ...RUN })
    await clock.advance(FRAME_MS)
    expect(['idle', 'blink', 'lookLeft', 'lookRight']).toContain(frameOfLabel(await shownPose($)))
  })

  test('agents at work keep it awake', async ($, on) => {
    const clock = engine(on, { agents: [{ id: 'a1', description: 'long task', type: 'general-purpose', status: 'running' }] })
    await start($)
    await clock.advance(SLEEP_AFTER_MS + 5000)
    expect(['idle', 'blink', 'lookLeft', 'lookRight']).toContain(frameOfLabel(await shownPose($)))
  })
})

describe('mascot Nox at work', () => {
  const working = async ($: Engine) => {
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
  }

  test('Read, WebFetch and WebSearch: the eyes scan left and right', async ($, on) => {
    const clock = engine(on)
    const outer = $
    const seen: Set<string>[] = []
    on('tool.call', async () => {
      seen.push(await posesOver(outer, clock, 2000))
      return READ_RESULT
    })
    await working($)
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    await $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'p' })
    await $.tool.call({ tool: 'WebSearch', query: 'q', mode: 'standard' })
    for (const one of seen) expect([...one].sort()).toEqual(['idle', 'lookLeft', 'lookRight'])
  })

  test('Edit and Write: it writes, the pencil going up and down', async ($, on) => {
    const clock = engine(on)
    const outer = $
    const seen: Set<string>[] = []
    on('tool.call', async () => {
      seen.push(await posesOver(outer, clock, 1500))
      return { result: { filePath: '/proj/a.ts', structuredPatch: [], originalFile: '' } }
    })
    await working($)
    await $.tool.call({ tool: 'Edit', file_path: '/proj/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/proj/b.ts', content: 'b' })
    for (const one of seen) expect([...one].sort()).toEqual(['write', 'write2'])
  })

  test('Bash: brows drawn together, a small steady movement', async ($, on) => {
    const clock = engine(on)
    const outer = $
    let seen = new Set<string>()
    on('tool.call', async () => {
      seen = await posesOver(outer, clock, 2000)
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    await working($)
    await $.tool.call({ tool: 'Bash', command: 'just test' })
    expect([...seen].sort()).toEqual(['focus', 'focus+inhale'])
  })

  test('between tool calls it thinks: dots over its head, one, two, three', async ($, on) => {
    const clock = engine(on)
    await working($)
    expect([...(await posesOver($, clock, 3000))].sort()).toEqual(['think1', 'think2', 'think3'])
  })

  test('a subagent starts: it waves, briefly, as its first turn begins', async ($, on) => {
    const clock = engine(on)
    on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
    await working($)
    await $.agent.spawn({ ...SPAWN, description: 'look around' })
    await $.turn.start({ text: SPAWN.prompt, turnId: 'a1-t', agentId: 'a1' })
    const waving = await posesOver($, clock, WAVE_MS - FRAME_MS)
    expect([...waving].sort()).toEqual(['wave1', 'wave2'])
    await clock.advance(FRAME_MS)
    expect(framesIn(await posesOver($, clock, 1500))).not.toContain('wave1')
  })
})

describe('mascot Nox on events', () => {
  test('a permission question is open: a bobbing ?, caption „braucht deine Freigabe“, until its call ends', async ($, on) => {
    const clock = engine(on)
    const outer = $
    let asking = new Set<string>()
    let caption: string | undefined
    // No settings hook decides: the dialog is the person's.
    on('classic.PermissionRequest', () => ({}))
    on('tool.call', async () => {
      await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
      asking = await posesOver(outer, clock, 1500)
      const ui = await outer.ui.mount({ ...PANE, surface: 'terminal' })
      caption = (await captionOf(ui))?.text
      await ui.unmount()
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect([...asking].sort()).toEqual(['question', 'questionLow'])
    expect(caption).toBe('braucht deine Freigabe')
    expect(framesIn(await posesOver($, clock, 1500))).not.toContain('question')
  })

  test('a question a settings hook answered: its answer passes unread, so the ? stands until its call ends', async ($, on) => {
    const clock = engine(on)
    const outer = $
    let asking = new Set<string>()
    on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }))
    on('tool.call', async () => {
      await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
      asking = await posesOver(outer, clock, 1500)
      return BASH_OK
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect([...asking].sort()).toEqual(['question', 'questionLow'])
    expect(framesIn(await posesOver($, clock, 1500))).not.toContain('question')
  })

  test('AskUserQuestion puts the question to the person: the ? shows while it waits', async ($, on) => {
    const clock = engine(on)
    const outer = $
    let seen = new Set<string>()
    on('tool.call', async () => {
      seen = await posesOver(outer, clock, 1000)
      return { result: { answers: {} } }
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
    expect([...seen].sort()).toEqual(['question', 'questionLow'])
  })

  test('the turn is done: a little hop, then a smile, then rest', async ($, on) => {
    const clock = engine(on)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    expect([...(await posesOver($, clock, HOP_MS - FRAME_MS))].sort()).toEqual(['happy', 'happyLanded'])
    expect([...(await posesOver($, clock, GLAD_MS - HOP_MS))]).toEqual(['happyLanded'])
    expect(framesIn(await posesOver($, clock, 2000))).not.toContain('happyLanded')
  })

  test('a tool fails: it jolts up with a drop of sweat, lands, and goes back to work', async ($, on) => {
    const clock = engine(on)
    on('tool.call', (_, e) => failedRun($, e))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'false' })
    const scared = await posesOver($, clock, STARTLE_MS - FRAME_MS)
    expect([...scared]).toEqual(['startled', 'startledLanded'].filter(label => scared.has(label)))
    expect(scared.has('startled') && scared.has('startledLanded')).toBe(true)
    await clock.advance(FRAME_MS)
    expect(frameOfLabel(await shownPose($))).toMatch(/^think/)
  })

  test('a slow hook beneath that answers after the call ended leaves no ?, main loop or subagent', async ($, on) => {
    const clock = engine(on)
    const outer = $
    const releases: ((answer: object) => void)[] = []
    on('classic.PermissionRequest', () => new Promise(resolve => releases.push(resolve)))
    on('tool.call', async (_, e) => {
      // The dialog opens, the person answers, the call runs and ends: the hook beneath is still busy.
      void outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' }, ...(e.agentId ? { agent_id: e.agentId } : {}) })
      await clock.advance(0)
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
    for (const release of releases) release({})
    await clock.advance(0)
    expect(framesIn(await posesOver($, clock, 1500))).not.toContain('question')
  })

  test('an ask that comes in after its subagent call ended goes with that agent\'s turn', async ($, on) => {
    const clock = engine(on)
    on('classic.PermissionRequest', () => ({}))
    await start($)
    await $.turn.start({ text: '', turnId: 'x', agentId: 'a1' })
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1' })
    expect(framesIn(await posesOver($, clock, 500))).toContain('question')
    await $.turn.complete({ turnId: 'x', agentId: 'a1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    expect(framesIn(await posesOver($, clock, 1000))).not.toContain('question')
  })

  test('two calls of one tool in parallel: the one that ends leaves the other\'s ? standing', async ($, on) => {
    const clock = engine(on)
    let release!: () => void
    const released = new Promise<void>(resolve => {
      release = resolve
    })
    // tool.check puts a.ts to a dialog and lets b.ts run; a hook answers the dialog once released.
    on('tool.check', (_, e) => ({ decision: (e.input as { file_path?: string }).file_path === '/proj/a.ts' ? 'ask' : 'allow' }))
    on('classic.PermissionRequest', async () => {
      await released
      return { decision: { behavior: 'allow' } }
    })
    on('tool.call', () => READ_RESULT)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    const asked = $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/b.ts' })
    expect([...(await posesOver($, clock, 1000))].sort()).toEqual(['question', 'questionLow'])
    release()
    await asked
    expect([...(await posesOver($, clock, 1500))].sort()).toEqual(['think1', 'think2', 'think3'])
  })

  test('a refusal is no tool error: no scare when the person says no or a hook denies', async ($, on) => {
    const clock = engine(on)
    const outer = $
    on('tool.check', (_, e) => ({ decision: (e.input as { command?: string }).command === 'hook says no' ? 'ask' : 'allow' }))
    on('classic.PermissionRequest', (_, e) =>
      (e.tool_input as { command?: string }).command === 'hook says no' ? { decision: { behavior: 'deny' } } : {},
    )
    on('tool.call', async (_, e) => {
      // The person answers no: the dialog was open as the call came back errored.
      await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: (e as { command?: string }).command } })
      return { isError: true, result: 'refused', text: 'The user refused.' }
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'person says no', tool_use_id: 'tu-person' })
    expect(framesIn(await posesOver($, clock, 1000))).not.toContain('startled')
    await $.tool.call({ tool: 'Bash', command: 'hook says no', tool_use_id: 'tu-hook' })
    expect(framesIn(await posesOver($, clock, 1000))).not.toContain('startled')
  })

  test('a call allowed at the dialog that then fails as it runs startles it; an interrupted one does not', async ($, on) => {
    const clock = engine(on)
    const outer = $
    on('classic.PermissionRequest', () => ({}))
    on('tool.call', async (_, e) => {
      const command = (e as { command?: string }).command ?? ''
      await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command } })
      await outer.classic.PostToolUseFailure({
        tool_name: 'Bash',
        tool_input: { command },
        tool_use_id: e.tool_use_id ?? '',
        error: 'exit 1',
        ...(command === 'sleep 99' ? { is_interrupt: true } : {}),
      })
      return { isError: true, result: 'exit 1', text: 'exit 1' }
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'false', tool_use_id: 'tu-false' })
    expect(framesIn(await posesOver($, clock, 1000))).toContain('startled')
    await clock.advance(STARTLE_MS)
    await $.tool.call({ tool: 'Bash', command: 'sleep 99', tool_use_id: 'tu-sleep' })
    expect(framesIn(await posesOver($, clock, 1000))).not.toContain('startled')
  })

  test('a deny by a rule or a PreToolUse hook is no tool error either', async ($, on) => {
    const clock = engine(on)
    on('tool.check', (_, e) =>
      (e.input as { command?: string }).command === 'rm -rf build' ? { decision: 'deny', reason: 'Bash(rm:*) is denied' } : { decision: 'allow' },
    )
    on('classic.PreToolUse', (_, e) => ((e as { command?: string }).command === 'curl evil' ? { deny: 'blocked by policy' } : {}))
    // Refused at the check, a call comes back errored with its tool never run (no
    // PostToolUseFailure); a tool that ran and failed has one.
    on('tool.call', (_, e) => {
      const command = (e as { command?: string }).command
      return command === 'rm -rf build' || command === 'curl evil' ? { isError: true, result: 'denied', text: 'denied' } : failedRun($, e)
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    const ruled = await $.tool.call({ tool: 'Bash', command: 'rm -rf build', tool_use_id: 'tu-rule' })
    expect(ruled.isError).toBe(true)
    expect(framesIn(await posesOver($, clock, 1000))).not.toContain('startled')
    const hooked = await $.tool.call({ tool: 'Bash', command: 'curl evil', tool_use_id: 'tu-hook' })
    expect(hooked.isError).toBe(true)
    expect(framesIn(await posesOver($, clock, 1000))).not.toContain('startled')
    // A plain failure with nothing of the kind on its way still startles.
    await $.tool.call({ tool: 'Bash', command: 'false', tool_use_id: 'tu-false' })
    expect(framesIn(await posesOver($, clock, 1000))).toContain('startled')
  })

  test('a subagent\'s Edit ends its own dialog', async ($, on) => {
    const clock = engine(on)
    const outer = $
    on('classic.PermissionRequest', () => ({}))
    on('tool.call', async (_, e) => {
      await outer.classic.PermissionRequest({ tool_name: 'Edit', tool_input: { file_path: '/proj/a.ts' }, agent_id: e.agentId ?? '' })
      return { result: { filePath: '/proj/a.ts', structuredPatch: [], originalFile: '' } }
    })
    await start($)
    await $.turn.start({ text: '', turnId: 'x', agentId: 'a1' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/a.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
    expect(framesIn(await posesOver($, clock, 1000))).not.toContain('question')
  })

  test('an ask the auto-mode check settled opens no dialog: a parallel dialog keeps its ?, and its refusal does not startle', async ($, on) => {
    const clock = engine(on)
    const outer = $
    // Every call runs; inside, the test replays the engine's own check (an ask) for its tool_use_id.
    let isReplay = false
    on('tool.check', () => ({ decision: isReplay ? 'ask' : 'allow' }))
    const replayAsk = async (id: string, url: string) => {
      isReplay = true
      await outer.tool.check({ tool: 'WebFetch', input: { url, prompt: 'p' }, tool_use_id: id } as never)
      isReplay = false
    }
    on('classic.PermissionRequest', () => ({}))
    let finishA!: () => void
    const aDone = new Promise<void>(resolve => {
      finishA = resolve
    })
    let answerB!: () => void
    const bAnswered = new Promise<void>(resolve => {
      answerB = resolve
    })
    on('tool.call', async (_, e) => {
      const url = (e as { url?: string }).url ?? ''
      await replayAsk(e.tool_use_id ?? '', url)
      if (url.endsWith('/a')) {
        // A: the auto-mode check allows it, no dialog; the fetch runs a while.
        await aDone
        return { result: { bytes: 1, code: 200, codeText: 'OK', result: 'a', durationMs: 1, url } }
      }
      // B: a dialog opens; the person says no.
      void outer.classic.PermissionRequest({ tool_name: 'WebFetch', tool_input: { url, prompt: 'p' } })
      await bAnswered
      return { isError: true, result: 'refused', text: 'The user refused.' }
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    const a = $.tool.call({ tool: 'WebFetch', url: 'https://x.test/a', prompt: 'p', tool_use_id: 'tu-A' })
    await clock.advance(0)
    const b = $.tool.call({ tool: 'WebFetch', url: 'https://x.test/b', prompt: 'p', tool_use_id: 'tu-B' })
    await clock.advance(0)
    finishA()
    await a
    expect(framesIn(await posesOver($, clock, 1000))).toContain('question')
    answerB()
    await b
    expect(framesIn(await posesOver($, clock, 1000))).not.toContain('startled')
  })

  test('a failed turn startles it too', async ($, on) => {
    const clock = engine(on)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'error' })
    expect(framesIn(await posesOver($, clock, 1000))).toContain('startled')
  })
})

describe('mascot Nox states', () => {
  // 130k of messages: 170k, past the 200k model's auto-compact threshold at 167k.
  const HOT = { messages: [130 * K] }
  // 85 % of the 5h window used: 15 % left.
  const TIRED = { rateLimits: [{ kind: 'five_hour', percentUsed: 85 }] }

  test('context over 80 % of the auto-compact threshold: a drop of sweat runs down beside the head, not over the pencil', async ($, on) => {
    const clock = engine(on, HOT)
    const outer = $
    let writing = new Set<string>()
    on('tool.call', async () => {
      writing = await posesOver(outer, clock, 2000)
      return { result: { filePath: '/proj/a.ts', structuredPatch: [], originalFile: '' } }
    })
    await start($)
    const resting = await posesOver($, clock, 4000)
    expect([...resting].some(label => label.endsWith('+drop0'))).toBe(true)
    expect([...resting].some(label => label.endsWith('+drop1'))).toBe(true)
    expect([...resting].some(label => !label.includes('+drop'))).toBe(true)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/a.ts', old_string: 'a', new_string: 'b' })
    expect([...writing].sort()).toEqual(['write', 'write2'])
  })

  test('context at 80 % of the threshold or less: no sweat', async ($, on) => {
    // 133k of the 167k threshold: 79,6 %.
    const clock = engine(on, { messages: [93 * K] })
    await start($)
    expect([...(await posesOver($, clock, 4000))].some(label => label.includes('+drop'))).toBe(false)
  })

  /** Whether Nox, and then the mini owl, show a drop over four seconds. */
  const sweats = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }) => [
    [...(await posesOver($, clock, 4000))].some(label => label.includes('+drop')),
    [...(await posesOver($, clock, 4000, SHORT))].some(label => label.includes('+drop')),
  ]

  test('both owls sweat past 80 % of the threshold /autocompact sets, though the window is far from full', async ($, on) => {
    // A 1M model compacting at 667k: 520k is 78 % of the way, 560k 84 % (56 % of the window).
    const clock = engine(on, {
      window: 1000 * K,
      autoCompact: { window: 700 * K, threshold: 667 * K, source: 'settings' },
      messages: [480 * K, 520 * K],
    })
    await start($)
    expect(await sweats($, clock)).toEqual([false, false])
    await $.session.measure({ context: { window: 1000 * K }, rateLimits: [], changed: ['context'] })
    expect(await sweats($, clock)).toEqual([true, true])
  })

  test('with auto-compaction off both owls sweat past 80 % of the window, as before', async ($, on) => {
    // 560k of 1M: 56 %; 820k: 82 %.
    const clock = engine(on, {
      window: 1000 * K,
      autoCompact: { window: 1000 * K, threshold: null, source: 'auto' },
      messages: [520 * K, 780 * K],
    })
    await start($)
    expect(await sweats($, clock)).toEqual([false, false])
    await $.session.measure({ context: { window: 1000 * K }, rateLimits: [], changed: ['context'] })
    expect(await sweats($, clock)).toEqual([true, true])
  })

  test('hot only past 80 %: of the threshold, of the window with auto-compaction off, never unmeasured', () => {
    const resting: Activity = { isWorking: false, hasTurnError: false, hasToolError: false, editing: null, lastEdited: null, answeredAt: null }
    const cues: Cues = {
      running: [], asking: [], startledAt: null, wavedAt: null, restingSince: 0, waitedMs: 0, waitingSince: null, isWaitApprox: false, approvals: 0,
    }
    /** A 1M window: the status line's measured fill (null before a response) and the breakdown's estimate beside it. */
    const filled = (measured: number | null, threshold: number | null, estimate = measured ?? 0): ContextSnapshot => ({
      exact: measured === null ? null : { tokens: measured, window: 1000 * K, percent: Math.round(measured / (10 * K)) },
      totalTokens: estimate,
      window: 1000 * K,
      sources: [],
      threshold,
      mcp: [],
      memory: [],
      skills: null,
    })
    const isHot = (context: ContextSnapshot | null) => sceneOf(resting, cues, [], context, null, 0).isHot
    // 80 % of 667k is 533,6k: at it no sweat, a token past it sweat.
    expect([isHot(filled(533_600, 667 * K)), isHot(filled(533_601, 667 * K))]).toEqual([false, true])
    // The measured fill decides where there is one, either way; before a response the breakdown's estimate.
    expect([isHot(filled(540 * K, 667 * K, 500 * K)), isHot(filled(500 * K, 667 * K, 540 * K)), isHot(filled(null, 667 * K, 540 * K))]).toEqual([
      true,
      false,
      true,
    ])
    // Auto-compaction off: the status line's whole percentage of the window, 80 at 800k and 804k, 81 at 810k.
    expect([isHot(filled(800 * K, null)), isHot(filled(804 * K, null)), isHot(filled(810 * K, null))]).toEqual([false, false, true])
    expect(isHot(null)).toBe(false)
  })

  test('5h limit under 20 %: tired at rest, heavy lids at work, the thought dots as ever', async ($, on) => {
    const clock = engine(on, TIRED)
    const outer = $
    let scanning = new Set<string>()
    on('tool.call', async () => {
      scanning = await posesOver(outer, clock, 1000)
      return READ_RESULT
    })
    await start($)
    expect([...framesIn(await posesOver($, clock, 12_000))].sort()).toEqual(['tired', 'tiredBlink'])
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    expect([...scanning].sort()).toEqual(['idle+drowsy', 'lookLeft+drowsy', 'lookRight+drowsy'])
    expect([...(await posesOver($, clock, 1500))].sort()).toEqual(['think1', 'think2', 'think3'])
  })

  test('5h limit at 20 % or more: not tired', async ($, on) => {
    const clock = engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 80 }] })
    await start($)
    expect(framesIn(await posesOver($, clock, 12_000))).not.toContain('tired')
  })

  test('no 5h window: tired by the week\'s, the limit STATUS shows', async ($, on) => {
    const clock = engine(on, { rateLimits: [{ kind: 'seven_day', percentUsed: 85 }] })
    await start($)
    expect([...framesIn(await posesOver($, clock, 12_000))].sort()).toEqual(['tired', 'tiredBlink'])
    await $.session.measure({ context: { window: 200 * K }, rateLimits: [{ kind: 'seven_day', percentUsed: 80 }], changed: ['rateLimits'] })
    expect(framesIn(await posesOver($, clock, 12_000))).not.toContain('tired')
  })

  test('a 5h window: tired by it alone, whatever the week has left', async ($, on) => {
    const clock = engine(on, { rateLimits: [{ kind: 'seven_day', percentUsed: 95 }, { kind: 'five_hour', percentUsed: 80 }] })
    await start($)
    expect(framesIn(await posesOver($, clock, 12_000))).not.toContain('tired')
    const both = [{ kind: 'five_hour', percentUsed: 85 }, { kind: 'seven_day', percentUsed: 5 }]
    await $.session.measure({ context: { window: 200 * K }, rateLimits: both, changed: ['rateLimits'] })
    expect([...framesIn(await posesOver($, clock, 12_000))].sort()).toEqual(['tired', 'tiredBlink'])
  })

  test('no window at all: never tired, a gateway\'s spend limit included', async ($, on) => {
    const clock = engine(on, { rateLimits: [{ kind: 'spend_limit', percentUsed: 99 }] })
    await start($)
    expect(framesIn(await posesOver($, clock, 12_000))).not.toContain('tired')
  })
})

describe('mascot Nox: the animations option, pausing, room', () => {
  const HOT_AND_READING = { messages: [130 * K] }

  test('ruhig: each state stands still, only the blink moves', { options: { animations: 'ruhig' } }, async ($, on) => {
    const clock = engine(on, HOT_AND_READING)
    const outer = $
    let reading = new Set<string>()
    let writing = new Set<string>()
    on('tool.call', async (_, e) => {
      if (e.tool === 'Read') reading = await posesOver(outer, clock, 12_000)
      else writing = await posesOver(outer, clock, 3000)
      return READ_RESULT
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    // Reading's still is the owl at rest, no scanning; the drop of sweat stands, it does not run.
    expect([...reading].sort()).toEqual(['blink+drop0', 'idle+drop0'])
    await $.tool.call({ tool: 'Edit', file_path: '/proj/a.ts', old_string: 'a', new_string: 'b' })
    // The pencil held still (no room for the drop beside it); between calls the last thought, no dots rising.
    expect([...writing]).toEqual(['write'])
    expect([...framesIn(await posesOver($, clock, 3000))]).toEqual(['think3'])
  })

  test('aus: the owl stands still and its pose is never written', { options: { animations: 'aus' } }, async ($, on) => {
    const clock = engine(on, HOT_AND_READING)
    let writes = 0
    on('state.set', { plugin: 'noxdeck', key: 'pose' }, (_, e, next) => {
      writes += 1
      return next(e)
    })
    await start($)
    const resting = await posesOver($, clock, 12_000)
    await $.turn.start({ text: '', turnId: 't1' })
    const working = await posesOver($, clock, 3000)
    expect(new Set([...resting, ...working])).toEqual(new Set(['idle']))
    expect(writes).toBe(0)
  })

  test('at most four frames a second, written only when the pose changes', async ($, on) => {
    expect(FRAME_MS).toBeGreaterThanOrEqual(MIN_FRAME_GAP_MS)
    const clock = engine(on)
    const outer = $
    let scanWrites = 0
    on('tool.call', async () => {
      const before = at.length
      await clock.advance(10_000)
      scanWrites = at.length - before
      return READ_RESULT
    })
    const at: number[] = []
    on('state.set', { plugin: 'noxdeck', key: 'pose' }, (_, e, next) => {
      at.push(clock.now())
      return next(e)
    })
    await start($)
    await clock.advance(20_000)
    const resting = at.length
    // At rest the owl changes a few times in 20 s, far fewer than the 80 steps.
    expect(resting).toBeGreaterThan(4)
    expect(resting).toBeLessThan(40)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(10_000)
    // Scanning changes the eyes on every step: no more than four writes a second.
    await outer.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    expect(scanWrites).toBeGreaterThan(20)
    expect(scanWrites).toBeLessThanOrEqual(10 * 4)
    const gaps = at.slice(1).map((time, i) => time - (at[i] ?? 0))
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MIN_FRAME_GAP_MS)
  })

  test('Nox exactly when the card fits, else the mini owl, on the terminal and off it; the caption goes with Nox', async ($, on) => {
    engine(on, TWO_LINES)
    await start($)
    // Nox shows only while all of Live fits with it: the pane's frame (4 rows,
    // 5 off the terminal), STATUS with the owl (11, 12 with a title row),
    // CONTEXT (15, 16) and RADAR's one line.
    const boundary = { terminal: 31, desktop: 34 } as const
    for (const surface of SURFACES) {
      expect(owlOf(await shownPose($, surface, { rows: boundary[surface] - 1, columns: 48 }))).toBe('mini')
      expect(owlOf(await shownPose($, surface, { rows: boundary[surface], columns: 48 }))).toBe('nox')
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: boundary[surface] - 1 } }, surface })
      expect(await captionOf(ui)).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: surface === 'terminal' ? '· bereit ' : ' · bereit' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('the animation pauses while the pane is not shown and goes on when it is', async ($, on) => {
    const world: World = {}
    const clock = engine(on, world)
    await start($)
    await clock.advance(FRAME_MS)
    const before = await shownPose($)
    world.pane = 'hidden'
    await $.turn.start({ text: '', turnId: 't1' })
    expect([...(await posesOver($, clock, 3000))]).toEqual([before])
    world.pane = 'shown'
    expect(framesIn(await posesOver($, clock, 1500))).toContain('think1')
  })
})

describe('mascot Nox: the drawing', () => {
  const REST: Scene = {
    isWorking: false,
    isBusy: false,
    tool: null,
    isAsking: false,
    startledAt: null,
    wavedAt: null,
    answeredAt: null,
    restingSince: 0,
    isHot: false,
    isTired: false,
    isLooping: false,
  }
  const PALETTE = ['rainbow_indigo', 'rate_limit_empty', 'rainbow_indigo_shimmer', 'clawd_background', 'chromeYellow']

  test('every frame is at most 16 × 12 pixels in five theme colors, drawn on both surfaces', async ($, on) => {
    for (const frame of FRAMES) {
      const grid = gridOf({ ...STILL, frame })
      expect(grid.length).toBe(12)
      for (const row of grid) expect(row).toMatch(/^[.BDLEA]{16}$/)
      const colors = new Set(
        mascotRows({ ...STILL, frame }, themeOf('classic'))
          .flat()
          .flatMap(run => [run.color, run.backgroundColor])
          .filter(color => color !== null),
      )
      for (const color of colors) expect(PALETTE).toContain(color)
    }
    engine(on)
    await start($)
    for (const surface of SURFACES) {
      expect(['idle', 'idle+inhale', 'blink', 'blink+inhale', 'lookLeft', 'lookLeft+inhale', 'lookRight', 'lookRight+inhale']).toContain(
        await shownPose($, surface),
      )
    }
  })

  test('breathing in lifts the body a pixel, the feet stay: the drawn breathe frame', () => {
    expect(gridOf({ ...STILL, isInhaling: true })).toEqual([
      '................',
      '.DB.......BD....',
      '..DBDDDDDBD.....',
      '..DBBBDBBBD.....',
      '.DBLLLBLLLBD....',
      '.DLAEABAEABD....',
      '.DLAAADAAABD....',
      '.DBDLLDLLDDD....',
      '.DBDLLLLLDBD....',
      '..DBDLLLDBD.....',
      '...DDLLLDD......',
      '...AA...AA......',
    ])
  })

  test('heavy lids sink the pupils a row; eyes turned up keep theirs', () => {
    const lids = gridOf({ ...STILL, frame: 'lookLeft', isDrowsy: true })
    expect(lids[6]).toBe('.DLDDDBDDDBD....')
    expect(lids[7]).toBe('.DLEAADEAABD....')
    expect(gridOf({ ...STILL, frame: 'think1', isDrowsy: true })).toEqual(gridOf({ ...STILL, frame: 'think1' }))
  })

  test('a blink lasts one step; every pose holds at least one step, so no more than four frames a second', () => {
    const scenes: Scene[] = [
      REST,
      { ...REST, isHot: true, isTired: true },
      { ...REST, isWorking: true, tool: 'read' },
      { ...REST, isWorking: true, tool: 'edit' },
      { ...REST, isWorking: true, tool: 'shell' },
      { ...REST, isWorking: true },
      { ...REST, isAsking: true },
      { ...REST, wavedAt: 3000, answeredAt: 1000, startledAt: 9000 },
    ]
    for (const animations of ['voll', 'ruhig'] as const satisfies readonly Animations[]) {
      for (const scene of scenes) {
        let last = ''
        let since = 0
        let blinks = 0
        for (let at = 0; at < 30_000; at += 50) {
          const label = labelOf(poseOf(scene, at, animations))
          if (label !== last) {
            if (at > 0) expect(at - since).toBeGreaterThanOrEqual(MIN_FRAME_GAP_MS)
            if (label.startsWith('blink')) blinks += 1
            last = label
            since = at
          }
        }
        if (scene === REST) expect(blinks).toBeGreaterThan(3)
      }
    }
  })

  test('the yawn comes after two minutes of rest, then sleep; aus is always the still owl', () => {
    expect(poseOf(REST, YAWN_AFTER_MS - 1, 'voll').frame).not.toBe('yawn')
    expect(poseOf(REST, YAWN_AFTER_MS, 'voll').frame).toBe('yawn')
    expect(poseOf(REST, SLEEP_AFTER_MS, 'voll').frame).toMatch(/^sleep/)
    expect(poseOf({ ...REST, isBusy: true }, SLEEP_AFTER_MS, 'voll').frame).not.toMatch(/^(sleep|yawn)/)
    for (let at = 0; at < 20_000; at += 250) {
      expect(poseOf({ ...REST, isWorking: true, tool: 'read', isHot: true }, at, 'aus')).toEqual(STILL)
    }
  })
})

// ---------------------------------------------------------------- the mini owl

describe('Mini-Nox: the small owl where the pane is short', () => {
  /** 68 % of the 5h window left, and its reset time: STATUS has three lines. */
  const LIMIT: World = {
    rateLimits: [{ kind: 'five_hour', percentUsed: 32, resetsAt: new Date(1_000_000 + 2 * HOUR).toISOString() }],
  }
  // 130k of messages: 170k, past the 200k model's auto-compact threshold at 167k.
  const HOT: World = { messages: [130 * K] }
  const propsAt = (size: Size) => ({ ...PANE.props, bodyColumns: size.columns, scroll: { offset: 0, bodyRows: size.rows } })

  /** STATUS's title beside the mini owl on the terminal: the state after its `·`, and the color it is drawn in. */
  async function titleAt($: Engine, size: Size = SHORT): Promise<{ text: string; color: unknown } | null> {
    const note = (await textsAt($, size.rows, size.columns)).find(found => /^· .* $/.test(found.text))
    return note === undefined ? null : { text: note.text.slice(2, -1), color: note.props.color ?? null }
  }

  test('Nox, the mini owl or none at 26, 32 and 40 rows and 40, 45 and 70 columns (39 too narrow)', async ($, on) => {
    engine(on, LIMIT)
    await start($)
    // Nox takes all of Live with it: the pane's frame (4 rows), STATUS with
    // Nox (12: the edit line, the 5h limit, its reset, six rows of owl and
    // the caption in its frame), CONTEXT (15 at 45 and 70 columns, where its
    // stats take two lines; 16 at 40, three) and RADAR's one line: 32 rows,
    // 33 at 40 columns. Below that the mini owl, from 40 columns; narrower, none.
    const found: Record<number, Record<number, string>> = {}
    for (const rows of [26, 32, 40]) {
      found[rows] = {}
      for (const columns of [39, 40, 45, 70]) found[rows][columns] = owlOf(await shownPose($, 'terminal', { rows, columns }))
    }
    expect(found).toEqual({
      26: { 39: 'none', 40: 'mini', 45: 'mini', 70: 'mini' },
      32: { 39: 'none', 40: 'mini', 45: 'nox', 70: 'nox' },
      40: { 39: 'nox', 40: 'nox', 45: 'nox', 70: 'nox' },
    })
    const statsLines = async (columns: number) =>
      (await textsAt($, 40, columns)).filter(found => /^(Cache Hit |noch ~)|seit Laden$/.test(found.text)).length
    expect([await statsLines(40), await statsLines(45), await statsLines(70)]).toEqual([3, 2, 2])
  })

  test('a resize swaps the owls on the drawing as it stands, either way, with no reload', async ($, on) => {
    const clock = engine(on, LIMIT)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    // One drawing, redrawn as the engine does when the pane's size changes.
    const ui = await $.ui.mount({ ...PANE, props: propsAt({ rows: 40, columns: 52 }), surface: 'terminal' })
    const shown = async () => {
      const texts = await ui.findAll({ type: 'Text' })
      return { owl: owlOf(poseIn(texts)), title: texts.find(found => /^· /.test(found.text))?.text ?? null, caption: has(texts, MOOD) }
    }
    const steps: readonly [Size, string][] = [
      [{ rows: 40, columns: 52 }, 'nox'],
      [{ rows: 26, columns: 52 }, 'mini'],
      [{ rows: 40, columns: 52 }, 'nox'],
      [{ rows: 31, columns: 52 }, 'mini'],
      [{ rows: 32, columns: 70 }, 'nox'],
      [{ rows: 26, columns: 39 }, 'none'],
      [{ rows: 26, columns: 45 }, 'mini'],
      [{ rows: 40, columns: 45 }, 'nox'],
    ]
    for (const [size, owl] of steps) {
      await ui.redraw(propsAt(size))
      expect({ size, ...(await shown()) }).toEqual({ size, owl, title: owl === 'mini' ? '· arbeitet ' : null, caption: owl !== 'mini' })
    }
    // The owl shown after a swap goes on moving on that drawing: the mini owl walks while Claude works.
    await ui.redraw(propsAt(SHORT))
    const seen = new Set<string>()
    for (let i = 0; i < 8; i += 1) {
      await clock.advance(FRAME_MS)
      seen.add(poseIn(await ui.findAll({ type: 'Text' })))
    }
    expect([...seen].sort()).toEqual(['mini:walkLeft', 'mini:walkRight'])
    await ui.unmount()
  })

  test('at rest it blinks; while Claude works it walks a column aside and back; the title names the state', async ($, on) => {
    const clock = engine(on)
    await start($)
    expect([...(await posesOver($, clock, 12_000, SHORT))].sort()).toEqual(['mini:blink', 'mini:idle'])
    expect(await titleAt($)).toEqual({ text: 'bereit', color: null })
    await $.turn.start({ text: '', turnId: 't1' })
    expect([...(await posesOver($, clock, 2000, SHORT))].sort()).toEqual(['mini:walkLeft', 'mini:walkRight'])
    expect(await titleAt($)).toEqual({ text: 'arbeitet', color: null })
    // The lines beside it are cut sooner, never into the owl's columns.
    const room = SHORT.columns - 4 - 4 - 8 - 1
    for (const found of await textsAt($, SHORT.rows, SHORT.columns)) {
      if (/^(✎|zuletzt|5h-Limit)/.test(found.text)) expect(found.text.length).toBeLessThanOrEqual(room)
    }
  })

  test('waited on: the feathers and the title in the accent; Freigabe! where the words do not fit', async ($, on) => {
    const clock = engine(on)
    const outer = $
    let asking = new Set<string>()
    const titles: unknown[] = []
    on('classic.PermissionRequest', () => ({}))
    on('tool.call', async () => {
      await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
      asking = await posesOver(outer, clock, 12_000, SHORT)
      titles.push(await titleAt(outer, { rows: 26, columns: 45 }), await titleAt(outer, { rows: 26, columns: 40 }))
      return BASH_OK
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect([...asking].sort()).toEqual(['mini:blink+ask', 'mini:idle+ask'])
    expect(titles).toEqual([
      { text: 'braucht deine Freigabe', color: 'claude' },
      { text: 'Freigabe!', color: 'claude' },
    ])
    // Its call over, the accent goes.
    expect([...(await posesOver($, clock, 1000, SHORT))].some(label => label.includes('+ask'))).toBe(false)
  })

  test('a failed call: it jumps, eyes wide, with a drop of sweat, then walks on', async ($, on) => {
    const clock = engine(on)
    on('tool.call', (_, e) => failedRun($, e))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'false' })
    expect([...(await posesOver($, clock, STARTLE_MS - FRAME_MS, SHORT))]).toEqual(['mini:startled+drop0'])
    expect(await titleAt($)).toEqual({ text: 'Fehler', color: null })
    await clock.advance(FRAME_MS)
    expect(await shownPose($, 'terminal', SHORT)).toMatch(/^mini:walk/)
  })

  test('the turn done: a hop of 2 s under „fertig“, then rest under „bereit“', async ($, on) => {
    const clock = engine(on)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ turnId: 't1', ...ANSWERED, durationMs: 1 })
    expect(await titleAt($)).toEqual({ text: 'fertig', color: null })
    expect([...(await posesOver($, clock, HOP_MS - FRAME_MS, SHORT))].sort()).toEqual(['mini:hop', 'mini:hopLanded'])
    await clock.advance(1000)
    expect(await titleAt($)).toEqual({ text: 'bereit', color: null })
    expect(['mini:idle', 'mini:blink']).toContain(await shownPose($, 'terminal', SHORT))
    // Nox's caption keeps its 30 s of „fertig“.
    const tall = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(tall))?.text).toBe('fertig')
    await tall.unmount()
  })

  test('after a long rest it sleeps, a z growing to a Z beside its head', async ($, on) => {
    const clock = engine(on)
    await start($)
    await clock.advance(SLEEP_AFTER_MS)
    expect([...(await posesOver($, clock, 3000, SHORT))].sort()).toEqual(['mini:sleep', 'mini:sleepRising'])
    const letters = (await textsAt($, SHORT.rows, SHORT.columns)).filter(found => /^[zZ]$/.test(found.text))
    expect(letters.map(found => found.props.color)).toEqual(['rainbow_indigo'])
  })

  test('context over 80 % of the auto-compact threshold: a drop of sweat runs down beside its head, whatever else it does', async ($, on) => {
    const clock = engine(on, HOT)
    await start($)
    const resting = await posesOver($, clock, 4000, SHORT)
    expect(['+drop0', '+drop1'].every(drop => [...resting].some(label => label.endsWith(drop)))).toBe(true)
    await $.turn.start({ text: '', turnId: 't1' })
    // At work it looks aside instead of stepping into the drop's column.
    const working = await posesOver($, clock, 4000, SHORT)
    expect([...framesIn(working)].sort()).toEqual(['mini:lookLeft', 'mini:walkRight'])
    expect([...working].some(label => label.includes('+drop'))).toBe(true)
    // Every state the mini owl has: the drop runs beside it, both heights, drawn whole.
    const REST: Scene = {
      isWorking: false, isBusy: false, tool: null, isAsking: false, startledAt: null, wavedAt: null,
      answeredAt: null, restingSince: 0, isHot: true, isTired: false, isLooping: false,
    }
    const scenes: Record<string, Scene> = {
      rest: REST,
      work: { ...REST, isWorking: true },
      asking: { ...REST, isAsking: true },
      startled: { ...REST, startledAt: 9_000 },
      hop: { ...REST, answeredAt: 9_000 },
      asleep: { ...REST, restingSince: -SLEEP_AFTER_MS },
    }
    for (const [name, scene] of Object.entries(scenes)) {
      const window = name === 'startled' || name === 'hop' ? [9_000, 10_750] : [9_000, 11_000]
      const drops = new Set<number>()
      for (let at = window[0] ?? 0; at < (window[1] ?? 0); at += FRAME_MS) {
        const pose = miniPoseOf(scene, at, 'voll')
        if (pose.drop === null) continue
        drops.add(pose.drop)
        const grid = miniGridOf(pose)
        expect({ name, at, drop: [grid[2 + pose.drop]?.[0], grid[3 + pose.drop]?.[0]] }).toEqual({ name, at, drop: ['B', 'L'] })
      }
      expect({ name, drops: [...drops].sort() }).toEqual({ name, drops: [0, 1] })
    }
  })

  test('ruhig: each state stands still, only the blink moves', { options: { animations: 'ruhig' } }, async ($, on) => {
    const clock = engine(on, HOT)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    // At work it walks no more; the drop of sweat stands beside it.
    expect([...(await posesOver($, clock, 12_000, SHORT))].sort()).toEqual(['mini:blink+drop0', 'mini:idle+drop0'])
  })

  test('aus: the mini owl stands still and its pose is never written', { options: { animations: 'aus' } }, async ($, on) => {
    const clock = engine(on, HOT)
    let writes = 0
    on('state.set', { plugin: 'noxdeck', key: 'miniPose' }, (_, e, next) => {
      writes += 1
      return next(e)
    })
    await start($)
    const resting = await posesOver($, clock, 6000, SHORT)
    await $.turn.start({ text: '', turnId: 't1' })
    const working = await posesOver($, clock, 3000, SHORT)
    expect(new Set([...resting, ...working])).toEqual(new Set(['mini:idle']))
    expect(writes).toBe(0)
  })

  test('a drawing reads the pose of the owl it shows only, and the animation pauses while the pane is hidden', async ($, on) => {
    const world: World = {}
    const clock = engine(on, world)
    const reads = { pose: 0, miniPose: 0 }
    on('state.get', { plugin: 'noxdeck', key: 'pose' }, (_, e, next) => {
      reads.pose += 1
      return next(e)
    })
    on('state.get', { plugin: 'noxdeck', key: 'miniPose' }, (_, e, next) => {
      reads.miniPose += 1
      return next(e)
    })
    await start($)
    const readsAt = async (size: Size) => {
      reads.pose = 0
      reads.miniPose = 0
      await textsAt($, size.rows, size.columns)
      return { ...reads }
    }
    // A write to the other owl's pose redraws nothing.
    expect(await readsAt(TALL)).toEqual({ pose: 1, miniPose: 0 })
    expect(await readsAt(SHORT)).toEqual({ pose: 0, miniPose: 1 })
    expect(await readsAt({ rows: 26, columns: 39 })).toEqual({ pose: 0, miniPose: 0 })
    await clock.advance(FRAME_MS)
    const before = await shownPose($, 'terminal', SHORT)
    world.pane = 'hidden'
    await $.turn.start({ text: '', turnId: 't1' })
    expect([...(await posesOver($, clock, 3000, SHORT))]).toEqual([before])
    world.pane = 'shown'
    expect(framesIn(await posesOver($, clock, 1500, SHORT))).toContain('mini:walkLeft')
  })

  test('the 5h line never cuts the share left: the number alone where the sentence does not fit', async ($, on) => {
    engine(on, LIMIT)
    await start($)
    const lineAt = async (size: Size) =>
      (await textsAt($, size.rows, size.columns)).find(found => found.props.wrap === 'truncate' && /^[♥♡]/.test(found.text))?.text
    const sentence = `♥ ♥ ♥ ♡ ♡  5h-Limit · ${P(68)} übrig`
    const short = `♥ ♥ ♥ ♡ ♡  ${P(68)}`
    // Beside the mini owl the line has the card less the owl's 8 columns and a gap; with Nox or none, the card.
    expect(await lineAt({ rows: 26, columns: 70 })).toBe(sentence)
    expect(await lineAt({ rows: 26, columns: 49 })).toBe(sentence)
    expect(await lineAt({ rows: 26, columns: 48 })).toBe(short)
    expect(await lineAt({ rows: 26, columns: 45 })).toBe(short)
    expect(await lineAt({ rows: 26, columns: 40 })).toBe(short)
    expect(await lineAt({ rows: 40, columns: 40 })).toBe(sentence)
    expect(await lineAt({ rows: 26, columns: 39 })).toBe(short)
    expect(await lineAt({ rows: 40, columns: 24 })).toBe(short)
  })

  test('the 5h line as a bar keeps the number too', BAR, async ($, on) => {
    engine(on, LIMIT)
    await start($)
    const line = (await textsAt($, 26, 45)).find(found => found.props.wrap === 'truncate' && /^▊/.test(found.text))?.text
    expect(line).toBe(`▊▊▊▊▊▊▊▊▊▊ ${P(68)}`)
  })

  test('the title says it shorter where the words do not fit: agents counted', async ($, on) => {
    engine(on, {
      agents: [
        { id: 'a1', description: 'one', type: 'general-purpose', status: 'running' },
        { id: 'a2', description: 'two', type: 'general-purpose', status: 'running' },
        { id: 'a3', description: 'three', type: 'general-purpose', status: 'pending' },
      ],
    })
    await start($)
    expect(await titleAt($, { rows: 26, columns: 52 })).toEqual({ text: '2 Agents laufen · 1 wartet', color: null })
    expect(await titleAt($, { rows: 26, columns: 40 })).toEqual({ text: '3 Agents', color: null })
  })

  test('every frame is at most 8 × 6 pixels in the owl\'s five colors and the accent; at most four frames a second', () => {
    const PALETTE = ['rainbow_indigo', 'rate_limit_empty', 'rainbow_indigo_shimmer', 'clawd_background', 'chromeYellow', 'claude']
    for (const frame of MINI_FRAMES) {
      for (const isAsking of [false, true]) {
        const grid = miniGridOf({ frame, isAsking, drop: null })
        expect(grid.length).toBe(6)
        for (const row of grid) expect(row).toMatch(isAsking ? /^[.CDLEA]{8}$/ : /^[.BDLEA]{8}$/)
        const runs = miniRows({ frame, isAsking, drop: null }, themeOf('classic'))
        expect(runs.length).toBe(MINI_ROWS)
        for (const color of runs.flat().flatMap(run => [run.color, run.backgroundColor])) {
          if (color !== null) expect(PALETTE).toContain(color)
        }
      }
    }
    expect(miniGridOf(MINI_STILL)).toEqual(['.DB...BD', '.DBBDBBD', '.BAEBEAB', '.DAADAAD', '..DLLLD.', '...A.A..'])
    const REST: Scene = {
      isWorking: false, isBusy: false, tool: null, isAsking: false, startledAt: null, wavedAt: null,
      answeredAt: null, restingSince: 0, isHot: false, isTired: false, isLooping: false,
    }
    const scenes: Scene[] = [
      REST,
      { ...REST, isHot: true },
      { ...REST, isWorking: true },
      { ...REST, isWorking: true, isHot: true },
      { ...REST, isAsking: true, isHot: true },
      { ...REST, wavedAt: 3000, answeredAt: 1000, startledAt: 9000 },
      { ...REST, restingSince: -SLEEP_AFTER_MS },
    ]
    const label = (pose: MiniPose) => miniLabelOf(pose)
    for (const animations of ['voll', 'ruhig', 'aus'] as const satisfies readonly Animations[]) {
      for (const scene of scenes) {
        let last = ''
        let since = 0
        for (let at = 0; at < 30_000; at += 50) {
          const now = label(miniPoseOf(scene, at, animations))
          if (now !== last) {
            if (at > 0) expect(at - since).toBeGreaterThanOrEqual(MIN_FRAME_GAP_MS)
            last = now
            since = at
          }
        }
      }
    }
    for (let at = 0; at < 20_000; at += 250) {
      expect(miniPoseOf({ ...REST, isWorking: true, isHot: true, isAsking: true }, at, 'aus')).toEqual(MINI_STILL)
    }
  })
})
