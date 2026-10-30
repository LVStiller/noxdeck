import { describe, expect, mock, test as kitTest } from 'claude-code/testing'
import type { Engine, TestRest } from 'claude-code/testing'
import type {
  AgentInfo,
  ContextWindowSource,
  On,
  PluginRegisterInput,
  SessionContextBreakdown,
  SessionRateLimit,
  TurnStepInput,
  SiteView,
  TurnStepResult,
  TurnUsage,
  ImageBlitArgs,
  UiBlitResult,
  UiViewResult,
} from 'claude-code'

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
import {
  bashChangesOf,
  freshOf,
  groupsOf,
  hiddenCount,
  isCachePath,
  MAX_AGENTS,
  MAX_OTHER_LOOPS,
  NO_HIDDEN,
  NO_LEDGER,
  NO_TALLY,
  potsOf,
  processedOf,
  projectPath,
  withAgent,
  withHidden,
  withLedgerStep,
} from '../hooks/model'
import { callKey, callLabel, hotspotsOf, NO_RADAR, normalizedCommand, resetClockOf, withFailure, withFileUses } from '../hooks/radar'
import {
  animationOf,
  cacheStats,
  COSTUMES,
  costumeDrawnAt,
  costumeOptionOf,
  DRAWN_COSTUMES,
  dropFits,
  FINE_FRAME_MS,
  fineMiniPoseOf,
  finePoseOf,
  fineStillOf,
  gridOf as fineGridOf,
  isDrawnCostume,
  lookFor,
  lookOf,
  MINI_FINE_COLUMNS,
  MINI_FINE_ROWS,
  MINI_PIXELS,
  miniSource,
  NOX_COLUMNS,
  NOX_PIXELS,
  NOX_ROWS,
  NOX_STATES,
  noxSource,
  PALETTES,
  poseIn as fineLookPose,
  poseKey,
  PROBE_SOURCE,
  rgbaOf,
  SCALE,
  stepsOf,
} from '../hooks/fine'
import type { Look, Owl } from '../hooks/fine'
import { MASK, maskSecrets } from '../hooks/secrets'
import { NOX_SPRITES } from '../hooks/sprites'
import { LOCALES, stringsOf } from '../hooks/strings'
import { themeOf } from '../hooks/themes'
import { cellsOf, wrappedRows } from '../hooks/view'
import type { Activity, AgentLedger, ContextSnapshot, Cues, FinePose, MascotFrame, MiniFrame, MiniPose, NoxCostume, NoxState, Pose } from '../types'

// Nothing sits beneath the plugin in a test: each `on` hook here stands for
// the engine. A call on `$` is answered `{ value }`; an event by its result.

const SURFACES = ['terminal', 'desktop'] as const

/**
 * The pane speaks English unless `language` says de. The tests here read
 * the German sentences, so each runs with `language: 'de'` unless it names a
 * language itself; `kitTest` runs one with the manifest's defaults.
 */
const GERMAN = { language: 'de' } as const
const test = (name: string, ...rest: TestRest): void =>
  rest.length === 1
    ? kitTest(name, { options: GERMAN }, rest[0])
    : kitTest(name, { ...rest[0], options: { ...GERMAN, ...rest[0].options } }, rest[1])

const PANE = {
  plugin: 'noxdeck',
  component: 'Pane',
  requestId: 'noxdeck',
  props: {
    title: 'noxdeck',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

const K = 1000
/** A German percentage, as the pane writes it: the number, a no-break space, the sign. */
const P = (n: number | string) => `${n}\u00a0%`

const used = (name: string, tokens: number, color: string) => ({ name, tokens, color, isDeferred: false, kind: 'used' as const })

/** The window the breakdown measures against and where auto-compaction runs, as the engine reports them. */
type AutoCompact = { window: number; threshold: number | null; source: ContextWindowSource }

/** A 200k model's own: compaction 33k short of its window. */
const OWN_200K: AutoCompact = { window: 200 * K, threshold: 167 * K, source: 'auto' }

function breakdown(messages: number, compact: AutoCompact = OWN_200K): SessionContextBreakdown {
  const total = messages + 18 * K + 12 * K + 6 * K + 4 * K
  return {
    categories: [
      used('System prompt', 4 * K, 'promptBorder'),
      used('System tools', 18 * K, 'inactive'),
      used('MCP tools', 12 * K, 'success'),
      used('Memory files', 6 * K, 'claude'),
      used('Messages', messages, 'permission'),
      { name: 'Free space', tokens: compact.window - total - 33 * K, color: 'promptBorder', isDeferred: false, kind: 'free' },
      { name: 'Autocompact buffer', tokens: 33 * K, color: 'inactive', isDeferred: false, kind: 'buffer' },
    ],
    totalTokens: total,
    maxTokens: compact.window,
    rawMaxTokens: compact.window,
    autocompactSource: compact.source,
    percentage: Math.round((total / compact.window) * 100),
    gridRows: [],
    model: 'claude-opus-5-5',
    memoryFiles: [
      { path: '/proj/CLAUDE.md', type: 'Project', tokens: 4200 },
      { path: '/home/me/.claude/CLAUDE.md', type: 'User', tokens: 1800 },
    ],
    mcpTools: Array.from({ length: 31 }, (_, i) => ({
      name: `mcp__linear__tool_${i}`,
      serverName: 'linear',
      tokens: i === 0 ? 390 : 387,
      isLoaded: true,
    })),
    agents: [],
    skills: { totalSkills: 24, includedSkills: 24, tokens: 2900, skillFrontmatter: [] },
    ...(compact.threshold === null ? {} : { autoCompactThreshold: compact.threshold }),
    isAutoCompactEnabled: compact.threshold !== null,
    apiUsage: null,
  }
}

type World = {
  messages?: number[]
  rateLimits?: SessionRateLimit[]
  agents?: AgentInfo[]
  /** false: the session has not been measured (no breakdown, no response yet). */
  isMeasured?: boolean
  /** false: a breakdown, but no response measured yet (a fresh or just compacted session). */
  hasResponse?: boolean
  /** The model's window: 200k by default */
  window?: number
  /** The compaction window and threshold: the 200k model's own by default */
  autoCompact?: AutoCompact
  /** shown, open behind another tab, or closed */
  pane?: 'shown' | 'hidden' | 'closed'
  /** breakdown rows beside the usual five */
  extra?: ReturnType<typeof used>[]
  /** MCP tools in place of linear's 31 loaded ones */
  mcpTools?: SessionContextBreakdown['mcpTools']
  /** The tools `$.tool.list()` names: none by default, so RADAR stands where PLAN would */
  tools?: string[]
  /** The session's project root: /proj by default */
  root?: string
  /**
   * How the terminal answers a blit: `ok` draws pictures (Ghostty, kitty);
   * `alt` draws the alt instead (the default: a terminal without pictures);
   * `tmux` holds them back for passthrough (`tmuxFix`: in other words, the
   * stable `fix` alone tells); `gone` has nothing mounted.
   */
  images?: 'ok' | 'alt' | 'tmux' | 'tmuxFix' | 'gone'
  /** Every blit, with the clock's time: pushed to when given. */
  blits?: (ImageBlitArgs & { at: number })[]
  /** Claude Code's Reduce motion setting. */
  isMotionReduced?: boolean
}

/** What the engine answers a blit, by how the terminal draws pictures (Claude Code 2.1.311's words). */
const BLIT_ANSWERS: Readonly<Record<NonNullable<World['images']>, UiBlitResult>> = {
  ok: {},
  alt: { deny: 'the Image draws its alt here: the terminal draws neither kitty placeholder images (no reply to the graphics query) nor iTerm2 inline images (not iTerm2)' },
  tmux: {
    deny: 'the Image draws its alt here: images inside tmux need tmux 3.3 or later with allow-passthrough and focus-events on',
    fix: 'tmux-passthrough',
  },
  tmuxFix: { deny: 'images are held back by tmux', fix: 'tmux-passthrough' },
  gone: { deny: 'no Image keyed nox is mounted at noxdeck' },
}

/** Stands for the engine beneath the plugin; registered before the test's first call on `$`. */
function engine(on: On, world: World = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  let measured = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'noxdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({
    value:
      world.pane === 'closed'
        ? []
        : [{ id: 'noxdeck', title: 'noxdeck', isShown: world.pane !== 'hidden', isFocused: false, isPlaced: true }],
  }))
  on('agent.list', () => ({ value: world.agents ?? [] }))
  on('tool.list', () => ({ value: (world.tools ?? []).map(name => ({ name, description: '', mcp: name.startsWith('mcp__') })) }))
  on('session.root', () => ({ value: world.root ?? '/proj' }))
  on('session.usage', () => {
    const series = world.messages ?? [76 * K]
    const messages = series[Math.min(measured, series.length - 1)] ?? 76 * K
    measured += 1
    const fill = breakdown(messages, world.autoCompact)
    fill.categories = [...fill.categories, ...(world.extra ?? [])]
    if (world.mcpTools !== undefined) fill.mcpTools = world.mcpTools
    const window = world.window ?? 200 * K
    return {
      value: {
        startedAt: 0,
        context:
          world.isMeasured === false
            ? { window }
            : world.hasResponse === false
              ? { window, breakdown: fill }
              : { window, tokens: fill.totalTokens, percent: Math.round((fill.totalTokens / window) * 100), breakdown: fill },
        rateLimits: world.rateLimits ?? [],
      },
    }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.blit', (_, e) => {
    if ('source' in e) world.blits?.push({ ...e, at: clock.now() })
    return { value: BLIT_ANSWERS[world.images ?? 'alt'] }
  })
  on('settings.read', () => ({ value: world.isMotionReduced === true ? { prefersReducedMotion: true } : {} }))
  return clock
}

const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

const KEPT = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

const TODOS = [
  { content: 'Add the toggle', status: 'completed', activeForm: 'Adding the toggle' },
  { content: 'Read the styles', status: 'completed', activeForm: 'Reading the styles' },
  { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' },
  { content: 'Wire it into the header', status: 'in_progress', activeForm: 'Wiring it into the header' },
] as const

const SPAWN = {
  tool_use_id: 'tu',
  prompt: 'not kept',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'm',
  background: true,
  fork: false,
} as const

const MOOD = /^(arbeitet …|bereit|braucht deine Freigabe|fragt dich|Fehler|fertig|\d+ Agents? (läuft|laufen|wartet|warten)( · \d+ (wartet|warten))?)$/

const MOOD_EN = /^(working …|ready|needs your approval|asking you|error|done|\d+ agents? (running|waiting)( · \d+ waiting)?)$/

/** A todo tool in the session: the PLAN card shows instead of RADAR. */
const WITH_TODO: World = { tools: ['TodoWrite'] }

type Found = { text: string; props: Record<string, unknown> }

/** Nox's caption: the state the STATUS card names after its 5h line (JETZT may say the same above it). */
async function captionOf(ui: { findAll: (q: { type: string }) => Promise<Found[]> }): Promise<Found | undefined> {
  const texts = await ui.findAll({ type: 'Text' })
  const limit = texts.findLastIndex(found => /^ ?5h[- ]limit · /i.test(found.text))
  return texts.slice(limit + 1).find(found => MOOD.test(found.text) || MOOD_EN.test(found.text))
}

/**
 * Credentials the masking tests feed in, put together at run time: no
 * literal in this file has a real token's form, so a secret scanner (GitHub
 * push protection) has nothing to report.
 */
const FAKE = {
  anthropic: 'sk-' + 'ant-api03-' + 'AbCdEf0123456789xyz',
  anthropicLong: 'sk-' + 'ant-api03-' + 'Zx9Qw8Er7Ty6' + 'Ui5Op4As3Df2Gh1',
  github: 'ghp_' + 'aaaaBBBBcccc' + 'DDDDeeee1234',
  awsKeyId: 'AKIA' + 'IOSFODNN7' + 'EXAMPLE',
  awsSecret: 'wJalr' + 'XUtnFEMI/' + 'K7MDENG/' + 'bPxRfiCYEXAMPLEKEY',
  jwtHeader: 'eyJ' + 'hbGciOiJIUzI1NiJ9',
  jwt: ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmN' + 'Hl0w5N_XgL0n3I9PlFUP0THsR8U'].join('.'),
  slackBot: 'xox' + 'b-' + '123456789012-abcdefghijkl',
  privateKey: '-----BEGIN OPENSSH ' + 'PRIVATE KEY----- b3BlbnNzaC1rZXk',
  hex: '3f786850e387550f' + 'dab836ed7e6dc881de23001b',
  base64: 'dGhpcyBpcyBhIHNl' + 'Y3JldCB2YWx1ZTEyMw==',
  discordToken: 'Zx9Qw8' + 'Er7Ty6Ui5Op4' + 'As3Df2Gh1Jk0LzXcVbNm',
  slackHook: 'https://hooks.slack.com/' + 'services/' + 'T024BE7LD/B01ABCDEF12/' + 'aBcDeFgHiJ1k' + 'LmNoPqRsTuVw',
  azure: 'lQ88Q~' + 'Ck2nL.vZ3y',
  bearer: 'abc.def' + '-123_456',
  githubHeader: '0123' + 'abcd',
}

/** The bar style of the 5h limit; hearts are the default. */
const BAR = { options: { limitStyle: 'bar' } } as const

/** The 5h limit bar's cells: the full ones in the accent, the empty ones in the track color. */
async function limitCells(ui: { findAll: (q: { type: string; text: RegExp }) => Promise<{ text: string; props: Record<string, unknown> }[]> }) {
  const runs = await ui.findAll({ type: 'Text', text: /^▊+$/ })
  const status = runs.slice(-2)
  const full = status.find(run => run.props.color === 'claude')?.text.length ?? 0
  const empty = status.find(run => run.props.color === 'subtle')?.text.length ?? 0
  return { full, empty }
}

describe('plan', () => {
  test('a TodoWrite list fills the PLAN card: running first, then open, then done, with x/y', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => ({ result: { oldTodos: [], newTodos: e.tool === 'TodoWrite' ? e.todos : [] } }))
    await start($)
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect((await ui.find({ type: 'Text', text: '2/4' }))?.text).toContain('2/4')
      const steps = (await ui.findAll({ type: 'Text' }))
        .map(found => found.text)
        .filter(text => /toggle|styles|tests|header/.test(text) && !/✓|○|◉/.test(text))
      expect(steps).toEqual(['Wiring it into the header', 'Run the tests', 'Add the toggle', 'Read the styles'])
      expect((await ui.find({ type: 'Text', text: '◉ ' }))?.props.color).toBe('claude')
      expect((await ui.find({ type: 'Text', text: '✓ ' }))?.props.color).toBe('success')
      expect((await ui.find({ type: 'Text', text: 'Read the styles' }))?.props.dimColor).toBe(true)
      await ui.unmount()
    }
  })

  test('the task tools build the plan too: create, start, delete', async ($, on) => {
    engine(on)
    let next = 0
    on('tool.call', (_, e) => {
      if (e.tool === 'TaskCreate') {
        next += 1
        return { result: { task: { id: String(next), subject: e.subject } } }
      }
      if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
      return { result: {} }
    })
    await start($)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Write the parser', description: 'd', activeForm: 'Writing the parser' })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Drop me', description: 'd' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'Writing the parser' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Drop me/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '0/1' })).toBeDefined()
    await ui.unmount()
  })
})

describe('context', () => {
  test('the CONTEXT card: measured header, grouped bar and legend, history, growth, table', async ($, on) => {
    // usage calls: session.start, the measure, two turn ends (one sample each), the compaction
    const clock = engine(on, { messages: [76 * K, 76 * K, 62 * K, 76 * K, 30 * K] })
    on('session.compact', (_, e) => ({ messages: e.messages, tokensBefore: 170 * K, tokensAfter: 40 * K }))
    await start($)
    await $.session.measure({ context: { window: 200 * K, tokens: 116 * K, percent: 58 }, rateLimits: [], changed: ['context'] })
    for (const turnId of ['t1', 't2']) {
      await $.turn.complete({
        turnId,
        answer: '',
        durationMs: 1,
        isAborted: false,
        reason: 'answer',
        usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, model: 'm' },
      })
    }

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      // Measured figures carry no ≈; the breakdown's estimates do.
      expect(await ui.find({ type: 'Text', text: `${P(58)} · 116k / 200k` })).toBeDefined()
      for (const [label, value] of [['messages', 38], ['tools', 9], ['mcp', 6], ['memory', 3], ['system', 2]] as const) {
        expect(await ui.find({ type: 'Text', text: `${label} ≈${P(value)}` })).toBeDefined()
      }
      expect(await ui.find({ type: 'Text', text: 'Ø +14k/Turn · Auto-Compact in ~4 Turns' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: P(84).padStart(6) })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '1 Server' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' · 31 Tools' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '≈12k' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /linear/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /CLAUDE\.md project/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '≈4,2k' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /24 gelistet/ })).toBeDefined()
      // 167k, the auto-compact threshold, less the 116k measured: ~51k left. No peak.
      expect(await ui.find({ type: 'Text', text: `Cache Hit ${P(90)} · noch ~51k bis Compact` })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Peak/ })).toBeUndefined()
      // Cache hits and compactions count from noxdeck's load: the line says so.
      expect(await ui.find({ type: 'Text', text: /^0× kompaktiert · seit Laden$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /ⓘ/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /main loop/ })).toBeUndefined()
      await ui.unmount()
    }

    await $.session.compact({ trigger: 'auto', messages: KEPT })
    await $.session.compact({ trigger: 'precompute', messages: KEPT })
    // Measured once the compaction is installed, after its chain returned; no history column for it.
    await clock.advance(1000)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    // Measured at 70k after compacting: ~97k left.
    expect(await ui.find({ type: 'Text', text: `Cache Hit ${P(90)} · noch ~97k bis Compact` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1× kompaktiert · seit Laden$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: `${P(35)} · 70k / 200k` })).toBeDefined()
    await ui.unmount()
  })

  test('a compaction window set with /autocompact: mark, line, forecast and what is left follow the engine\'s threshold', async ($, on) => {
    // A 1M model whose session compacts at 667k (/autocompact 700k): turns at 480k, 520k and 670k.
    engine(on, {
      window: 1000 * K,
      autoCompact: { window: 700 * K, threshold: 667 * K, source: 'settings' },
      messages: [360 * K, 440 * K, 480 * K, 630 * K],
    })
    await start($)
    const turn = (turnId: string) => $.turn.complete({ turnId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    await turn('t1')
    await turn('t2')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      // The header stays the status line's: against the model's whole window.
      expect(await ui.find({ type: 'Text', text: `${P(52)} · 520k / 1M` })).toBeDefined()
      // The mark at 667k of 1M: cell 26 of 40 (the model's own 967k put it at 38).
      const bar = (await ui.findAll({ type: 'Text' })).find(
        found => found.props.wrap === 'truncate' && found.text.length === 40 && /^█*│█*$/.test(found.text),
      )
      expect(bar?.text.indexOf('│')).toBe(26)
      // The dotted line and the history's scale at the threshold, the forecast to it.
      expect(await ui.find({ type: 'Text', text: P(67).padStart(6) })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Ø +40k/Turn · Auto-Compact in ~4 Turns' })).toBeDefined()
      // 667k less 520k: ~147k left, though the window has 480k free.
      expect(await ui.find({ type: 'Text', text: 'Cache Hit n/a · noch ~147k bis Compact' })).toBeDefined()
      await ui.unmount()
    }

    // Past 667k compaction is due, though the model's window is a third free.
    await turn('t3')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /· Auto-Compact fällig$/ })).toBeDefined()
    // 670k is past the threshold: nothing left, never a negative figure.
    expect(await ui.find({ type: 'Text', text: 'Cache Hit n/a · noch ~0 bis Compact' })).toBeDefined()
    await ui.unmount()
  })

  test('with auto-compaction off the stats say nothing about what is left', async ($, on) => {
    engine(on, { window: 1000 * K, autoCompact: { window: 1000 * K, threshold: null, source: 'auto' }, messages: [480 * K] })
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: `${P(52)} · 520k / 1M` })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: P(100).padStart(6) })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Ø n/a/Turn · Auto-Compact aus' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Cache Hit n/a · 0× kompaktiert' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /bis Compact|Peak/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('in English: ~51k left to Compact', { options: { language: 'en' } }, async ($, on) => {
    engine(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'Cache Hit n/a · ~51k left to Compact' })).toBeDefined()
    await ui.unmount()
  })

  test('nothing measured yet: short German states, never a made-up number', async ($, on) => {
    engine(on, { isMeasured: false })
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: 'Context noch nicht gemessen' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '5h-Limit · n/a' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'RADAR · keine Auffälligkeiten' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'kein Plan aktiv' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: '✎ noch keine Änderungen' })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('status', () => {
  test('the limit bar follows the 5h window, the edited file and the mascot follow the turn', BAR, async ($, on) => {
    const outer = $
    const clock = engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] })
    // While the Edit runs beneath the plugin, the pane already says so.
    const editingSeen: (string | undefined)[] = []
    on('tool.call', async (_, e) => {
      const ui = await outer.ui.mount({ ...PANE, surface: 'terminal' })
      // The STATUS card's line (JETZT lists the call itself as `✎ Edit …`).
      const line = await ui.find({ type: 'Text', text: /^✎ (bearbeitet|noch)/ })
      editingSeen.push(`${line?.text} ${String(line?.props.color)}`)
      await ui.unmount()
      if (e.tool === 'Bash') return { isError: true, result: 'exit 1', text: 'exit 1' }
      return { result: { filePath: '/proj/src/Toggle.tsx', structuredPatch: [], originalFile: '' } }
    })
    await start($)

    const caption = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const found = (await captionOf(ui))?.text
      await ui.unmount()
      return found
    }

    expect(await caption()).toBe('bereit')
    await $.turn.start({ text: '', turnId: 't1' })
    expect(await caption()).toBe('arbeitet …')
    await $.tool.call({ tool: 'Edit', file_path: '/proj/src/Toggle.tsx', old_string: 'a', new_string: 'b' })
    expect(editingSeen).toEqual(['✎ bearbeitet Toggle.tsx claude'])
    await $.tool.call({ tool: 'Bash', command: 'just test' })
    expect(await caption()).toBe('Fehler')
    // Claude is still at work in this turn: the file stays the one it is editing, bold in the accent.
    const during = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const editing = await during.find({ type: 'Text', text: '✎ bearbeitet Toggle.tsx' })
    expect(editing?.props.bold).toBe(true)
    expect(editing?.props.color).toBe('claude')
    expect(await during.find({ type: 'Text', text: /^zuletzt: / })).toBeUndefined()
    await during.unmount()
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    expect(await caption()).toBe('fertig')
    await clock.advance(31_000)
    expect(await caption()).toBe('bereit')
    await $.turn.start({ text: '', turnId: 't2' })
    await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, reason: 'error' })
    expect(await caption()).toBe('Fehler')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await limitCells(ui)).toEqual({ full: 7, empty: 3 })
      expect(await ui.find({ type: 'Text', text: ` 5h-Limit · ${P(70)} übrig` })).toBeDefined()
      const last = await ui.find({ type: 'Text', text: 'zuletzt: Toggle.tsx' })
      expect(last?.props.dimColor).toBe(true)
      expect(last?.props.bold).not.toBe(true)
      expect(await ui.find({ type: 'Text', text: /bearbeitet/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('the mascot blinks while waiting and moves while working', async ($, on) => {
    const clock = engine(on)
    await start($)
    const frames = async () => {
      const seen = new Set<string>()
      for (let i = 0; i < 6; i += 1) {
        const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
        seen.add(JSON.stringify(await ui.drawn()))
        await ui.unmount()
        await clock.advance(1000)
      }
      return seen.size
    }
    expect(await frames()).toBeGreaterThan(1)
    await $.turn.start({ text: '', turnId: 't1' })
    expect(await frames()).toBeGreaterThan(1)
  })

  test('a measured rate-limit move updates the limit bar', BAR, async ($, on) => {
    engine(on)
    await start($)
    await $.session.measure({
      context: { window: 200 * K },
      rateLimits: [{ kind: 'five_hour', percentUsed: 95 }],
      changed: ['rateLimits'],
    })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await limitCells(ui)).toEqual({ full: 1, empty: 9 })
    expect(await ui.find({ type: 'Text', text: ` 5h-Limit · ${P(5)} übrig` })).toBeDefined()
    await ui.unmount()
  })
})

describe('changes', () => {
  test('Edit, Write and Bash diffs add up per file; staged and failed calls do not count', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => {
      if (e.tool === 'Edit' && e.old_string === 'staged') return { result: { filePath: e.file_path, staged: true, structuredPatch: [] } }
      if (e.tool === 'Edit' && e.old_string === 'fails') return { isError: true, result: 'no match', text: 'no match' }
      if (e.tool === 'Edit') {
        const hunk = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: ['-a', '+b', '+c', ' d'] }
        return { result: { filePath: e.file_path, structuredPatch: [hunk], originalFile: 'a\nd\n' } }
      }
      if (e.tool === 'Write') return { result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }
      if (e.tool === 'Bash') {
        const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] }
        return { result: { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/proj/notes.md', hunks: [hunk] }], moreFiles: 0 } } }
      }
      return { result: {} }
    })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/proj/theme.css', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/theme.css', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/skip.css', old_string: 'staged', new_string: 'b' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/skip.css', old_string: 'fails', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/proj/src/Toggle.tsx', content: 'one\ntwo\nthree\n' })
    await $.tool.call({ tool: 'Bash', command: "sed -i '' s/x/y/ notes.md" })
    await $.command.run({
      command: 'noxdeck',
      args: 'changes',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 200 },
    })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: '3 Dateien · +8 −3' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'theme.css' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'src/Toggle.tsx' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'notes.md' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /skip\.css/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^\+4 −2$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^neu \+3 −0$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^\+1 −1$/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('cache files from Bash are counted, not listed; a real file from Bash and an Edit under node_modules are listed', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => {
      if (e.tool === 'Edit') {
        const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }
        return { result: { filePath: e.file_path, structuredPatch: [hunk], originalFile: 'a\n' } }
      }
      const hunk = { oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+a', '+b'] }
      const diff =
        e.tool === 'Bash' && e.command === 'pytest'
          ? {
              files: [],
              changedFiles: [
                '/proj/__pycache__/app.cpython-312.pyc',
                '/proj/tests/__pycache__/test_app.cpython-312-pytest-8.3.4.pyc',
                '/proj/.pytest_cache/v/cache/nodeids',
              ],
              moreFiles: 0,
            }
          : {
              files: [{ filePath: '/proj/models.py', created: true, hunks: [hunk] }],
              changedFiles: ['/proj/models.py', '/proj/__pycache__/gen.cpython-312.pyc'],
              moreFiles: 0,
            }
      return { result: { stdout: '', stderr: '', interrupted: false, bashEditDiff: diff } }
    })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/proj/node_modules/pkg/index.js', old_string: 'a', new_string: 'b' })
    let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ type: 'Text', text: 'node_modules/pkg/index.js' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ausgeblendet/ })).toBeUndefined()
    await ui.unmount()

    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    await $.tool.call({ tool: 'Bash', command: 'python gen.py' })
    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'models.py' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^neu \+2 −0$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'node_modules/pkg/index.js' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /pycache|pytest_cache|\.pyc$/ })).toBeUndefined()
    // pytest's three files, twice, and the generator's .pyc: four files.
    expect(await ui.find({ type: 'Text', text: '+4 Cache-Dateien ausgeblendet' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2 Dateien · +3 −1' })).toBeDefined()
    await ui.unmount()
  })

  test('in English: the cache files hidden under an empty list; files a command named no path for still count', { options: { language: 'en' } }, async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => {
      const diff =
        e.tool === 'Bash' && e.command === 'npm install'
          ? { files: [], changedFiles: ['/proj/node_modules/.package-lock.json'], moreFiles: 3 }
          : { files: [], changedFiles: ['/proj/.DS_Store', '/proj/.venv/bin/python'], moreFiles: 0 }
      return { result: { stdout: '', stderr: '', interrupted: false, bashEditDiff: diff } }
    })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'uv venv' })
    let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ type: 'Text', text: 'no edits yet' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+2 cache files hidden' })).toBeDefined()
    await ui.unmount()

    await $.tool.call({ tool: 'Bash', command: 'npm install' })
    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '+2 files without lines (n/a)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+3 cache files hidden' })).toBeDefined()
    await ui.unmount()
  })

  test('the cache line in both languages, one file and more', () => {
    expect(stringsOf('de').changes.cacheFiles(1)).toBe('+1 Cache-Datei ausgeblendet')
    expect(stringsOf('de').changes.cacheFiles(4)).toBe('+4 Cache-Dateien ausgeblendet')
    expect(stringsOf('en').changes.cacheFiles(1)).toBe('+1 cache file hidden')
    expect(stringsOf('en').changes.cacheFiles(4)).toBe('+4 cache files hidden')
  })

  test('cache paths: those folders anywhere in the path, .pyc, .pyo and .DS_Store; look-alikes are not', () => {
    const hidden = [
      '/p/__pycache__/app.cpython-312.pyc',
      '/p/.pytest_cache/v/cache/lastfailed',
      '/p/.mypy_cache/3.12/app.meta.json',
      '/p/.ruff_cache/0.6.9/12345',
      '/p/web/node_modules/left-pad/index.js',
      '/p/.venv/lib/python3.12/site-packages/x.py',
      '/p/.git/index',
      '/p/legacy/mod.pyc',
      '/p/legacy/mod.pyo',
      '/p/docs/.DS_Store',
      'C:\\p\\node_modules\\x\\index.js',
      'node_modules/x/y.js',
    ]
    const shown = [
      '/p/app.py',
      '/p/.github/workflows/ci.yml',
      '/p/.gitignore',
      '/p/venv/x.py',
      '/p/src/pycache.py',
      '/p/node_modules.md',
      '/p/docs/notes.pyc.md',
      '/p/.DS_Store.bak',
    ]
    expect(hidden.filter(path => !isCachePath(path))).toEqual([])
    expect(shown.filter(isCachePath)).toEqual([])
  })

  test('cache files count each path once; past the cap the oldest fall off the list and stay counted', () => {
    expect(bashChangesOf({ bashEditDiff: { files: [], changedFiles: ['/p/a.pyc', '/p/b.py'], moreFiles: 3 } })).toEqual({
      changes: [{ path: '/p/b.py', added: null, removed: null, isNew: false, isDeleted: false }],
      hidden: ['/p/a.pyc'],
      missed: 1,
    })
    let hidden = withHidden(NO_HIDDEN, ['/p/a.pyc', '/p/b.pyc', '/p/a.pyc'], 3)
    expect(hidden).toEqual({ paths: ['/p/a.pyc', '/p/b.pyc'], evicted: 0 })
    expect(withHidden(hidden, ['/p/b.pyc'], 3)).toBe(hidden)
    hidden = withHidden(hidden, ['/p/c.pyc', '/p/d.pyc'], 3)
    expect(hidden).toEqual({ paths: ['/p/c.pyc', '/p/d.pyc', '/p/a.pyc'], evicted: 1 })
    expect(hiddenCount(hidden)).toBe(4)
  })
})

describe('agents', () => {
  test('spawned agents show with German status and duration; the tab is switched by its button', async ($, on) => {
    const clock = engine(on, {
      agents: [{ id: 'a1', description: 'review diff', type: 'general-purpose', status: 'completed' }],
    })
    on('agent.spawn', (_, e) => ({ model: 'm', agentId: e.description === 'review diff' ? 'a1' : 'w7' }))
    await start($)
    await $.agent.spawn({ ...SPAWN, description: 'review diff' })
    await $.agent.spawn({ ...SPAWN, description: 'scan routes' })
    await $.turn.start({ text: '', turnId: 'a1-t', agentId: 'a1' })
    await $.turn.start({ text: '', turnId: 'w7-t', agentId: 'w7' })
    await clock.advance(65_000)
    await $.turn.complete({ turnId: 'a1-t', agentId: 'a1', answer: '', durationMs: 65_000, isAborted: false, reason: 'answer' })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.press({ key: 'tab-agents' })
      // No step of either was seen: what they processed is –, how long they ran is known.
      expect(await ui.find({ type: 'Text', text: '– 1:05' })).toBeDefined()
      // The running one's row: ◉ says it runs, no word; its figures in the finished one's columns.
      expect((await ui.find({ type: 'Button', key: 'w7' }))?.text).toMatch(/^◉ scan routes +– 1:05$/)
      expect(await ui.find({ type: 'Text', text: /^läuft/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: '1 läuft · 1 fertig' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /not kept/ })).toBeUndefined()
      await ui.press({ key: 'tab-live' })
      await ui.unmount()
    }
  })
})

describe('observer', () => {
  test('tool calls and compactions pass through unchanged, results come back as answered', async ($, on) => {
    engine(on)
    const seen: unknown[] = []
    const answer = { result: { filePath: '/proj/a.ts', structuredPatch: [], originalFile: 'x' } }
    on('tool.call', (_, e) => {
      seen.push(e)
      return answer
    })
    on('session.compact', (_, e) => {
      seen.push(e)
      return { messages: e.messages }
    })
    await start($)
    const sent = { tool: 'Edit' as const, file_path: '/proj/a.ts', old_string: 'a', new_string: 'b' }
    const got = await $.tool.call(sent)
    expect(seen[0]).toMatchObject(sent)
    expect(got.result).toEqual(answer.result)

    const compaction = { trigger: 'manual' as const, instructions: 'keep the plan', messages: KEPT }
    await $.session.compact(compaction)
    expect(seen[1]).toMatchObject(compaction)
  })

  test('the footer reads noxdeck · classic beside the engine\'s own mode labels', async ($, on) => {
    engine(on)
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>focus</Text>
    })
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'noxdeck', surface, component: 'SessionMode', props: { modes: ['focus'] } })
      expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: 'noxdeck · classic' }))?.props.color).toBe('claude')
      await ui.unmount()
    }
  })
})

describe('edge cases', () => {
  test('NotebookEdit counts (its success record has error: ""); timed-out diffs show n/a, not +0 −0', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => {
      if (e.tool === 'NotebookEdit') {
        return {
          result: {
            new_source: 'a\nB\nc',
            old_source: 'a\nb\nc',
            cell_type: 'code',
            language: 'python',
            edit_mode: 'replace',
            error: '',
            notebook_path: e.notebook_path,
            original_file: '{}',
            updated_file: '{}',
          },
        }
      }
      if (e.tool === 'Edit') return { result: { filePath: e.file_path, structuredPatch: [], originalFile: 'x' } }
      if (e.tool === 'Write') {
        return { result: { type: 'update', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: 'old' } }
      }
      return { result: {} }
    })
    await start($)
    await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/proj/a.ipynb', new_source: 'a\nB\nc' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/slow.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/proj/big.ts', content: 'new' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ type: 'Text', text: 'a.ipynb' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\+1 −1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'slow.ts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'big.ts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^n\/a$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+0 −0/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '3 Dateien · +1 −1 · unvollständig' })).toBeDefined()
    await ui.unmount()
  })

  test('a Bash diff flagged unavailable still lists its files, and unnamed files are counted', async ($, on) => {
    engine(on)
    on('tool.call', () => {
      const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' a', '+b'] }
      return {
        result: {
          stdout: '',
          stderr: '',
          interrupted: false,
          bashEditDiff: { files: [{ filePath: '/proj/x.md', hunks: [hunk] }], moreFiles: 3, unavailable: true },
        },
      }
    })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'make fmt' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ type: 'Text', text: 'x.md' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+3 Dateien ohne Zeilen (n/a)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '4 Dateien · +1 −0 · unvollständig' })).toBeDefined()
    await ui.press({ key: 'tab-live' })
    expect(await ui.find({ type: 'Text', text: 'zuletzt: x.md' })).toBeDefined()
    await ui.unmount()
  })

  test('an agent the list drops after it was listed running ends; the mascot stops working', async ($, on) => {
    const world: { agents: AgentInfo[] } = {
      agents: [{ id: 't1', description: 'teammate task', type: 'teammate', status: 'running' }],
    }
    const clock = engine(on, world)
    on('agent.spawn', () => ({ model: 'm', agentId: 't1' }))
    await start($)
    await $.agent.spawn({ ...SPAWN, description: 'teammate task', subagentType: 'teammate' })
    await $.turn.start({ text: '', turnId: 'x', agentId: 't1' })
    await clock.advance(2000)
    await $.turn.complete({ turnId: 'x', agentId: 't1', answer: '', durationMs: 2000, isAborted: false, reason: 'answer' })
    world.agents = []
    await clock.advance(2000)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('bereit')
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Text', text: '– 0:02' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 fertig' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /läuft/ })).toBeUndefined()
    await ui.unmount()
  })

  test('/resume starts the pane over, as /clear does', async ($, on) => {
    engine(on, WITH_TODO)
    on('tool.call', (_, e) => ({ result: { oldTodos: [], newTodos: e.tool === 'TodoWrite' ? e.todos : [] } }))
    on('session.end', (_, e) => ({ sessionId: e.sessionId }))
    await start($)
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
    await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'kein Plan aktiv' })).toBeDefined()
    await ui.unmount()
  })

  test('in a narrow pane the counter leaves the border for the card body', async ($, on) => {
    engine(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 30 }, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: ` ${P(58)} · 116k / 200k ` })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: `${P(58)} · 116k / 200k` })).toBeDefined()
    await ui.unmount()
  })

  test('the English locale translates sentences and states, not terms', { options: { language: 'en' } }, async ($, on) => {
    engine(on, { isMeasured: false })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('ready')
    expect(await ui.find({ type: 'Text', text: 'RADAR · nothing to note' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '5h limit · n/a' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' Live ' })).toBeDefined()
    await ui.unmount()
  })
})

describe('render widths', () => {
  for (const columns of [45, 70] as const) {
    test(`at ${columns} columns every row fits and the legend takes at most two lines`, async ($, on) => {
      engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 11 }], messages: [76 * K, 90 * K, 104 * K] })
      on('tool.call', (_, e) => ({ result: { oldTodos: [], newTodos: e.tool === 'TodoWrite' ? e.todos : [] } }))
      await start($)
      await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
      for (const turnId of ['t1', 't2']) {
        await $.turn.complete({ turnId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
      }
      const card = columns - 4 - 4
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface })
        const rows = (await ui.findAll({ type: 'Text' })).filter(found => found.props.wrap === 'truncate')
        const bar = rows.find(found => /^█+/.test(found.text))
        expect(bar?.text.length).toBe(card)
        const legend = rows.filter(found => found.text.includes('●'))
        expect(legend.length).toBeGreaterThan(0)
        expect(legend.length).toBeLessThanOrEqual(2)
        for (const label of ['messages', 'mcp', 'tools', 'memory', 'system']) {
          expect(legend.some(line => line.text.includes(label))).toBe(true)
        }
        for (const row of rows) expect(row.text.length).toBeLessThanOrEqual(card)
        expect(await ui.find({ type: 'Text', text: `${P(84)}`.padStart(6) })).toBeDefined()
        if (surface === 'terminal') {
          for (const title of [' noxdeck ', ' PLAN ', ' CONTEXT ', ' STATUS ']) {
            expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
          }
        }
        await ui.unmount()
      }
    })
  }
})

describe('review round two', () => {
  test('a pane hidden behind another tab keeps its clock: back in front, done turns to waiting', async ($, on) => {
    const world: World = { pane: 'hidden' }
    const clock = engine(on, world)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(3000)
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 3000, isAborted: false, reason: 'answer' })
    await clock.advance(5000)
    world.pane = 'shown'
    await clock.advance(31_000)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('bereit')
    await ui.unmount()
  })

  test('a 5h reading whose reset time has passed is not shown as current', async ($, on) => {
    const clock = engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 97, resetsAt: new Date(1_000_500).toISOString() }] })
    await start($)
    await clock.advance(1000)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '5h-Limit · zurückgesetzt' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /♥/ })).toBeUndefined()
    await ui.unmount()
  })

  test('the limit bar and its text agree: 80,5 % left is eight of ten cells and 81 %', BAR, async ($, on) => {
    engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 19.5 }] })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await limitCells(ui)).toEqual({ full: 8, empty: 2 })
    expect(await ui.find({ type: 'Text', text: ` 5h-Limit · ${P(81)} übrig` })).toBeDefined()
    await ui.unmount()
  })

  test('German plurals: two agents run', async ($, on) => {
    engine(on, {
      agents: [
        { id: 'a', description: 'one', type: 'Explore', status: 'running' },
        { id: 'b', description: 'two', type: 'Explore', status: 'running' },
      ],
    })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Text', text: ' 2 laufen ' })).toBeDefined()
    await ui.unmount()
  })

  test('a source under 1 % shows its estimate with a decimal and ≈; a legend too narrow says +N', async ($, on) => {
    engine(on, {
      extra: [used('Skills', 600, 'warning'), used('Custom agents', 300, 'permission'), used('Slash commands', 200, 'inactive')],
    })
    await start($)
    const wide = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 90 }, surface: 'terminal' })
    expect(await wide.find({ type: 'Text', text: `skills ≈${P('0,3')}` })).toBeDefined()
    expect(await wide.find({ type: 'Text', text: `other ≈${P('0,1')}` })).toBeDefined()
    await wide.unmount()
    const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 34 }, surface: 'terminal' })
    expect(await narrow.find({ type: 'Text', text: /^ \+\d$/ })).toBeDefined()
    await narrow.unmount()
  })
})

describe('layout after the target image', () => {
  /** The chart rows: as wide as the chart (the card's 40 cells less the 6 of the line's label), braille only. */
  const chartRows = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }) =>
    (await ui.findAll({ type: 'Text' })).filter(
      found => found.props.wrap === 'truncate' && found.text.length === 34 && /^[\u2800-\u28ff ]+$/.test(found.text),
    )

  test('the history draws braille bars, two turns a column, under a dotted threshold line in the accent', async ($, on) => {
    // Fills of 51 %, 58 % and 65 % against a threshold at 83,5 %: five, six and six of eight dots.
    engine(on, { messages: [76 * K, 62 * K, 76 * K, 90 * K] })
    await start($)
    for (const turnId of ['t1', 't2', 't3']) {
      await $.turn.complete({ turnId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    }
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const rows = await chartRows(ui)
    expect(rows.length).toBe(2)
    // Top row: one, two and two dots; bottom row full under all three turns.
    expect(rows[0]?.text).toBe(`⣠⡄${' '.repeat(32)}`)
    // Dot columns no turn has reached yet: a faint baseline dot, in the track color.
    expect(rows[1]?.text).toBe(`⣿⡇${'⣀'.repeat(32)}`)
    const bars = (await ui.findAll({ type: 'Text' })).filter(found => /^[\u2800-\u28ff]+$/.test(found.text))
    expect(bars.filter(found => found.props.color === 'claude').map(found => found.text)).toEqual(['⣠', '⡄', '⣿', '⡇'])
    expect(bars.filter(found => found.props.color === 'subtle').length).toBe(32)
    expect((await ui.find({ type: 'Text', text: '·'.repeat(34) }))?.props.color).toBe('claude')
    await ui.unmount()
  })

  test('the history stays two rows tall while every turn is low', async ($, on) => {
    // A fill of 21 % against a threshold at 83,5 %: two of eight dots, both in the bottom row.
    engine(on, { messages: [2 * K] })
    await start($)
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const rows = await chartRows(ui)
    expect(rows.length).toBe(2)
    expect(rows[0]?.text.trim()).toBe('')
    expect(rows[1]?.text.slice(0, 2)).toBe('⡄⣀')
    await ui.unmount()
  })

  test('the context bar: full cells in the sources\' pastels, the free window dark grey, the mark on it', async ($, on) => {
    engine(on)
    await start($)
    // Too short for Nox; the mini owl's full cells are STATUS's, drawn before its title.
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 26 } }, surface: 'terminal' })
    const texts = await ui.findAll({ type: 'Text' })
    const inContext = texts.slice(texts.findIndex(found => found.text === ' STATUS ') + 1)
    const bar = inContext.find(found => found.props.wrap === 'truncate' && /^█+/.test(found.text))
    expect(bar?.text.length).toBe(40)
    expect(bar?.text.replace('│', '')).toMatch(/^█+$/)
    const runs = inContext.filter(found => /^█+$/.test(found.text)).map(found => found.props.color)
    expect(runs).toEqual([
      'rainbow_blue',
      'rainbow_green',
      'rainbow_indigo',
      'rainbow_yellow',
      'rainbow_orange',
      'userMessageBackground',
      'userMessageBackground',
    ])
    // The auto-compact mark sits in the free window, on its dark grey, so the run stays whole.
    const mark = await ui.find({ type: 'Text', text: /^│$/ })
    expect(mark?.props.backgroundColor).toBe('userMessageBackground')
    expect((await ui.find({ type: 'Text', text: /^● $/ }))?.props.color).toBe('rainbow_blue')
    await ui.unmount()
  })

  test('MCP in one line: servers and tools, the tokens in the window or deferred', async ($, on) => {
    const tool = (serverName: string, i: number, isLoaded: boolean) => ({
      name: `mcp__${serverName}__tool_${i}`,
      serverName,
      tokens: 400,
      isLoaded,
    })
    const world: World = {
      mcpTools: [...Array.from({ length: 3 }, (_, i) => tool('linear', i, true)), ...Array.from({ length: 2 }, (_, i) => tool('github', i, false))],
    }
    engine(on, world)
    await start($)
    const mcpLine = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const found = (await ui.findAll({ type: 'Text', text: /^mcp / })).find(one => one.props.wrap === 'truncate-end')
      const deferred = await ui.find({ type: 'Text', text: 'deferred' })
      const value = (await ui.findAll({ type: 'Text', text: /^(≈[\d,]+k?|deferred)$/ }))[0]
      await ui.unmount()
      return { line: found?.text, value: value?.text, isDeferredDim: deferred?.props.dimColor }
    }
    expect(await mcpLine()).toEqual({ line: 'mcp    2 Server · 5 Tools', value: '≈1,2k', isDeferredDim: undefined })
    world.mcpTools = [tool('github', 0, false)]
    await $.session.measure({ context: { window: 200 * K }, rateLimits: [], changed: ['context'] })
    expect(await mcpLine()).toEqual({ line: 'mcp    1 Server · 1 Tool', value: 'deferred', isDeferredDim: true })
    world.mcpTools = []
    await $.session.measure({ context: { window: 200 * K }, rateLimits: [], changed: ['context'] })
    expect((await mcpLine()).line).toBe('mcp    keine')
  })

  test('the legend keeps a space after every bullet', async ($, on) => {
    engine(on)
    await start($)
    for (const columns of [45, 70]) {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface: 'terminal' })
      const lines = (await ui.findAll({ type: 'Text', text: /●/ })).filter(found => found.props.wrap === 'truncate')
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) expect(line.text).not.toMatch(/●[^ ]/)
      await ui.unmount()
    }
  })

  test('without a plan the PLAN card is a single line', async ($, on) => {
    engine(on, WITH_TODO)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'PLAN · kein Plan aktiv' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' PLAN ' })).toBeUndefined()
    await ui.unmount()
  })

  test('Nox where the pane has the height for it, else the mini owl, none where that is too narrow; the state always', async ($, on) => {
    engine(on)
    await start($)
    const shown = async (size: Size) => {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: size.columns, scroll: { offset: 0, bodyRows: size.rows } }, surface: 'terminal' })
      const texts = await ui.findAll({ type: 'Text' })
      const caption = (await captionOf(ui))?.text ?? null
      await ui.unmount()
      return { owl: owlOf(poseIn(texts)), caption, title: texts.find(found => /^· /.test(found.text))?.text ?? null }
    }
    expect(await shown(TALL)).toEqual({ owl: 'nox', caption: 'bereit', title: null })
    expect(await shown(SHORT)).toEqual({ owl: 'mini', caption: null, title: '· bereit ' })
    expect(await shown({ rows: 26, columns: 39 })).toEqual({ owl: 'none', caption: 'bereit', title: null })
  })
})

describe('state written by an older version (hot reload, /reload-plugins)', () => {
  // $.state outlives a reload; these are the shapes version 0.1 stored, without a shape tag.
  const OLD_CONTEXT = {
    percentage: 58,
    totalTokens: 116 * K,
    maxTokens: 200 * K,
    sources: [{ name: 'Messages', tokens: 76 * K, color: 'permission' }],
    threshold: 167 * K,
    mcp: [],
    memory: [],
    skills: null,
  }
  const OLD_USAGE = {
    history: [
      { tokens: 100 * K, maxTokens: 200 * K },
      { tokens: 116 * K, maxTokens: 200 * K },
    ],
    peak: 58,
    compactions: 0,
    cacheRead: 0,
    inputTotal: 0,
  }

  test('an old context snapshot (sources by name, no key) reads as absent instead of crashing the pane', async ($, on) => {
    engine(on, { isMeasured: false })
    // A call on $ is answered { value }: here the read, { value, version }, of what 0.1 stored.
    on('state.get', { plugin: 'noxdeck', key: 'context' }, () => ({ value: { value: OLD_CONTEXT, version: 1 } }) as never)
    on('state.get', { plugin: 'noxdeck', key: 'usage' }, () => ({ value: { value: OLD_USAGE, version: 1 } }) as never)
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: 'Context noch nicht gemessen' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a usage track up to 0.12 kept (with a peak) reads as absent; one kept by 0.13 is read', async ($, on) => {
    const kept = { history: [], compactions: 2, cacheRead: 0, inputTotal: 0 }
    let stored: unknown = { shape: 'noxdeck/6', value: { ...kept, peak: 116 * K, isPeakEstimate: false } }
    // A breakdown and no response yet: nothing writes the track, the pane draws what was kept.
    engine(on, { hasResponse: false })
    on('state.get', { plugin: 'noxdeck', key: 'usage' }, () => ({ value: { value: stored, version: 1 } }) as never)
    await start($)
    const stats = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const lines = (await ui.findAll({ type: 'Text', text: /^(Cache Hit|\d+× kompaktiert)/ })).map(found => found.text)
      await ui.unmount()
      return lines
    }
    // The breakdown's estimate, 116k, against the 167k threshold either way; the count tells which track was read.
    expect(await stats()).toEqual(['Cache Hit n/a · noch ~51k bis Compact', '0× kompaktiert · seit Laden'])
    stored = { shape: 'noxdeck/7', value: kept }
    expect(await stats()).toEqual(['Cache Hit n/a · noch ~51k bis Compact', '2× kompaktiert · seit Laden'])
  })
})

describe('hot reload from an older version', () => {
  // Every key any version so far read while drawing. On a reload the old
  // version's render may still be running, and the engine judges its reads by
  // the new module's scan: a key the new module never names is refused there
  // ("$.state.get refused: its hooks module does not refer to noxdeck.hasTodoTool").
  const READ_WHILE_DRAWING = [
    'tab', 'plan', 'context', 'usage', 'fiveHour', 'activity', 'changes', 'missedFiles', 'hiddenFiles', 'agents', 'root', 'now',
    'hasTodoTool', 'isDismissed', 'cues', 'pose', 'turn', 'pace', 'todoTools', 'agentBoard', 'agentFolds', 'isProcessedOpen',
  ]

  test('the module still names every key an earlier version read while drawing', async ($, on) => {
    const admitted: PluginRegisterInput[] = []
    on('plugin.register', (_, e) => {
      admitted.push(e)
      return { allow: true }
    })
    engine(on)
    await start($)
    const reads = admitted.find(one => one.name === 'noxdeck')?.uses.state?.reads ?? []
    for (const key of READ_WHILE_DRAWING) expect(reads).toContainEqual({ plugin: 'noxdeck', key })
  })
})

describe('legend at the pane width you use', () => {
  test('six sources, one under 1 %, all fit two lines at 45 columns with a space after each bullet', async ($, on) => {
    engine(on, { extra: [used('Skills', 1600, 'warning')] })
    await start($)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 45 }, surface: 'terminal' })
    const lines = (await ui.findAll({ type: 'Text', text: /● / })).filter(found => found.props.wrap === 'truncate')
    expect(lines.length).toBe(2)
    const legend = lines.map(line => line.text).join(' ')
    for (const label of [/msgs|messages/, /mcp/, /tools/, /mem/, /skill/, /sys/]) expect(legend).toMatch(label)
    expect(legend).not.toMatch(/\+\d/)
    expect(legend).not.toMatch(/●[^ ]/)
    await ui.unmount()
  })
})

describe('5h limit as hearts (default) or bar', () => {
  // 70 % left: four of five hearts, seven of ten cells.
  const LIMIT = { rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] }
  const limitLine = async (ui: { findAll: (q: { type: string; text: RegExp }) => Promise<{ text: string; props: Record<string, unknown> }[]> }) =>
    (await ui.findAll({ type: 'Text', text: /5h-Limit · / })).find(found => found.props.wrap === 'truncate')

  for (const columns of [45, 70] as const) {
    const card = columns - 4 - 4

    test(`hearts at ${columns} columns: ♥ coral, ♡ grey, a space after every heart, two before the text, the row inside the frame`, async ($, on) => {
      engine(on, LIMIT)
      await start($)
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface })
        const line = await limitLine(ui)
        expect(line?.text).toBe(`♥ ♥ ♥ ♥ ♡  5h-Limit · ${P(70)} übrig`)
        expect(line?.text).not.toMatch(/[♥♡][^ ]/)
        expect((line?.text.length ?? 0) <= card).toBe(true)
        expect((await ui.find({ type: 'Text', text: /^(♥ )+$/ }))?.props.color).toBe('claude')
        expect((await ui.find({ type: 'Text', text: /^(♡ )+$/ }))?.props.color).toBe('inactive')
        expect(await ui.find({ type: 'Text', text: /^▊+ 5h/ })).toBeUndefined()
        await ui.unmount()
      }
    })

    test(`bar at ${columns} columns: the ten cells as before, no hearts`, BAR, async ($, on) => {
      engine(on, LIMIT)
      await start($)
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface })
        const line = await limitLine(ui)
        expect(line?.text).toBe(`▊▊▊▊▊▊▊▊▊▊ 5h-Limit · ${P(70)} übrig`)
        expect((line?.text.length ?? 0) <= card).toBe(true)
        expect(await limitCells(ui)).toEqual({ full: 7, empty: 3 })
        expect(await ui.find({ type: 'Text', text: /[♥♡]/ })).toBeUndefined()
        await ui.unmount()
      }
    })
  }

  test('hearts follow the share left: none at 0 %, one while anything is left, five when full', async ($, on) => {
    const world = { rateLimits: [{ kind: 'five_hour', percentUsed: 100 }] }
    engine(on, world)
    await start($)
    const hearts = async (used: number) => {
      await $.session.measure({ context: { window: 200 * K }, rateLimits: [{ kind: 'five_hour', percentUsed: used }], changed: ['rateLimits'] })
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const text = (await limitLine(ui))?.text.split('5h')[0]
      await ui.unmount()
      return text
    }
    expect(await hearts(100)).toBe('♡ ♡ ♡ ♡ ♡  ')
    expect(await hearts(99)).toBe('♥ ♡ ♡ ♡ ♡  ')
    expect(await hearts(0)).toBe('♥ ♥ ♥ ♥ ♥  ')
  })
})

// ---------------------------------------------------------------- mascot

const FRAMES: readonly MascotFrame[] = [
  'idle', 'blink', 'lookLeft', 'lookRight', 'yawn', 'sleep', 'sleepRising', 'sleepStill', 'write', 'write2', 'focus',
  'wave1', 'wave2', 'think1', 'think2', 'think3', 'question', 'questionLow', 'happy', 'happyLanded', 'startled',
  'startledLanded', 'tired', 'tiredBlink',
]

/** A pose by name: the frame, then `+inhale`, `+drowsy`, `+drop0` or `+drop1` for what is laid over it. */
const labelOf = (pose: Pose) =>
  `${pose.frame}${pose.isInhaling ? '+inhale' : ''}${pose.isDrowsy ? '+drowsy' : ''}${pose.drop === null ? '' : `+drop${pose.drop}`}`

type Drawn = { text: string; color: unknown; backgroundColor: unknown }
const runsKey = (runs: readonly Drawn[]) =>
  JSON.stringify(runs.map(run => [run.text, run.color ?? null, run.backgroundColor ?? null]))

/**
 * Every pose the owl can take, by how the pane draws it: the plainest name
 * wins where two draw alike (lids on eyes that have none to lower).
 */
const POSE_BY_DRAWING = new Map<string, string>()
for (const frame of FRAMES) {
  for (const isDrowsy of [false, true]) {
    for (const isInhaling of [false, true]) {
      for (const drop of [null, 0, 1] as const) {
        const pose: Pose = { frame, isInhaling, isDrowsy, drop }
        const key = runsKey(mascotRows(pose, themeOf('classic')).flat())
        if (!POSE_BY_DRAWING.has(key)) POSE_BY_DRAWING.set(key, labelOf(pose))
      }
    }
  }
}

const MINI_FRAMES: readonly MiniFrame[] = [
  'idle', 'blink', 'walkLeft', 'walkRight', 'lookLeft', 'hop', 'hopLanded', 'startled', 'sleep', 'sleepRising',
]

/** A mini pose by name: `mini:` and the frame, then `+ask` and `+drop0` or `+drop1`. */
const miniLabelOf = (pose: MiniPose) =>
  `mini:${pose.frame}${pose.isAsking ? '+ask' : ''}${pose.drop === null ? '' : `+drop${pose.drop}`}`

/** Every pose the mini owl can take, by how the pane draws it (a drop with no room draws none). */
const MINI_POSE_BY_DRAWING = new Map<string, string>()
for (const frame of MINI_FRAMES) {
  for (const isAsking of [false, true]) {
    for (const drop of [null, 0, 1] as const) {
      const pose: MiniPose = { frame, isAsking, drop }
      const key = runsKey(miniRows(pose, themeOf('classic')).flat())
      if (!MINI_POSE_BY_DRAWING.has(key)) MINI_POSE_BY_DRAWING.set(key, miniLabelOf(pose))
    }
  }
}

/** The pane's size in a test: its body's rows and columns. */
type Size = { rows: number; columns: number }
const TALL: Size = { rows: 80, columns: 48 }
/** Too short for Nox, wide enough for the mini owl. */
const SHORT: Size = { rows: 26, columns: 48 }

/**
 * The owl among a drawing's texts, by its pose's name: Nox's (six rows),
 * the mini owl's as `mini:…` (three); `hidden` without one. An owl is its
 * first rows of cells, each a row Text followed by its runs.
 */
function poseIn(texts: readonly Found[]): string {
  const isRow = (found: Found) => found.props.wrap === 'truncate' && /^[▀▄█ zZ]+$/.test(found.text)
  const isRun = (found: Found) => found.props.wrap === undefined && /^([▀▄█ ]+|[zZ])$/.test(found.text)
  const first = texts.findIndex(isRow)
  let rows = 0
  const runs: Drawn[] = []
  for (const found of first < 0 ? [] : texts.slice(first)) {
    if (isRow(found)) rows += 1
    else if (isRun(found)) runs.push({ text: found.text, color: found.props.color, backgroundColor: found.props.backgroundColor })
    else break
  }
  if (rows === MINI_ROWS) return MINI_POSE_BY_DRAWING.get(runsKey(runs)) ?? 'mini:unknown'
  if (rows === Math.ceil(gridOf(STILL).length / 2)) return POSE_BY_DRAWING.get(runsKey(runs)) ?? 'unknown'
  return 'hidden'
}

/** Which owl a pose's name is of: Nox, the mini owl, or none. */
const owlOf = (label: string) => (label === 'hidden' ? 'none' : label.startsWith('mini:') ? 'mini' : 'nox')

/** The pose the STATUS card shows now, by name; `hidden` without an owl. */
async function shownPose($: Engine, surface: (typeof SURFACES)[number] = 'terminal', size: Size = TALL): Promise<string> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: size.columns, scroll: { offset: 0, bodyRows: size.rows } }, surface })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return poseIn(texts)
}

/** The poses the pane shows, step by step, over `ms`. */
async function posesOver($: Engine, clock: { advance: (ms: number) => Promise<void> }, ms: number, size: Size = TALL): Promise<Set<string>> {
  const seen = new Set<string>()
  for (let t = 0; t < ms; t += FRAME_MS) {
    await clock.advance(FRAME_MS)
    seen.add(await shownPose($, 'terminal', size))
  }
  return seen
}

const frameOfLabel = (label: string) => label.split('+')[0] ?? label
const framesIn = (seen: Set<string>) => new Set([...seen].map(frameOfLabel))

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const
/** Four frames a second at most: the gap a pose holds at least, independent of the mod's own step. */
const MIN_FRAME_GAP_MS = 1000 / 4
const READ_RESULT = { result: { type: 'text', file: { filePath: '/proj/a.ts', content: 'a', numLines: 1, startLine: 1, totalLines: 1 } } }

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

  test('a subagent starts: it waves, briefly', async ($, on) => {
    const clock = engine(on)
    on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
    await working($)
    await $.agent.spawn({ ...SPAWN, description: 'look around' })
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

  test('a question a settings hook answered opens no dialog: no ?', async ($, on) => {
    const clock = engine(on)
    on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    expect([...(await posesOver($, clock, 1500))].sort()).toEqual(['think1', 'think2', 'think3'])
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
    on('tool.call', () => ({ isError: true, result: 'exit 1', text: 'exit 1' }))
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
    on('classic.PostToolUseFailure', () => ({}))
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
    on('tool.call', () => ({ isError: true, result: 'exit 1', text: 'exit 1' }))
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
    engine(on)
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

// ---------------------------------------------------------------- Live and RADAR

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const ANSWERED = { answer: '', isAborted: false, reason: 'answer' } as const
const FAILED = { isError: true, result: 'exit 1', text: 'exit 1' } as const
const BASH_OK = { result: { stdout: '', stderr: '', interrupted: false } } as const

/** The cards from top to bottom, by their titles (a one-line card counts by its title). */
async function cardTitles(ui: { findAll: (q: { type: string }) => Promise<Found[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Text' })).map(found => found.text.trim()).filter(text => /^(PLAN|RADAR|CONTEXT|STATUS)$/.test(text))
}

/** The pane's texts on the terminal at `bodyRows` rows (and `bodyColumns` columns). */
async function textsAt($: Engine, bodyRows = 80, bodyColumns = 48): Promise<Found[]> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns, scroll: { offset: 0, bodyRows } }, surface: 'terminal' })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts
}

const has = (texts: readonly Found[], pattern: RegExp) => texts.some(found => pattern.test(found.text))

describe('the Live tab', () => {
  test('the tab is called Live; /noxdeck live opens it, and /noxdeck plan still does', async ($, on) => {
    engine(on)
    await start($)
    const titles = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const found = await cardTitles(ui)
      await ui.unmount()
      return found
    }
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: ' Live ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Plan & Context/ })).toBeUndefined()
    await ui.press({ key: 'tab-changes' })
    expect(await cardTitles(ui)).toEqual([])
    await ui.unmount()
    expect((await $.command.run({ command: 'noxdeck', args: 'plan', ...RUN }))?.text).toBe('noxdeck geöffnet: live.')
    expect(await titles()).toEqual(['STATUS', 'CONTEXT', 'RADAR'])
    await $.command.run({ command: 'noxdeck', args: 'agents', ...RUN })
    expect(await titles()).toEqual([])
    expect((await $.command.run({ command: 'noxdeck', args: 'live', ...RUN }))?.text).toBe('noxdeck geöffnet: live.')
    expect(await titles()).toEqual(['STATUS', 'CONTEXT', 'RADAR'])
    // A word that is no tab opens the pane as it is.
    expect((await $.command.run({ command: 'noxdeck', args: 'constructor', ...RUN }))?.text).toBe('noxdeck geöffnet.')
    expect(await titles()).toEqual(['STATUS', 'CONTEXT', 'RADAR'])
  })

  test('STATUS on top, CONTEXT, then RADAR; PLAN in RADAR\'s place while the session has a todo tool', async ($, on) => {
    const world: World = {}
    engine(on, world)
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await cardTitles(ui)).toEqual(['STATUS', 'CONTEXT', 'RADAR'])
      expect(await ui.find({ type: 'Text', text: 'RADAR · keine Auffälligkeiten' })).toBeDefined()
      await ui.unmount()
    }
    world.tools = ['Read', 'TaskCreate']
    await $.turn.start({ text: '', turnId: 't1' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await cardTitles(ui)).toEqual(['STATUS', 'CONTEXT', 'PLAN'])
      expect(await ui.find({ type: 'Text', text: /RADAR/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('the tool list decides at every main turn; a todo tool that answered keeps PLAN until /clear', async ($, on) => {
    const world: World = {}
    engine(on, world)
    on('tool.call', (_, e) => ({ result: { oldTodos: [], newTodos: e.tool === 'TodoWrite' ? e.todos : [] } }))
    on('session.end', (_, e) => ({ sessionId: e.sessionId }))
    await start($)
    const bottom = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const last = (await cardTitles(ui)).at(-1)
      await ui.unmount()
      return last
    }
    expect(await bottom()).toBe('RADAR')
    world.tools = ['TodoWrite']
    await $.turn.start({ text: '', turnId: 'a1', agentId: 'agent-1' })
    expect(await bottom()).toBe('RADAR')
    await $.turn.start({ text: '', turnId: 't1' })
    expect(await bottom()).toBe('PLAN')
    world.tools = []
    await $.turn.complete({ turnId: 't1', durationMs: 1, ...ANSWERED })
    await $.turn.start({ text: '', turnId: 't2' })
    expect(await bottom()).toBe('RADAR')
    // A subagent's TodoWrite fills no plan here; the main loop's does.
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS], agentId: 'agent-1' })
    expect(await bottom()).toBe('RADAR')
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
    expect(await bottom()).toBe('PLAN')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(await bottom()).toBe('RADAR')
  })

  test('the reset time under the 5h limit, while the reading stands; none without one', async ($, on) => {
    const resetsAt = 1_000_000 + 2 * HOUR
    const world: World = { rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: new Date(resetsAt).toISOString() }] }
    const clock = engine(on, world)
    await start($)
    const clockTime = new Date(resetsAt)
    const expected = `Reset ${String(clockTime.getHours()).padStart(2, '0')}:${String(clockTime.getMinutes()).padStart(2, '0')}`
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const texts = await ui.findAll({ type: 'Text' })
      const limit = texts.findIndex(found => /5h-Limit · /.test(found.text) && found.props.wrap === 'truncate')
      expect(texts[limit + 1 + texts.slice(limit + 1).findIndex(found => /^Reset /.test(found.text))]?.text).toBe(expected)
      expect((await ui.find({ type: 'Text', text: /^Reset \d\d:\d\d$/ }))?.props.dimColor).toBe(true)
      await ui.unmount()
    }
    // Past the reset the reading no longer stands, and neither does its time.
    for (let i = 0; i < 6; i += 1) await clock.advance(20 * MINUTE)
    await clock.advance(1000)
    const after = await textsAt($)
    expect(has(after, /^Reset /)).toBe(false)
    expect(has(after, /^5h-Limit · zurückgesetzt$/)).toBe(true)
  })
})

describe('the Live tab when the pane is short', () => {
  test('Nox goes first, STATUS keeps its lines; then RADAR loses its last rows; the loop warning stays on top', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => (e.tool === 'Bash' ? FAILED : READ_RESULT))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/src/a.ts' })
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Bash', command: 'just test', description: 'Run the tests' })
    // RADAR: the warning (two rows at this width), the failures, the hotspots, in its frame: 6 rows.
    // STATUS: the warning, the edit line, the limit, the caption in its frame: 7 rows, 13 with Nox;
    // with the mini owl beside the two lines instead of the caption, 7 as well.
    // The pane's frame takes 4, CONTEXT 15.
    const at = async (rows: number) => {
      const texts = await textsAt($, rows)
      return {
        owl: owlOf(poseIn(texts)),
        hasErrors: has(texts, /^Fehler 3 · /),
        hasHotspots: has(texts, /^Hotspots /),
        isWarningFirst: (texts.find(found => found.props.wrap === 'truncate-end')?.text ?? '') === '⚠ dreht sich im Kreis:',
        hasCaption: has(texts, MOOD),
      }
    }
    expect(await at(38)).toEqual({ owl: 'nox', hasErrors: true, hasHotspots: true, isWarningFirst: true, hasCaption: true })
    expect(await at(37)).toEqual({ owl: 'mini', hasErrors: true, hasHotspots: true, isWarningFirst: true, hasCaption: false })
    expect(await at(32)).toEqual({ owl: 'mini', hasErrors: true, hasHotspots: true, isWarningFirst: true, hasCaption: false })
    expect(await at(31)).toEqual({ owl: 'mini', hasErrors: true, hasHotspots: false, isWarningFirst: true, hasCaption: false })
    expect(await at(30)).toEqual({ owl: 'mini', hasErrors: false, hasHotspots: false, isWarningFirst: true, hasCaption: false })
    // No room for one RADAR row: no card at all, STATUS and CONTEXT whole.
    const none = await textsAt($, 28)
    expect(has(none, /^ RADAR $/)).toBe(false)
    expect(has(none, /^ CONTEXT $/) && has(none, /^ STATUS $/)).toBe(true)
  })

  test('a long plan loses its last steps first and counts them', async ($, on) => {
    engine(on, WITH_TODO)
    on('tool.call', (_, e) => ({ result: { oldTodos: [], newTodos: e.tool === 'TodoWrite' ? e.todos : [] } }))
    await start($)
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
    // PLAN: four steps in its frame, 6 rows; STATUS without Nox 5; frame 4; CONTEXT 15.
    expect(has(await textsAt($, 30), /^Read the styles$/)).toBe(true)
    const short = await textsAt($, 29)
    expect(has(short, /^Wiring it into the header$/)).toBe(true)
    expect(has(short, /^Run the tests$/)).toBe(true)
    expect(has(short, /^Read the styles$/)).toBe(false)
    expect(has(short, /^\+2 weitere Schritte$/)).toBe(true)
  })
})

describe('RADAR', () => {
  test('the same call failing three times in a row: a warning in the accent, at the top of STATUS and of RADAR', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => (e.tool === 'Bash' && e.command.includes('just') ? FAILED : READ_RESULT))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    const run = (command = 'just test --all') => $.tool.call({ tool: 'Bash', command, description: 'Run the tests' })
    await run()
    await run()
    expect(has(await textsAt($, 80, 70), /dreht sich/)).toBe(false)
    await run()
    const wide = await textsAt($, 80, 70)
    const warnings = wide.filter(found => found.text === '⚠ dreht sich im Kreis: Bash · Run the tests (3×)')
    expect(warnings.length).toBe(2)
    for (const one of warnings) expect([one.props.color, one.props.bold]).toEqual(['claude', true])
    // STATUS on top: the warning is the pane's first row.
    expect(wide.find(found => found.props.wrap === 'truncate-end')?.text).toBe('⚠ dreht sich im Kreis: Bash · Run the tests (3×)')
    // Where the line is too long it breaks after the colon.
    const narrow = await textsAt($)
    expect(narrow.filter(found => found.text === '⚠ dreht sich im Kreis:').length).toBe(2)
    expect(narrow.filter(found => found.text === 'Bash · Run the tests (3×)').length).toBe(2)
    await run()
    expect(has(await textsAt($, 80, 70), /Run the tests \(4×\)$/)).toBe(true)
    // Another call ends the run.
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    expect(has(await textsAt($, 80, 70), /dreht sich/)).toBe(false)
    // The same description is the same call, whatever its command.
    for (const command of ['just a', 'just b', 'just c']) await run(command)
    expect(has(await textsAt($, 80, 70), /^⚠ dreht sich im Kreis: Bash · Run the tests \(3×\)$/)).toBe(true)
    // Another description is another call.
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    for (const description of ['Run the tests', 'Run the unit tests', 'Run the tests']) {
      await $.tool.call({ tool: 'Bash', command: 'just test', description })
    }
    expect(has(await textsAt($, 80, 70), /dreht sich/)).toBe(false)
    // No description: the command without flags, environment, redirections and
    // filters is the call; shown only as „Bash-Befehl“.
    for (const command of ['just deploy', 'just deploy --prod', 'CI=1 just deploy -v 2>&1 | tail -5']) {
      await $.tool.call({ tool: 'Bash', command })
    }
    const bare = await textsAt($, 80, 70)
    expect(has(bare, /^⚠ dreht sich im Kreis: Bash-Befehl \(3×\)$/)).toBe(true)
    expect(has(bare, /just/)).toBe(false)
    // The turn ends with the warning standing; the next prompt starts a new attempt.
    await $.turn.complete({ turnId: 't1', durationMs: 1, ...ANSWERED })
    expect(has(await textsAt($, 80, 70), /dreht sich/)).toBe(true)
    await $.turn.start({ text: '', turnId: 't2' })
    expect(has(await textsAt($, 80, 70), /dreht sich/)).toBe(false)
  })

  test('the loose stage: a call that failed four times in one turn, whatever came between, dim in RADAR only', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => {
      if (e.tool === 'Bash') return FAILED
      return { result: { filePath: (e as { file_path?: string }).file_path ?? '', structuredPatch: [], originalFile: 'x' } }
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    // Test fails, Claude edits, the test fails again: never three in a row.
    const attempt = async (flag = '') => {
      await $.tool.call({ tool: 'Bash', command: `npm test${flag}`, description: 'Run the tests' })
      await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'a', new_string: 'b' })
    }
    for (const flag of ['', ' -- --watch=false', '']) await attempt(flag)
    const three = await textsAt($, 80, 70)
    expect(has(three, /gescheitert|dreht sich/)).toBe(false)
    expect(has(three, /^Fehler 3 · /)).toBe(true)
    await attempt()
    const four = await textsAt($, 80, 70)
    const rows = four.filter(found => found.text === '4× gescheitert: Run the tests')
    expect(rows.length).toBe(1)
    expect(rows[0]?.props.dimColor).toBe(true)
    expect(rows[0]?.props.color).toBeUndefined()
    expect(has(four, /dreht sich/)).toBe(false)
    // Not in STATUS: the pane's first row is STATUS's edit line, and the row sits under CONTEXT.
    expect(four.find(found => found.props.wrap === 'truncate-end')?.text).toBe('✎ bearbeitet auth.ts')
    const context = four.findIndex(found => found.text === ' CONTEXT ')
    expect(four.findIndex(found => found.text === '4× gescheitert: Run the tests')).toBeGreaterThan(context)
    await attempt()
    expect(has(await textsAt($, 80, 70), /^5× gescheitert: Run the tests$/)).toBe(true)
    // A new turn counts anew.
    await $.turn.complete({ turnId: 't1', durationMs: 1, ...ANSWERED })
    expect(has(await textsAt($, 80, 70), /^5× gescheitert/)).toBe(true)
    await $.turn.start({ text: '', turnId: 't2' })
    for (let i = 0; i < 3; i += 1) await attempt()
    expect(has(await textsAt($, 80, 70), /gescheitert/)).toBe(false)
  })

  test('both stages for one call: in a row the warning only; once a success breaks the row, the dim count', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => (e.tool === 'Bash' || e.tool === 'Edit' ? FAILED : READ_RESULT))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    for (let i = 0; i < 4; i += 1) await $.tool.call({ tool: 'Bash', command: 'just test' })
    const inRow = await textsAt($, 80, 70)
    expect(inRow.filter(found => found.text === '⚠ dreht sich im Kreis: Bash-Befehl (4×)').length).toBe(2)
    expect(has(inRow, /gescheitert/)).toBe(false)
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    await $.tool.call({ tool: 'Bash', command: 'just test --verbose' })
    const broken = await textsAt($, 80, 70)
    expect(has(broken, /dreht sich/)).toBe(false)
    expect(has(broken, /^5× gescheitert: Bash-Befehl$/)).toBe(true)
    // Any tool: by its name and the file's.
    for (let i = 0; i < 4; i += 1) {
      await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'x', new_string: 'y' })
      await $.tool.call({ tool: 'Read', file_path: '/proj/b.ts' })
    }
    expect(has(await textsAt($, 80, 70), /^4× gescheitert: Edit · auth\.ts$/)).toBe(true)
  })

  test('a Bash command as the same call: no flags, environment, redirections or filters', () => {
    expect(normalizedCommand('npm test')).toBe('npm test')
    expect(normalizedCommand('npm test -- --watch=false')).toBe('npm test')
    expect(normalizedCommand('CI=1 npm test 2>&1 | tail -20')).toBe('npm test')
    expect(normalizedCommand('pytest -x tests/ > out.txt')).toBe('pytest tests/')
    expect(normalizedCommand('cd /proj && FOO=1 npm test -v')).toBe('cd /proj && npm test')
    expect(normalizedCommand('npm test || echo failed')).toBe('npm test || echo failed')
    expect(normalizedCommand('npm run build')).not.toBe(normalizedCommand('npm run test'))
    // A flag's number or duration given apart goes with the flag.
    expect(normalizedCommand('go test -count 1 -timeout 120s ./...')).toBe('go test ./...')
    // Only the command a filter reads from is the call; the commands chained after it stay.
    expect(normalizedCommand('npm run build 2>&1 | tail -20 && npm test')).toBe('npm run build && npm test')
    expect(normalizedCommand('npm run build 2>&1 | tail -20 && npm test')).not.toBe(normalizedCommand('npm run build 2>&1 | tail -20 && npm run lint'))
    expect(normalizedCommand("cat <<'EOF' | python3\nprint(1)\nEOF")).not.toBe(normalizedCommand("cat <<'EOF' | python3\nimport os\nEOF"))
    const bash = (command: string, description?: string) => ({ command, ...(description === undefined ? {} : { description }) })
    expect(callKey('Bash', bash('npm test'))).toBe(callKey('Bash', bash('npm test --coverage')))
    expect(callKey('Bash', bash('npm test', 'Run the tests'))).toBe(callKey('Bash', bash('npm run test:unit', '  run THE tests ')))
    expect(callKey('Bash', bash('npm test', 'Run the tests'))).not.toBe(callKey('Bash', bash('npm test', 'Run the unit tests')))
    expect(callKey('Bash', bash('npm test', 'Run the tests'))).not.toBe(callKey('Bash', bash('npm test')))
  })

  test('a refusal, an interrupt or a deny is no failure: it neither counts nor carries a run on', async ($, on) => {
    engine(on)
    on('tool.check', (_, e) => (e.tool === 'Bash' && (e.input as { command?: string }).command === 'rm -rf /' ? { decision: 'deny' as const, reason: 'rule' } : { decision: 'allow' as const }))
    on('tool.call', () => FAILED)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'just test', description: 'Run the tests' })
    await $.tool.call({ tool: 'Bash', command: 'just test', description: 'Run the tests' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf /', description: 'Clean up' })
    await $.tool.call({ tool: 'Bash', command: 'just test', description: 'Run the tests' })
    const texts = await textsAt($, 80, 70)
    expect(has(texts, /dreht sich/)).toBe(false)
    expect(has(texts, /^Fehler 3 · zuletzt Bash gerade eben$/)).toBe(true)
  })

  test('failures since load: how many, and the last one\'s tool and how long ago; a subagent\'s are its own', async ($, on) => {
    const clock = engine(on)
    on('tool.call', () => FAILED)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/b.ts', agentId: 'agent-1' })
    await $.tool.call({ tool: 'WebSearch', query: 'x', mode: 'standard' })
    await $.tool.call({ tool: 'Bash', command: 'false' })
    const row = async () => (await textsAt($)).find(found => /^Fehler /.test(found.text))?.text
    expect(await row()).toBe('Fehler 4 · zuletzt Bash gerade eben')
    await clock.advance(2 * MINUTE)
    expect(await row()).toBe('Fehler 4 · zuletzt Bash vor 2 min')
    for (let i = 0; i < 3; i += 1) await clock.advance(21 * MINUTE)
    expect(await row()).toBe('Fehler 4 · zuletzt Bash vor 1 h 05')
  })

  test('hotspots: the three files read or edited most, by name and count; subagents too, failures and engine forks not', async ($, on) => {
    engine(on, { agents: [{ id: 'agent-1', description: 'look around', type: 'Explore', status: 'running' }] })
    on('tool.call', (_, e) => {
      if (e.tool === 'Read' && e.file_path.endsWith('missing.ts')) return FAILED
      if (e.tool === 'Edit') return { result: { filePath: e.file_path, structuredPatch: [], originalFile: 'x' } }
      return READ_RESULT
    })
    await start($)
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Read', file_path: '/proj/src/deep/a.ts' })
    for (let i = 0; i < 2; i += 1) await $.tool.call({ tool: 'Edit', file_path: '/proj/src/deep/a.ts', old_string: 'a', new_string: 'b' })
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Read', file_path: '/proj/lib/b.ts', agentId: 'agent-1' })
    for (let i = 0; i < 4; i += 1) await $.tool.call({ tool: 'Read', file_path: '/proj/missing.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/c.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/d.ts' })
    // The engine's memory fork, which nothing names, is not Claude at work.
    for (let i = 0; i < 6; i += 1) await $.tool.call({ tool: 'Read', file_path: '/home/me/.claude/memory/MEMORY.md', agentId: 'memory-fork' })
    const texts = await textsAt($)
    expect(texts.find(found => /^Hotspots /.test(found.text))?.text).toBe('Hotspots a.ts 5× · b.ts 3× · d.ts 1×')
    expect(has(texts, /\/proj|MEMORY/)).toBe(false)
    // In a narrow dock each file has its row, its name cut before its count is.
    for (let i = 0; i < 9; i += 1) await $.tool.call({ tool: 'Read', file_path: '/proj/a-very-long-file-name.test.tsx' })
    const narrow = (await textsAt($, 80, 26)).filter(found => found.props.wrap === 'truncate-end' && /×$/.test(found.text))
    expect(narrow.map(found => found.text)).toEqual(['Hotspots a-ver… 9×', '         a.ts 5×', '         b.ts 3×'])
  })

  // Three and a half minutes of the clock at four frames a second: about 4.9 s here, version 0.17.1 as well, so more than the default 5 s.
  test('the wait for approvals: summed while a dialog is open, ≈ once a tool ran before its call ended; a question is none', { timeoutMs: 15_000 }, async ($, on) => {
    const clock = engine(on)
    const outer = $
    let during: string | undefined
    on('classic.PermissionRequest', () => ({}))
    on('classic.PostToolUse', () => ({}))
    on('tool.call', async (_, e) => {
      if (e.tool === 'Bash' && e.command === 'just build') {
        await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: e.command } })
        await clock.advance(10_000)
        // Approved; it runs a minute, and says so: the wait ends that much before the call.
        await clock.advance(60_000)
        await outer.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: e.tool_use_id ?? '', duration_ms: 60_000 })
        return BASH_OK
      }
      if (e.tool === 'ExitPlanMode') {
        await outer.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: {} })
        await clock.advance(20_000)
        return { result: {} }
      }
      if (e.tool === 'AskUserQuestion') {
        await outer.classic.PermissionRequest({ tool_name: 'AskUserQuestion', tool_input: { questions: [] } })
        await clock.advance(30_000)
        return { result: { answers: {} } }
      }
      await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: e.tool === 'Bash' ? e.command : '' } })
      await clock.advance(30_000)
      during = (await textsAt(outer)).find(found => /^Wartezeit /.test(found.text))?.text
      // Approved: the command runs on; the call's end comes later than the answer.
      await clock.advance(60_000)
      return BASH_OK
    })
    await start($)
    const row = async () => (await textsAt($)).find(found => /^Wartezeit /.test(found.text))?.text
    expect(await row()).toBeUndefined()
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'ExitPlanMode' })
    expect(await row()).toBe('Wartezeit 0:20 · 1 Freigabe')
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
    expect(await row()).toBe('Wartezeit 0:20 · 1 Freigabe')
    await $.tool.call({ tool: 'Bash', command: 'just deploy' })
    // While the dialog stood open the time went on, exact so far.
    expect(during).toBe('Wartezeit 0:50 · 2 Freigaben')
    // No run time told: the whole call counts, approximately.
    expect(await row()).toBe('Wartezeit ≈1:50 · 2 Freigaben')
    await $.tool.call({ tool: 'Bash', command: 'just build', tool_use_id: 'tu-build' })
    expect(await row()).toBe('Wartezeit ≈2:00 · 3 Freigaben')
  })

  test('the wait: an interrupted approved call is approximate too; a dialog a hook decided is no approval of yours', async ($, on) => {
    const clock = engine(on)
    const outer = $
    on('classic.PermissionRequest', (_, e) => (e.tool_input as { command?: string }).command === 'auto' ? { decision: { behavior: 'allow' as const } } : {})
    on('classic.PostToolUseFailure', () => ({}))
    on('tool.call', async (_, e) => {
      const command = e.tool === 'Bash' ? e.command : ''
      await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command } })
      if (command === 'auto') return BASH_OK
      await clock.advance(70_000)
      await outer.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: { command }, tool_use_id: e.tool_use_id ?? '', error: 'interrupted', is_interrupt: true })
      return { isError: true, result: 'interrupted', text: 'interrupted' }
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    const row = async () => (await textsAt($)).find(found => /^Wartezeit /.test(found.text))?.text
    await $.tool.call({ tool: 'Bash', command: 'auto' })
    expect(await row()).toBeUndefined()
    await $.tool.call({ tool: 'Bash', command: 'npm run dev', tool_use_id: 'tu-dev' })
    expect(await row()).toBe('Wartezeit ≈1:10 · 1 Freigabe')
  })

  test('RADAR in English', { options: { language: 'en' } }, async ($, on) => {
    engine(on)
    on('tool.call', () => FAILED)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Bash', command: 'just test' })
    const texts = await textsAt($, 80, 70)
    expect(has(texts, /^⚠ going in circles: Bash command \(3×\)$/)).toBe(true)
    expect(has(texts, /^3 errors · last Bash just now$/)).toBe(true)
    expect(has(texts, /^Reset /)).toBe(false)
  })

  test('calls by identity and name: a hash of the target kept, a description or a file\'s name shown', () => {
    const bash = (command: string, description?: string) => ({ command, ...(description === undefined ? {} : { description }) })
    expect(callKey('Bash', bash('just test'))).not.toBe(callKey('Bash', bash('just lint')))
    expect(callKey('Bash', bash('just test'))).not.toContain('just')
    expect(callKey('Read', { file_path: '/a/b.ts' })).not.toBe(callKey('Edit', { file_path: '/a/b.ts' }))
    expect(callLabel('Bash', bash('just test'))).toEqual({ tool: 'Bash', detail: null })
    expect(callLabel('Bash', bash('x', `Deploy with ${FAKE.anthropic}`))).toEqual({ tool: 'Bash', detail: `Deploy with ${MASK}` })
    expect(callLabel('Read', { file_path: '/home/me/project/src/auth.ts' })).toEqual({ tool: 'Read', detail: 'auth.ts' })
    expect(callLabel('WebFetch', { url: 'https://me:pw@api.example.com:8443/v1/x?key=1', prompt: 'p' })).toEqual({ tool: 'WebFetch', detail: 'api.example.com' })
    expect(callLabel('mcp__linear__create_issue', { title: 'x' })).toEqual({ tool: 'create_issue', detail: null })
    expect(callLabel('WebFetch', { url: 'http://[::1]:8080/x', prompt: 'p' }).detail).toBe('[::1]')
    expect(callLabel('WebFetch', { url: 'https:example.com/x', prompt: 'p' }).detail).toBe('example.com')
    expect(callLabel('WebFetch', { url: 'https://registry.npmjs.org/@types/node', prompt: 'p' }).detail).toBe('registry.npmjs.org')
    // Rows as the renderer wraps words: never fewer than drawn.
    expect(wrappedRows('Updating documentation regarding configuration options', 14)).toBe(5)
    expect(wrappedRows('Run the integration tests', 14)).toBe(3)
    expect(wrappedRows('Auto-Compact in ~4 Turns', 16)).toBe(2)
    expect(wrappedRows('abcdefghijklmnopqrstuvwxyz', 10)).toBe(3)
    expect(wrappedRows('short', 40)).toBe(1)
    const twice = withFailure(withFailure(NO_RADAR, 'k', { tool: 'Bash', detail: null }, 1), 'k', { tool: 'Bash', detail: null }, 2)
    expect([twice.errors, twice.streak?.count, twice.lastError]).toEqual([2, 2, { tool: 'Bash', at: 2 }])
    const used = withFileUses(withFileUses(NO_RADAR, ['/a/x.ts', '/b/y.ts'], 1), ['/b/y.ts'], 2)
    expect(hotspotsOf(used)).toEqual([
      { name: 'y.ts', count: 2 },
      { name: 'x.ts', count: 1 },
    ])
    expect(resetClockOf(null)).toBe(null)
    expect(resetClockOf('not a time')).toBe(null)
  })

  test('no command and no path reach the pane; secrets are masked as a second guard and never kept', async ($, on) => {
    engine(on)
    const written: string[] = []
    on('state.set', { plugin: 'noxdeck' }, (_, e, next) => {
      written.push(JSON.stringify(e))
      return next(e)
    })
    const SECRET = FAKE.anthropicLong
    on('tool.call', (_, e) => (e.tool === 'Bash' ? FAILED : READ_RESULT))
    on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/very/private/dir/auth.ts' })
    for (let i = 0; i < 3; i += 1) {
      await $.tool.call({ tool: 'Bash', command: `ANTHROPIC_API_KEY=${SECRET} just deploy /proj/very/private`, description: `Deploy with ${SECRET}` })
    }
    await $.agent.spawn({ ...SPAWN, description: `deploy with ${SECRET}` })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 90 }, surface })
      const texts = await ui.findAll({ type: 'Text' })
      expect(has(texts, new RegExp(`^⚠ dreht sich im Kreis: Bash · Deploy with ${MASK} \\(3×\\)$`))).toBe(true)
      expect(has(texts, /^Hotspots auth\.ts 1×$/)).toBe(true)
      for (const leak of [SECRET, 'just deploy', '/proj/very']) expect(has(texts, new RegExp(leak.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')))).toBe(false)
      await ui.press({ key: 'tab-agents' })
      expect(await ui.find({ type: 'Text', text: `deploy with ${MASK}` })).toBeDefined()
      await ui.press({ key: 'tab-live' })
      await ui.unmount()
    }
    expect(written.length).toBeGreaterThan(0)
    expect(written.some(one => one.includes(SECRET))).toBe(false)
    expect(written.some(one => one.includes('just deploy'))).toBe(false)
  })

  test('a loop the engine forks for itself (memory, compaction) is no agent at work for Nox', async ($, on) => {
    engine(on)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ turnId: 't1', durationMs: 4000, ...ANSWERED })
    await $.turn.start({ text: '', turnId: 'm1', agentId: 'memory-fork' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('fertig')
    expect(await ui.find({ type: 'Text', text: /Agents? (läuft|laufen|wartet|warten)/ })).toBeUndefined()
    await ui.unmount()
  })

  test('Nox\'s caption and every STATUS and RADAR row stay one row in a narrow dock: cut, never wrapped', async ($, on) => {
    engine(on)
    const outer = $
    let narrow: Found[] = []
    on('classic.PermissionRequest', () => ({}))
    on('tool.call', async (_, e) => {
      if (e.tool === 'Bash' && e.command === 'rm -rf build') {
        await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: e.command } })
        narrow = await textsAt(outer, 80, 24)
        return BASH_OK
      }
      return FAILED
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Bash', command: 'x', description: 'Run every test there is' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    // Too narrow for its words, the caption says it shorter rather than cut.
    const asking = narrow.filter(found => found.text === 'Freigabe!')
    expect(asking.length).toBe(1)
    for (const one of asking) expect(one.props.wrap).toBe('truncate-end')
    for (const one of narrow.filter(found => /dreht sich|Fehler|Wartezeit|Run every/.test(found.text))) {
      expect(one.props.wrap).toBe('truncate-end')
    }
  })
})

describe('secrets never reach the pane', () => {
  const MASKED: readonly (readonly [string, string])[] = [
    [`export ANTHROPIC_API_KEY=${FAKE.anthropic}`, `export ANTHROPIC_API_KEY=${MASK}`],
    ['TOKEN=abc ./deploy.sh', `TOKEN=${MASK} ./deploy.sh`],
    [`GITHUB_TOKEN="${FAKE.github}" gh pr list`, `GITHUB_TOKEN="${MASK}" gh pr list`],
    [`export AWS_ACCESS_KEY_ID=${FAKE.awsKeyId}`, `export AWS_ACCESS_KEY_ID=${MASK}`],
    [`curl -H "Authorization: Bearer ${FAKE.bearer}" https://api.example.com`, `curl -H "Authorization: Bearer ${MASK}" https://api.example.com`],
    [`curl -H "Authorization: token ${FAKE.githubHeader}" https://api.github.com`, `curl -H "Authorization: token ${MASK}" https://api.github.com`],
    [`http GET example.com bearer:x Bearer ${FAKE.jwtHeader}`, `http GET example.com bearer:${MASK} Bearer ${MASK}`],
    ['wget --password hunter2 https://example.com/file', `wget --password ${MASK} https://example.com/file`],
    ['gh auth login --with-token --token=s3cr3t', `gh auth login --with-token --token=${MASK}`],
    ['mysql -u root -pS3cret shop', `mysql -u root -p${MASK} shop`],
    ['curl -u admin:hunter2 https://example.com', `curl -u admin:${MASK} https://example.com`],
    ['sshpass -p hunter2 ssh host', `sshpass -p ${MASK} ssh host`],
    ['openssl enc -aes256 -pass pass:hunter2 -in a', `openssl enc -aes256 -pass ${MASK} -in a`],
    ['git clone https://alice:hunter2@github.com/acme/app.git', `git clone https://alice:${MASK}@github.com/acme/app.git`],
    [`git clone https://${FAKE.github}@github.com/acme/app`, `git clone https://${MASK}@github.com/acme/app`],
    ['psql postgres://admin:pa55word@db.internal:5432/app', `psql postgres://admin:${MASK}@db.internal:5432/app`],
    ['curl "https://api.example.com/v1?api_key=abc123&q=cats"', `curl "https://api.example.com/v1?api_key=${MASK}&q=cats"`],
    ['echo {"client_secret": "s3cr3t-value"}', `echo {"client_secret": "${MASK}"}`],
    ['DB_PASSWORD=\'p a s s\' npm start', `DB_PASSWORD='${MASK}' npm start`],
    [`aws configure set aws_secret_access_key ${FAKE.awsSecret}`, `aws configure set aws_secret_access_key ${MASK}`],
    [`echo ${FAKE.hex}`, `echo ${MASK}`],
    [`echo ${FAKE.base64} | base64 -d`, `echo ${MASK} | base64 -d`],
    [`jwt ${FAKE.jwt}`, `jwt ${MASK}`],
    [`slack ${FAKE.slackBot}`, `slack ${MASK}`],
    [`echo ${FAKE.privateKey}`, `echo ${MASK}`],
    // Password flags whose names do not say so, on the tools that take them.
    ['docker login -u me -p hunter2 reg.io', `docker login -u me -p ${MASK} reg.io`],
    ['redis-cli -h db -a hunter2 ping', `redis-cli -h db -a ${MASK} ping`],
    ['mongosh -u admin -p hunter2 mongodb://host', `mongosh -u admin -p ${MASK} mongodb://host`],
    ["sqlcmd -S server -U sa -P 'Passw0rd!'", `sqlcmd -S server -U sa -P '${MASK}'`],
    ['zip -P hunter2 out.zip a.txt', `zip -P ${MASK} out.zip a.txt`],
    ['ldapsearch -x -D cn=admin -w hunter2', `ldapsearch -x -D cn=admin -w ${MASK}`],
    ['gh secret set FOO --body hunter2', `gh secret set FOO --body ${MASK}`],
    ['curl --user=admin:hunter2 https://x', `curl --user=admin:${MASK} https://x`],
    ['curl -uadmin:hunter2 https://x', `curl -uadmin:${MASK} https://x`],
    ['curl -b "sid=s3cr3t" https://x', `curl -b "${MASK}" https://x`],
    // Authorization and cookies, whatever their scheme or quoting.
    ['curl -H "Authorization: Splunk 12345678-1234-1234-1234-123456789012" https://splunk:8088', `curl -H "Authorization: ${MASK}" https://splunk:8088`],
    ['curl -H "Authorization: Bot MTk4NjIyNDgzNDcxOTI1MjQ4.Cl2FMQ.ZnCjm1XVW7vRze4b7Cq4se7kKWs" x', `curl -H "Authorization: ${MASK}" x`],
    ['curl -d \'{"Authorization": "Token hunter2"}\' x', `curl -d '{"Authorization": "${MASK}"}' x`],
    ["python3 -c \"requests.get(u, headers={'Authorization': 'SSWS 00aBcDeF'})\"", `python3 -c "requests.get(u, headers={'Authorization': '${MASK}'})"`],
    ['curl -H "Cookie: _ga=1; sid=s3cr3tvalue" x', `curl -H "Cookie: ${MASK}" x`],
    // Code forms, URLs and files.
    ["python3 -c \"requests.get(u, auth=('admin', 'hunter2'))\"", `python3 -c "requests.get(u, auth=${MASK})"`],
    ["python3 -c \"os.environ['API_KEY'] = 'sup3rsecret'\"", `python3 -c "os.environ['API_KEY'] = '${MASK}'"`],
    ['export REDIS_URL=redis://:hunter2@db:6379', `export REDIS_URL=redis://:${MASK}@db:6379`],
    ['psql postgres://user:p@ss@host/db', `psql postgres://user:${MASK}@host/db`],
    [`curl https://discord.com/api/webhooks/1234567890/${FAKE.discordToken}`, `curl https://discord.com/api/webhooks/1234567890/${MASK}`],
    ['azcopy copy a "https://acct.blob.core.windows.net/c/a?sv=2022&sig=Kq1x8sNc3%2BqP9L"', `azcopy copy a "https://acct.blob.core.windows.net/c/a?sv=2022&sig=${MASK}"`],
    ['echo "machine github.com login me password hunter2" >> ~/.netrc', `echo "machine github.com login me password ${MASK}" >> ~/.netrc`],
    // curl's and HTTPie's user:password, quoted or bundled.
    ['curl -u "admin:hunter2" https://x', `curl -u "admin:${MASK}" https://x`],
    ["curl -u 'admin:P@ss w0rd!' https://x", `curl -u 'admin:${MASK}' https://x`],
    ['curl -X GET -u "$USER:hunter2" https://x', `curl -X GET -u "$USER:${MASK}" https://x`],
    ['curl -ku elastic:hunter2 https://localhost:9200/_cat/indices', `curl -ku elastic:${MASK} https://localhost:9200/_cat/indices`],
    ['curl --proxy-user me:pw https://x', `curl --proxy-user me:${MASK} https://x`],
    ['curl -U me:pw https://x', `curl -U me:${MASK} https://x`],
    ['http -a admin:hunter2 GET example.com', `http -a admin:${MASK} GET example.com`],
    // Webhooks, cloud and keychain logins, passwords on stdin, and other spellings.
    [`curl -d @m.json ${FAKE.slackHook}`, `curl -d @m.json https://hooks.slack.com/services/${MASK}`],
    ['export SLACK_WEBHOOK_URL=https://example.com/hook/abc', `export SLACK_WEBHOOK_URL=${MASK}`],
    [`az login --service-principal -u 11111111-2222-3333-4444-555555555555 -p ${FAKE.azure} --tenant t`, `az login --service-principal -u 11111111-2222-3333-4444-555555555555 -p ${MASK} --tenant t`],
    ['security add-generic-password -a me -s github -w hunter2xyz', `security add-generic-password -a ${MASK} -s github -w ${MASK}`],
    ['echo "hunter2" | sudo -S softwareupdate -ia', `echo "${MASK}" | sudo -S softwareupdate -ia`],
    ["echo 'hunter2' | docker login registry.example.com -u me --password-stdin", `echo '${MASK}' | docker login registry.example.com -u me --password-stdin`],
    ['podman pull --creds me:hunter2 quay.io/x', `podman pull --creds ${MASK} quay.io/x`],
    ['export DB_PW=hunter2', `export DB_PW=${MASK}`],
    ['plink -ssh -pw hunter2 me@host', `plink -ssh -pw ${MASK} me@host`],
    ['mysql -h db -u root -p"hun ter2" app', `mysql -h db -u root -p"${MASK}" app`],
    ['git clone https://me@example.com:hunter2@git.example.com/x.git', `git clone https://me@example.com:${MASK}@git.example.com/x.git`],
    ['sqlplus system/hunter2@//db:1521/XE', `sqlplus system/${MASK}@//db:1521/XE`],
    ['ssh-keygen -t ed25519 -N "correct horse" -f ~/.ssh/deploy', `ssh-keygen -t ed25519 -N "${MASK}" -f ~/.ssh/deploy`],
    ['openssl enc -d -aes-256-cbc -k hunter2 -in s.enc', `openssl enc -d -aes-256-cbc -k ${MASK} -in s.enc`],
    ['ipmitool -I lanplus -H 10.0.0.5 -U admin -P hunter2 power status', `ipmitool -I lanplus -H 10.0.0.5 -U admin -P ${MASK} power status`],
    ['unrar x -phunter2 a.rar', `unrar x -p${MASK} a.rar`],
    ['printf "%s" "$(cat x)"; echo password: hunter2', `printf "%s" "$(cat x)"; echo password: ${MASK}`],
  ]

  test('everything that looks like a token, key, password or secret is masked', () => {
    for (const [raw, shown] of MASKED) expect(maskSecrets(raw)).toBe(shown)
  })

  const KEPT_AS_IS = [
    'git status --short',
    'npm test -- --watch=false',
    'git show 84ea5ce --stat',
    'git log --author=alice --format=%h',
    'grep -rn "password" src/',
    'sed -n 1,200p tests/noxdeck.test.tsx',
    'ls -la /home/me/noxdeck/hooks',
    'cd /tmp/claude-1000/-home-me/c0ffee00-1234-4abc-9def-0123456789ab/scratchpad && ls',
    'claude plugin validate .',
    'claude -p "hi"',
    'mkdir -p src/hooks',
    'ssh -p 2222 host',
    'docker run -p 8080:80 nginx',
    'git push -u origin main',
    'git log -p -1',
    'curl -w "%{http_code}" https://example.com:8080/a',
    'git clone git@github.com:acme/app.git',
    'curl -sSL https://example.com/install.sh | sh',
    'curl -X POST -H "Content-Type: application/json" -d \'{"a":1}\' https://x',
    'curl -u admin https://x',
    'sort -u names.txt',
    'Implement password reset flow',
    'git commit -m "Fix password reset email"',
    'git commit -m "auth: handle expired sessions"',
    'git commit -m "Add basic validation for forms"',
    'rg "password:" -g "*.yml"',
    'openssl x509 -in cert.pem -noout -text',
    'Run the security review',
    'Explore the hooks',
    'register.tsx',
  ]

  test('masking stays fast on long, unlucky lines (no runaway backtracking)', () => {
    const unlucky = [
      'key'.repeat(700),
      'key='.repeat(500),
      ` --${'key'.repeat(700)}`,
      'a.'.repeat(1000),
      'aB3/'.repeat(500),
      `docker login ${'-x '.repeat(700)}`,
      'oras login -w('.repeat(143),
      'docker login -p ('.repeat(118),
      '7z -p('.repeat(334),
      `zip ${'('.repeat(2000)}`,
      'curl -u('.repeat(250),
      `echo ${'a '.repeat(990)}`,
      'password: '.repeat(200),
    ]
    for (const line of unlucky) {
      const started = performance.now()
      maskSecrets(line)
      expect(performance.now() - started).toBeLessThan(100)
    }
  })

  test('ordinary commands, paths and short ids stay as they are', () => {
    for (const raw of KEPT_AS_IS) expect(maskSecrets(raw)).toBe(raw)
  })
})

describe('CHANGES: paths from the project folder', () => {
  test('a file in the project by its path from the folder; one outside it by its name; never an absolute path', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => ({ result: { filePath: (e as { file_path?: string }).file_path ?? '', structuredPatch: [], originalFile: 'x' } }))
    await start($)
    for (const file_path of ['/proj/src/auth/index.ts', '/home/me/notes/todo.md', '/proj-other/x.ts']) {
      await $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })
    }
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.press({ key: 'tab-changes' })
      const texts = await ui.findAll({ type: 'Text' })
      for (const shown of ['src/auth/index.ts', 'todo.md', 'x.ts']) expect(has(texts, new RegExp(`^${shown.replace('.', '\\.')}$`))).toBe(true)
      expect(has(texts, /\/home|\/proj/)).toBe(false)
      await ui.press({ key: 'tab-live' })
      await ui.unmount()
    }
  })

  test('relative, outside, home and Windows paths', () => {
    expect(projectPath('/proj/src/a.ts', '/proj')).toBe('src/a.ts')
    expect(projectPath('/proj/src/a.ts', '/proj/')).toBe('src/a.ts')
    expect(projectPath('/home/me/.claude/CLAUDE.md', '/proj')).toBe('CLAUDE.md')
    expect(projectPath('~/notes/todo.md', '/proj')).toBe('todo.md')
    expect(projectPath('/project/a.ts', '/proj')).toBe('a.ts')
    expect(projectPath('src/a.ts', '/proj')).toBe('src/a.ts')
    expect(projectPath('./src/a.ts', '/proj')).toBe('src/a.ts')
    expect(projectPath('../other/a.ts', '/proj')).toBe('a.ts')
    expect(projectPath('/proj/a.ts', '')).toBe('a.ts')
    expect(projectPath('C:\\Users\\me\\proj\\src\\a.ts', 'C:\\Users\\me\\proj')).toBe('src/a.ts')
    expect(projectPath('C:\\Users\\me\\other\\a.ts', 'C:\\Users\\me\\proj')).toBe('a.ts')
    // Absolute paths are tidied too: a `..` climbing out shows the name only.
    expect(projectPath('/proj/../notes/secret-plan.md', '/proj')).toBe('secret-plan.md')
    expect(projectPath('/proj//src/a.ts', '/proj')).toBe('src/a.ts')
    expect(projectPath('/proj/./src/a.ts', '/proj')).toBe('src/a.ts')
  })

  test('the project folder follows /cd and worktree moves', async ($, on) => {
    const world: World = {}
    engine(on, world)
    on('tool.call', (_, e) => ({ result: { filePath: (e as { file_path?: string }).file_path ?? '', structuredPatch: [], originalFile: 'x' } }))
    await start($)
    const shown = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      await ui.press({ key: 'tab-changes' })
      const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
      await ui.press({ key: 'tab-live' })
      await ui.unmount()
      return texts
    }
    // A worktree entered in the turn moves the folder at once.
    world.root = '/proj/.claude/worktrees/feat'
    await $.tool.call({ tool: 'EnterWorktree' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/proj/.claude/worktrees/feat/src/auth/index.ts', old_string: 'a', new_string: 'b' })
    expect(await shown()).toContain('src/auth/index.ts')
    // /cd between turns: the next turn reads the folder anew.
    world.root = '/other'
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: '/other/lib/db.ts', old_string: 'a', new_string: 'b' })
    const after = await shown()
    expect(after).toContain('lib/db.ts')
    expect(after).toContain('index.ts')
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
    on('tool.call', () => FAILED)
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

describe('Agents: tokens, model and activity per agent', () => {
  /** A model request's usage as the API reports it. */
  const usageOf = (input: number, output: number, read: number, write: number, model = 'claude-opus-5-5'): TurnUsage => ({
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: write,
    model,
  })

  /** The engine beneath: every model request streams its answer and reports the usage `usageFor` gives it. */
  const modelBeneath = (on: On, usageFor: (e: TurnStepInput) => TurnUsage | null) =>
    on('turn.step', async function* (_, e) {
      yield { kind: 'text' as const, index: 0, text: 'an answer, not kept' }
      return { turnId: e.turnId, index: e.index, answer: 'an answer, not kept', toolUses: [], stopReason: 'end_turn' as const, usage: usageFor(e) }
    })

  /**
   * One model request through the plugin, read to its end: the chunks and
   * the result that came out of the chain (the generator's return value; the
   * test engine's stream leaves `result` unset).
   */
  async function step($: Engine, loop: string | null, more: Partial<TurnStepInput> = {}) {
    const input: TurnStepInput = { turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 3, ...more }
    const stream = $.turn.step(loop === null ? input : { ...input, agentId: loop })
    const chunks: unknown[] = []
    let read = await stream.next()
    while (read.done !== true) {
      chunks.push(read.value)
      read = await stream.next()
    }
    return { chunks, result: read.value }
  }

  const done = (id: string, description: string, type = 'general-purpose'): AgentInfo => ({ id, description, type, status: 'completed' })
  const running = (id: string, description: string): AgentInfo => ({ id, description, type: 'general-purpose', status: 'running' })

  /** The engine's spawn: the id of the listed agent with the call's description. */
  const spawnsAs = (on: On, world: { agents: AgentInfo[] }) =>
    on('agent.spawn', (_, e) => ({ model: 'm', agentId: world.agents.find(one => one.description === e.description)?.id ?? 'unlisted' }))

  /** Agents spawned after load, named by the list from then on: noxdeck sees them from their start. */
  async function spawnListed($: Engine, world: { agents: AgentInfo[] }, listed: readonly AgentInfo[]) {
    world.agents = [...world.agents, ...listed]
    for (const info of listed) await $.agent.spawn({ ...SPAWN, description: info.description, subagentType: info.type })
  }

  /** The pane on the Agents tab, wide and tall enough for the full card unless told otherwise. */
  async function agentsTab($: Engine, surface: (typeof SURFACES)[number], columns = 90, rows = 80) {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: rows } }, surface })
    await ui.press({ key: 'tab-agents' })
    return ui
  }

  test('turn.step: every chunk and the result pass through as they came; model and effort are never rewritten', async ($, on) => {
    engine(on, { agents: [{ id: 'a1', description: 'review diff', type: 'general-purpose', status: 'running' }] })
    const seen: TurnStepInput[] = []
    const answer: TurnStepResult = {
      turnId: 't',
      index: 0,
      answer: 'an answer',
      toolUses: [{ name: 'Read', input: { file_path: '/proj/a.ts' } }],
      stopReason: 'tool_use',
      usage: usageOf(1, 2, 3, 4),
    }
    on('turn.step', async function* (_, e) {
      seen.push(e)
      yield { kind: 'thinking' as const, index: 0, text: 'hm' }
      yield { kind: 'text' as const, index: 1, text: 'an answer' }
      return answer
    })
    await start($)
    for (const loop of [null, 'a1', 'fork-1']) {
      const { chunks, result } = await step($, loop, { model: 'claude-sonnet-5-5', effort: 'low' })
      expect(chunks).toEqual([
        { kind: 'thinking', index: 0, text: 'hm' },
        { kind: 'text', index: 1, text: 'an answer' },
      ])
      expect(result).toEqual(answer)
    }
    expect(seen.map(e => [e.model, e.effort, e.agentId])).toEqual([
      ['claude-sonnet-5-5', 'low', undefined],
      ['claude-sonnet-5-5', 'low', 'a1'],
      ['claude-sonnet-5-5', 'low', 'fork-1'],
    ])
  })

  test('three pots: the main chat, each agent the list names, other loops; an id no list names is other', async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    modelBeneath(on, e =>
      e.agentId === undefined
        ? usageOf(10 * K, 40 * K, 1300 * K, 50 * K)
        : e.agentId === 'a1'
          ? e.index === 0
            ? usageOf(2 * K, 1 * K, 40 * K, 30 * K)
            : usageOf(1 * K, 3 * K, 70 * K, 21 * K)
          : usageOf(100 * K, 0, 200 * K, 0),
    )
    await start($)
    await spawnListed($, world, [running('a1', 'prüfen: model.ts')])
    await $.turn.start({ text: '', turnId: 'a1-t', agentId: 'a1' })
    await step($, null)
    await step($, 'a1', { index: 0 })
    await step($, 'a1', { index: 1 })
    await step($, 'workflow-7')
    await clock.advance(3000)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      const texts = await ui.findAll({ type: 'Text' })
      expect(has(texts, /^▸ Verarbeitet seit Laden · Haupt-Chat 1,4M · Agents 168k · Sonstiges 300k$/)).toBe(true)
      // Context: the last step's input, cache read and cache write (1k + 70k + 21k), no sum. Processed: all
      // four kinds over both steps (73k + 95k). New: without the cache's reads (33k + 25k).
      expect(has(texts, /^ {2}Kontext 92k · verarbeitet 168k · davon neu 58k$/)).toBe(true)
      expect(has(texts, /^ {2}opus · high · 2 Schritte$/)).toBe(true)
      // Its row: what it processed white and bold, its time in the accent; no word for its state.
      expect(texts.some(found => found.text === '168k' && found.props.color === 'text' && found.props.bold === true)).toBe(true)
      expect(texts.some(found => found.text === '0:03' && found.props.color === 'claude')).toBe(true)
      expect(has(texts, /^läuft/)).toBe(false)
      expect(has(texts, /workflow-7/)).toBe(false)
      // No share, and not the word Session.
      expect(has(texts, /%|Session/)).toBe(false)
      // The timeline: its one bar runs to now, with ▶.
      expect(has(texts, /^Zeitleiste seit Laden$/)).toBe(true)
      expect(texts.some(found => /^▆+▶$/.test(found.text) && found.props.color === 'claude')).toBe(true)
      expect(has(texts, /^Verarbeitet = Summe aller Schritte, inkl\. Wiederholung aus dem Cache$/)).toBe(true)
      // The CONTEXT card still shows the main chat's window alone.
      await ui.press({ key: 'tab-live' })
      expect(has(await ui.findAll({ type: 'Text' }), new RegExp(`^ ?${P(58)} · 116k / 200k ?$`))).toBe(true)
      await ui.unmount()
    }
  })

  test('a workflow\'s agent (spawned, never listed) is an agent: its tokens are the Agents pot\'s, its figures shown', async ($, on) => {
    // The list names no agent, as with a workflow's: agent.spawn alone makes it one.
    const clock = engine(on)
    on('agent.spawn', () => ({ model: 'm', agentId: 'wf-1' }))
    modelBeneath(on, () => usageOf(1 * K, 2 * K, 3 * K, 4 * K))
    await start($)
    await $.agent.spawn({ ...SPAWN, description: 'prüfen: model.ts', subagentType: 'workflow-subagent' })
    await $.turn.start({ text: '', turnId: 'w', agentId: 'wf-1' })
    await step($, 'wf-1')
    await clock.advance(1000)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      const texts = await ui.findAll({ type: 'Text' })
      expect(has(texts, /^▸ Verarbeitet seit Laden · Haupt-Chat 0 · Agents 10k · Sonstiges 0$/)).toBe(true)
      // Context 1k + 3k + 4k, processed all four kinds, new without the 3k read from the cache.
      expect(has(texts, /^ {2}Kontext 8k · verarbeitet 10k · davon neu 7k$/)).toBe(true)
      expect(has(texts, /^ {2}opus · high · 1 Schritt$/)).toBe(true)
      expect(texts.some(found => found.text === '10k' && found.props.color === 'text' && found.props.bold === true)).toBe(true)
      expect(texts.some(found => found.text === '0:01' && found.props.color === 'claude')).toBe(true)
      // Its type is the only one, so not named.
      expect(has(texts, /workflow-subagent/)).toBe(false)
      expect(has(texts, /^ {2}verarbeitet –$/)).toBe(false)
      await ui.unmount()
    }
  })

  test('a step heard before its spawn\'s answer counts for that agent; an id only steps carry is Sonstiges', async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    on('agent.spawn', () => ({ model: 'm', agentId: 'wf-2' }))
    modelBeneath(on, e => (e.agentId === 'wf-2' ? usageOf(5 * K, 5 * K, 10 * K, 0) : usageOf(1 * K, 0, 2 * K, 0)))
    await start($)
    // The agent's first step and turn come in before agent.spawn has answered its id.
    await $.turn.start({ text: '', turnId: 'w', agentId: 'wf-2' })
    await step($, 'wf-2')
    await step($, 'compaction-1')
    await clock.advance(1000)
    let ui = await agentsTab($, 'terminal')
    expect(has(await ui.findAll({ type: 'Text' }), /^▸ Verarbeitet seit Laden · Haupt-Chat 0 · Agents 0 · Sonstiges 23k$/)).toBe(true)
    await ui.unmount()

    await $.agent.spawn({ ...SPAWN, description: 'gegen: a.ts', subagentType: 'workflow-subagent' })
    await step($, 'wf-2', { index: 1 })
    await clock.advance(1000)
    ui = await agentsTab($, 'terminal')
    const texts = await ui.findAll({ type: 'Text' })
    // Both of its steps are the Agents pot's now; the id no spawn and no list named stays Sonstiges.
    expect(has(texts, /^▸ Verarbeitet seit Laden · Haupt-Chat 0 · Agents 40k · Sonstiges 3k$/)).toBe(true)
    expect(has(texts, /^ {2}opus · high · 2 Schritte$/)).toBe(true)
    expect(has(texts, /^ {2}Kontext 15k · verarbeitet 40k · davon neu 20k$/)).toBe(true)
    // Its start was heard before the spawn's answer too: the timeline has it.
    expect(has(texts, /^Zeitleiste seit Laden$/)).toBe(true)
    expect(has(texts, /compaction/)).toBe(false)
    await ui.unmount()
  })

  test('an agent there before noxdeck loaded: its own figures are –; its steps since count in the agents\' pot', async ($, on) => {
    const clock = engine(on, { agents: [running('old', 'review diff')] })
    modelBeneath(on, () => usageOf(1 * K, 2 * K, 3 * K, 4 * K))
    await start($)
    await step($, 'old')
    await clock.advance(1000)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      const texts = await ui.findAll({ type: 'Text' })
      expect(has(texts, /^▸ Verarbeitet seit Laden · Haupt-Chat 0 · Agents 10k · Sonstiges 0$/)).toBe(true)
      expect(has(texts, /^ {2}verarbeitet –$/)).toBe(true)
      expect((await ui.find({ type: 'Button', key: 'old' }))?.text).toMatch(/^◉ review diff +– –$/)
      // No model line and no figures: they would be its steps since load only.
      expect(has(texts, /^ {2}(opus|Kontext)/)).toBe(false)
      await ui.unmount()
    }
  })

  test('the figures: context the last step\'s, processed all four kinds summed, new without the cache\'s reads', () => {
    let ledger: AgentLedger = withAgent({ ...NO_LEDGER, since: 1 }, 'a1')
    ledger = withLedgerStep(ledger, 'a1', usageOf(5, 7, 1000, 300), 'high')
    ledger = withLedgerStep(ledger, 'a1', usageOf(2, 11, 1300, 40, 'claude-sonnet-5-5'), 'low')
    // A request no response came back for: a step, no tokens, the last context kept.
    ledger = withLedgerStep(ledger, 'a1', null, 'low')
    const tally = ledger.work[0]?.tally ?? NO_TALLY
    expect(tally.steps).toBe(3)
    expect(tally.context).toBe(2 + 1300 + 40)
    expect(processedOf(tally)).toBe(5 + 7 + 1000 + 300 + (2 + 11 + 1300 + 40))
    expect(freshOf(tally)).toBe(5 + 300 + 7 + (2 + 40 + 11))
    expect([tally.model, tally.effort]).toEqual(['claude-sonnet-5-5', 'low'])
    expect(potsOf(ledger).agents).toEqual(tally)

    // Every loop is counted by its id; the pots are decided as they are read.
    ledger = withLedgerStep(ledger, null, usageOf(1, 1, 1, 1), null)
    ledger = withLedgerStep(ledger, 'compaction-fork', usageOf(2, 2, 2, 2), null)
    ledger = withLedgerStep(ledger, 'late', usageOf(3, 3, 3, 3), null)
    const before = potsOf(ledger)
    expect([processedOf(before.main), processedOf(before.agents), processedOf(before.other)]).toEqual([4, processedOf(tally), 8 + 12])
    // A spawn answered late claims the steps its loop made before.
    const after = potsOf(withAgent(ledger, 'late'))
    expect([processedOf(after.agents), processedOf(after.other)]).toEqual([processedOf(tally) + 12, 8])
  })

  test('a ledger 0.14.0 kept (pots by listing, noxdeck/8) reads as absent after the update', async ($, on) => {
    const clock = engine(on)
    const OLD = { since: 1, main: NO_TALLY, agents: { ...NO_TALLY, steps: 9, input: 9 * K }, other: NO_TALLY, work: [] }
    let isOld = true
    on('state.get', { plugin: 'noxdeck', key: 'agentLedger' }, (_, e, next) =>
      isOld ? ({ value: { value: { shape: 'noxdeck/8', value: OLD }, version: 1 } } as never) : next(e),
    )
    await start($)
    isOld = false
    await clock.advance(1000)
    const ui = await agentsTab($, 'terminal')
    expect(has(await ui.findAll({ type: 'Text' }), /^▸ Verarbeitet seit Laden · Haupt-Chat 0 · Agents 0 · Sonstiges 0$/)).toBe(true)
    await ui.unmount()
  })

  test('older ids no spawn and no list names are kept as a sum in Sonstiges only; the 50 agents\' too stay counted', () => {
    let ledger: AgentLedger = { ...NO_LEDGER, since: 1 }
    for (let i = 0; i < 30; i += 1) ledger = withLedgerStep(ledger, `fork-${i}`, usageOf(1, 0, 0, 0), null)
    for (let i = 0; i < 60; i += 1) ledger = withLedgerStep(withAgent(ledger, `agent-${i}`), `agent-${i}`, usageOf(0, 10, 0, 0), null)
    const others = ledger.work.filter(one => !one.isAgent)
    const agents = ledger.work.filter(one => one.isAgent)
    expect([others.length, agents.length]).toEqual([MAX_OTHER_LOOPS, MAX_AGENTS])
    // The newest of each kept one by one, the older summed.
    expect(others[0]?.id).toBe('fork-10')
    expect(agents[0]?.id).toBe('agent-10')
    expect([ledger.otherPast.steps, ledger.agentsPast.steps]).toEqual([10, 10])
    const pots = potsOf(ledger)
    expect([pots.other.steps, processedOf(pots.other), pots.agents.steps, processedOf(pots.agents)]).toEqual([30, 30, 60, 600])
  })

  test('finished agents by the words before „:“: the group\'s figures, its agents under it; the odd type shows', async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    modelBeneath(on, e => usageOf(0, 0, e.agentId === 'p1' ? 400 * K : 100 * K, 0))
    await start($)
    await spawnListed($, world, [
      done('p1', 'prüfen: model.ts'),
      done('p2', 'prüfen: view.tsx'),
      done('p3', 'prüfen: radar.ts'),
      done('g1', 'gegen: a'),
      done('g2', 'gegen: b', 'Explore'),
      done('r1', 'review diff'),
      done('s1', 'solo: x'),
    ])
    const turn = async (id: string, kind: 'start' | 'end', ms = 0) =>
      kind === 'start'
        ? $.turn.start({ text: '', turnId: id, agentId: id })
        : $.turn.complete({ turnId: id, agentId: id, durationMs: ms, ...ANSWERED })
    // p1 0:00–0:10, p2 0:05–0:20, p3 0:10–0:30: the group from its first start to its last end, 0:30.
    await turn('p1', 'start')
    await clock.advance(5000)
    await turn('p2', 'start')
    await clock.advance(5000)
    await turn('p1', 'end', 10_000)
    await turn('p3', 'start')
    await clock.advance(10_000)
    await turn('p2', 'end', 15_000)
    await clock.advance(10_000)
    await turn('p3', 'end', 20_000)
    for (const id of ['p1', 'p2', 'p3', 'g1', 'g2']) await step($, id)
    await clock.advance(1000)

    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      const texts = await ui.findAll({ type: 'Text' })
      expect(texts.some(found => found.text === 'prüfen ×3' && found.props.bold === true)).toBe(true)
      expect(has(texts, /^600k 0:30$/)).toBe(true)
      expect(has(texts, /^400k 0:10$/)).toBe(true)
      for (const name of ['model.ts', 'view.tsx', 'radar.ts', 'gegen ×2', 'a', 'b', 'review diff', 'solo: x']) {
        expect(has(texts, new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))).toBe(true)
      }
      // No member keeps its prefix; only the type that differs from most is named.
      expect(has(texts, /^prüfen: (model|view|radar)/)).toBe(false)
      expect(has(texts, /^ Explore$/)).toBe(true)
      expect(has(texts, /general-purpose/)).toBe(false)
      // An agent noxdeck saw no step and no turn of: – for both, in the columns.
      expect(has(texts, /^ {3}– {4}–$/)).toBe(true)
      expect(has(texts, /^ ?7 fertig ?$/)).toBe(true)
      await ui.unmount()
    }
    // The pure grouping: a prefix one agent has is that agent's name.
    const groups = groupsOf(['a: 1', 'b: 1', 'a: 2', 'c'], text => text)
    expect(groups.map(group => [group.prefix, group.members])).toEqual([
      ['a', ['a: 1', 'a: 2']],
      [null, ['b: 1']],
      [null, ['c']],
    ])
  })

  test('failed ✗ and stopped ■ in the accent, with their tool errors', async ($, on) => {
    const clock = engine(on, {
      agents: [
        { id: 'f1', description: 'prüfen: a', type: 'general-purpose', status: 'failed' },
        { id: 'k1', description: 'prüfen: b', type: 'general-purpose', status: 'killed' },
        done('ok', 'prüfen: c'),
      ],
    })
    on('tool.call', () => FAILED)
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'f1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'f1' })
    await clock.advance(1000)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      const texts = await ui.findAll({ type: 'Text' })
      const accented = (text: string) => texts.some(found => found.text === text && found.props.color === 'claude')
      expect(accented('✗ 2 Fehler')).toBe(true)
      expect(accented('■ 0 Fehler')).toBe(true)
      // The group's glyph and name in the accent too, as a failed agent's name.
      expect(accented('✗')).toBe(true)
      expect(accented('prüfen ×3')).toBe(true)
      expect(accented('a')).toBe(true)
      expect(has(texts, /^ ?1 fertig · 1 fehlgeschlagen · 1 abgebrochen ?$/)).toBe(true)
      await ui.unmount()
    }
  })

  test('at most the last 50 agents are kept, rows and work; the agents\' pot counts every one', async ($, on) => {
    const listed = Array.from({ length: 60 }, (_, i) => done(`a${i}`, `prüfen: f${i}.ts`))
    const clock = engine(on, { agents: listed })
    modelBeneath(on, () => usageOf(1 * K, 0, 0, 0))
    const ledgers: AgentLedger[] = []
    const boards: { rows: unknown[] }[] = []
    on('state.set', { plugin: 'noxdeck' }, (_, e, next) => {
      const value = (e.value as { value?: unknown } | undefined)?.value
      if (e.key === 'agentLedger') ledgers.push(value as AgentLedger)
      if (e.key === 'agentBoard') boards.push(value as { rows: unknown[] })
      return next(e)
    })
    await start($)
    for (const { id } of listed) await step($, id)
    await clock.advance(1000)
    const ledger = ledgers.at(-1) ?? NO_LEDGER
    expect(ledger.work.filter(one => one.isAgent).length).toBe(MAX_AGENTS)
    expect(potsOf(ledger).agents.steps).toBe(60)
    expect(boards.at(-1)?.rows.length).toBe(MAX_AGENTS)
    const ui = await agentsTab($, 'terminal', 48)
    const texts = await ui.findAll({ type: 'Text' })
    expect(has(texts, /^ ?50 fertig ?$/)).toBe(true)
    expect(has(texts, /^prüfen ×50$/)).toBe(true)
    expect(has(texts, /^f9\.ts$/)).toBe(false)
    expect(has(texts, /^Agents 60k · Sonstiges 0$/)).toBe(true)
    await ui.unmount()
    // Too tall for a shorter pane: the card shortened, its group closed, every one kept counted.
    const shorter = await agentsTab($, 'terminal', 48, 20)
    expect(await shorter.find({ type: 'Button', key: 'processed' })).toBeDefined()
    expect((await shorter.find({ type: 'Button', key: 'group-prüfen' }))?.text).toMatch(/^✓ ▸ prüfen ×50 /)
    expect(await shorter.find({ type: 'Button', key: 'a59' })).toBeUndefined()
    await shorter.unmount()
    // Too tall even so for a short pane: the compact view, every one kept counted.
    const short = await agentsTab($, 'terminal', 48, 10)
    expect(has(await short.findAll({ type: 'Text' }), /^ 50 ✓ · verarbeitet 60k$/)).toBe(true)
    await short.unmount()
  })

  test('the compact view where the pane is short: a head, a line per running agent, a closed line per finished group', async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    modelBeneath(on, e => usageOf(0, 0, e.agentId?.startsWith('p-') ? 1150 * K : e.agentId?.startsWith('g-') ? 775 * K : 1100 * K, 0))
    on('tool.call', () => READ_RESULT)
    await start($)
    await spawnListed($, world, [
      running('r1', 'review diff'),
      ...['a', 'b', 'c', 'd'].map(x => done(`p-${x}`, `prüfen: ${x}.ts`)),
      ...['a', 'b', 'c', 'd'].map(x => done(`g-${x}`, `gegen: ${x}.ts`)),
    ])
    await $.turn.start({ text: '', turnId: 'r', agentId: 'r1' })
    for (const id of ['r1', 'p-a', 'p-b', 'p-c', 'p-d', 'g-a', 'g-b', 'g-c', 'g-d']) await step($, id)
    await $.tool.call({ tool: 'Read', file_path: '/proj/very/private/model.ts', agentId: 'r1' })
    await clock.advance(83_000)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface, 48, 12)
      const texts = await ui.findAll({ type: 'Text' })
      expect(has(texts, /^ 1 ◉ · 8 ✓ · verarbeitet 8,8M$/)).toBe(true)
      expect(has(texts, /^review diff$/)).toBe(true)
      expect(has(texts, /^ 1:23 · 1,1M$/)).toBe(true)
      expect(has(texts, /^ → Read model\.ts$/)).toBe(true)
      // A line per group, closed: its glyph, ▸, name, count and what it processed; none of its agents.
      expect((await ui.find({ type: 'Button', key: 'group-prüfen' }))?.text).toMatch(/^✓ ▸ prüfen ×4 4,6M *$/)
      expect((await ui.find({ type: 'Button', key: 'group-gegen' }))?.text).toMatch(/^✓ ▸ gegen ×4 3,1M *$/)
      expect(has(texts, /^prüfen ×4 4,6M$/)).toBe(true)
      expect(has(texts, /^gegen ×4 3,1M$/)).toBe(true)
      expect(await ui.find({ type: 'Button', key: 'p-a' })).toBeUndefined()
      // Not the full card: no figures per step, no timeline.
      expect(has(texts, /Kontext|Zeitleiste/)).toBe(false)
      await ui.unmount()
      // Too short for every line once a group is open: the lines that fit, the agents of the rest counted.
      // Seven rows for the card on either surface (the desktop's frame takes one more).
      const short = await agentsTab($, surface, 48, surface === 'terminal' ? 11 : 12)
      await short.press({ key: 'group-prüfen' })
      const rows = (await short.findAll({ type: 'Button' })).filter(found => !found.key?.startsWith('tab-'))
      // The newest group first (gegen, spawned last), then prüfen, open, its agents under it.
      expect(rows.map(found => [found.key, found.text.trimEnd()])).toEqual([
        ['r1', '◉ review diff 1:23 · 1,1M → Read model.ts'],
        ['group-gegen', '✓ ▸ gegen ×4 3,1M'],
        ['group-prüfen', '✓ ▾ prüfen ×4 4,6M'],
        ['p-a', '    a.ts 1,1M'],
        ['p-b', '    b.ts 1,1M'],
      ])
      // c.ts and d.ts did not fit.
      expect(has(await short.findAll({ type: 'Text' }), /^\+2 ✓$/)).toBe(true)
      await short.press({ key: 'group-prüfen' })
      await short.unmount()
    }
  })

  test('a subagent\'s activity is its tool and a file\'s name: no command, query, prompt or answer is kept or shown', async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    const written: string[] = []
    on('state.set', { plugin: 'noxdeck' }, (_, e, next) => {
      written.push(JSON.stringify(e))
      return next(e)
    })
    on('tool.call', (_, e) => (e.tool === 'Bash' ? BASH_OK : e.tool === 'Read' ? READ_RESULT : { result: { results: [] } }))
    modelBeneath(on, () => usageOf(1, 1, 1, 1))
    await start($)
    await spawnListed($, world, [running('a1', 'review diff')])
    await $.turn.start({ text: 'the secret prompt', turnId: 't', agentId: 'a1' })
    await step($, 'a1')
    await $.tool.call({ tool: 'Read', file_path: '/proj/very/private/auth.ts', agentId: 'a1' })
    await clock.advance(3000)
    let ui = await agentsTab($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '  → Read auth.ts · vor 3 s' })).toBeDefined()
    await ui.unmount()

    await $.tool.call({ tool: 'WebSearch', query: 'password=hunter2', mode: 'standard', agentId: 'a1' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf /proj/very/private && curl https://evil.example/up', description: 'Clean up', agentId: 'a1' })
    await clock.advance(1000)
    ui = await agentsTab($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '  → Bash · vor 1 s' })).toBeDefined()
    const texts = await ui.findAll({ type: 'Text' })
    for (const leak of [/rm -rf/, /evil\.example/, /hunter2/, /secret prompt/, /Clean up/, /an answer/, /\/proj\/very/]) {
      expect(has(texts, leak)).toBe(false)
    }
    await ui.unmount()
    for (const leak of ['rm -rf', 'evil.example', 'hunter2', 'the secret prompt', 'Clean up', 'an answer']) {
      expect(written.some(one => one.includes(leak))).toBe(false)
    }
    // The Agents tab's own values keep a file's name, never its path.
    const agentWrites = written.filter(one => one.includes('"agentLedger"') || one.includes('"agentBoard"'))
    expect(agentWrites.length).toBeGreaterThan(0)
    expect(agentWrites.some(one => one.includes('/proj/very'))).toBe(false)
    expect(agentWrites.some(one => one.includes('"file":"auth.ts"'))).toBe(true)
  })

  /**
   * A running agent, a finished group of four and a finished agent without
   * one, spawned after load; the engine beneath shows a view or refuses it
   * as `answer` says, and keeps every view asked for and every toast.
   */
  async function clickable($: Engine, on: On, answer: (view: SiteView) => UiViewResult | { refuse: string } = () => ({})) {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    const views: SiteView[] = []
    const toasts: string[] = []
    on('ui.view', (_, e) => {
      views.push(e)
      const answered = answer(e)
      // `refuse`: a plugin's hook refusing, which rejects the call rather than resolving `deny`.
      return 'refuse' in answered ? { deny: answered.refuse } : { value: answered }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    await start($)
    await spawnListed($, world, [
      running('r1', 'review diff'),
      ...['a', 'b', 'c', 'd'].map(x => done(`p-${x}`, `prüfen: ${x}.ts`)),
      done('s1', 'solo task'),
    ])
    await $.turn.start({ text: '', turnId: 'r', agentId: 'r1' })
    await clock.advance(1000)
    return { views, toasts }
  }

  /** The pane's props with `agentId`'s transcript in the main view (none: the main chat's). */
  const viewing = (agentId: string | null, columns = 90, rows = 80) => ({
    ...PANE.props,
    bodyColumns: columns,
    scroll: { offset: 0, bodyRows: rows },
    view: agentId === null ? {} : { agentId },
  })

  /** The pane on the Agents tab while `agentId`'s transcript is in the main view. */
  async function agentsTabViewing($: Engine, surface: (typeof SURFACES)[number], agentId: string | null, columns = 90, rows = 80) {
    const ui = await $.ui.mount({ ...PANE, props: viewing(agentId, columns, rows), surface })
    await ui.press({ key: 'tab-agents' })
    return ui
  }

  /** The texts drawn on the accent, the active tab's label aside: the marked row's. */
  const markedTexts = async (ui: { findAll: (q: { type: string }) => Promise<Found[]> }) =>
    (await ui.findAll({ type: 'Text' }))
      .filter(found => found.props.backgroundColor === 'claude' && found.props.color === 'inverseText' && !/^ (Live|Changes|Agents) $/.test(found.text))
      .map(found => found.text)

  test('every agent\'s row is a Button keyed by its id, in the full card and the compact view; a press asks to show that agent', async ($, on) => {
    const { views, toasts } = await clickable($, on)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      for (const id of ['r1', 'p-a', 'p-b', 'p-c', 'p-d', 's1']) {
        expect((await ui.find({ type: 'Button', key: id }))?.key).toBe(id)
      }
      // Each row whole in its Button: the running agent's first line, a group's agent, one without a group.
      expect((await ui.find({ type: 'Button', key: 'r1' }))?.text).toMatch(/^◉ review diff +– 0:01$/)
      // No step seen: – in the bar's slot, – for what it processed and how long it ran, in the
      // columns the running row shares (its 0:01 makes the time's four cells wide).
      expect((await ui.find({ type: 'Button', key: 'p-b' }))?.text).toMatch(/^ {4}b\.ts +– +– {4}–$/)
      expect((await ui.find({ type: 'Button', key: 's1' }))?.text).toMatch(/^✓ solo task +– +– {4}–$/)
      for (const id of ['p-b', 'r1', 's1']) {
        await ui.press({ key: id })
        expect(views.at(-1)).toEqual({ agentId: id })
      }
      await ui.unmount()

      // The compact view: the running agent and the one without a group, a line each.
      const short = await agentsTab($, surface, 48, 12)
      expect(await short.find({ type: 'Text', text: /Zeitleiste/ })).toBeUndefined()
      expect((await short.find({ type: 'Button', key: 'r1' }))?.text).toMatch(/^◉ review diff 0:01 · – *$/)
      expect((await short.find({ type: 'Button', key: 's1' }))?.text).toMatch(/^✓ solo task – *$/)
      for (const id of ['r1', 's1']) {
        await short.press({ key: id })
        expect(views.at(-1)).toEqual({ agentId: id })
      }
      await short.unmount()
    }
    // One view asked per press, nothing refused.
    expect(views).toHaveLength(10)
    expect(toasts).toEqual([])
  })

  test('a view the engine refuses: its reason as it came (the first line) after „Ansicht nicht möglich:“, nothing else tried', async ($, on) => {
    const { views, toasts } = await clickable($, on, view =>
      view.agentId === 'p-a'
        ? { deny: 'no agent holds the id p-a\nnot in the tasks list' }
        : view.agentId === undefined
          ? { deny: 'the view moved meanwhile' }
          : { deny: 'the tasks list shows none for it' },
    )
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      await ui.press({ key: 'p-a' })
      await ui.press({ key: 'r1' })
      await ui.unmount()
      // The way back refused alike.
      const back = await agentsTabViewing($, surface, 'r1')
      await back.press({ key: 'main-chat' })
      // The view did not move, so the row marked is still the one the pane was drawn for.
      expect(await markedTexts(back)).toContain('review diff')
      await back.unmount()
    }
    // No second try, no other view: each press asked once.
    const once = [{ agentId: 'p-a' }, { agentId: 'r1' }, {}]
    expect(views).toEqual([...once, ...once])
    const reasons = ['no agent holds the id p-a', 'the tasks list shows none for it', 'the view moved meanwhile'].map(
      reason => `Ansicht nicht möglich: ${reason}`,
    )
    expect(toasts).toEqual([...reasons, ...reasons])
  })

  test('a plugin\'s hook that refuses the view rejects the call: its reason as a toast all the same, no second try', async ($, on) => {
    const { views, toasts } = await clickable($, on, () => ({ refuse: 'blocked by policy plugin' }))
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      await ui.press({ key: 'r1' })
      await ui.unmount()
    }
    expect(views).toEqual([{ agentId: 'r1' }, { agentId: 'r1' }])
    expect(toasts).toEqual(['Ansicht nicht möglich: blocked by policy plugin', 'Ansicht nicht möglich: blocked by policy plugin'])
  })

  /**
   * A workflow's agents, never listed (wf-1 running, wf-2 finished), and an
   * ordinary one (g-1), all spawned after load; every view asked for and
   * every toast raised, the engine answering each view as `answer` says.
   */
  async function workflowWorld($: Engine, on: On, answer: UiViewResult = {}) {
    const clock = engine(on)
    const ids: Readonly<Record<string, string>> = { 'prüfen: model.ts': 'wf-1', 'prüfen: view.tsx': 'wf-2', 'review diff': 'g-1' }
    on('agent.spawn', (_, e) => ({ model: 'm', agentId: ids[e.description] ?? 'unknown' }))
    const views: SiteView[] = []
    const toasts: string[] = []
    on('ui.view', (_, e) => {
      views.push(e)
      return { value: answer }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    await start($)
    await $.agent.spawn({ ...SPAWN, description: 'prüfen: model.ts', subagentType: 'workflow-subagent' })
    await $.agent.spawn({ ...SPAWN, description: 'prüfen: view.tsx', subagentType: 'workflow-subagent' })
    await $.agent.spawn({ ...SPAWN, description: 'review diff', subagentType: 'general-purpose' })
    await $.turn.start({ text: '', turnId: 'w', agentId: 'wf-1' })
    await $.turn.start({ text: '', turnId: 'w2', agentId: 'wf-2' })
    await $.turn.complete({ turnId: 'w2', agentId: 'wf-2', durationMs: 1000, ...ANSWERED })
    await clock.advance(1000)
    return { views, toasts }
  }

  test('a workflow\'s agent has no view: a press asks for none and says „Workflow-Agents siehst du über /workflows“; other agents still ask', async ($, on) => {
    const { views, toasts } = await workflowWorld($, on)
    for (const surface of SURFACES) {
      // The full card and the compact view alike.
      for (const [columns, rows] of [[90, 80], [48, 12]] as const) {
        const ui = await agentsTab($, surface, columns, rows)
        // The running one's row and the finished one's.
        for (const id of ['wf-1', 'wf-2', 'g-1']) expect((await ui.find({ type: 'Button', key: id }))?.key).toBe(id)
        await ui.press({ key: 'wf-1' })
        await ui.press({ key: 'wf-2' })
        await ui.press({ key: 'g-1' })
        await ui.unmount()
      }
    }
    // $.ui.view only for the ordinary agent, once a press; a workflow's agent a toast every press.
    expect(views).toEqual(Array.from({ length: 4 }, () => ({ agentId: 'g-1' })))
    expect(toasts).toEqual(Array.from({ length: 8 }, () => 'Workflow-Agents siehst du über /workflows'))
  })

  test('in English: the workflow agent\'s toast, and a refused view after „View not possible:“', { options: { language: 'en' } }, async ($, on) => {
    const { views, toasts } = await workflowWorld($, on, { deny: 'no agent under that id\nsee the tasks list' })
    const ui = await agentsTab($, 'terminal')
    await ui.press({ key: 'wf-1' })
    await ui.press({ key: 'g-1' })
    await ui.unmount()
    expect(views).toEqual([{ agentId: 'g-1' }])
    expect(toasts).toEqual(['You see workflow agents in /workflows', 'View not possible: no agent under that id'])
  })

  test('while an agent is in the main view: the way back on top in the accent, where Enter goes under it; a press shows the main chat', async ($, on) => {
    const { views } = await clickable($, on)
    for (const surface of SURFACES) {
      // The main chat in view: no way back.
      const main = await agentsTabViewing($, surface, null)
      expect(await main.find({ type: 'Button', key: 'main-chat' })).toBeUndefined()
      expect(await main.find({ type: 'Text', text: /Haupt-Chat · du siehst|Enter im Prompt/ })).toBeUndefined()
      await main.unmount()

      // The full card (80 rows) and the compact view (12): the way back on top of either.
      for (const [rows, first] of [[80, /^▸ Verarbeitet seit Laden/], [12, /^AGENTS /]] as const) {
        const ui = await agentsTabViewing($, surface, 'p-b', 90, rows)
        expect((await ui.find({ type: 'Button', key: 'main-chat' }))?.text).toBe('◀ Haupt-Chat · du siehst gerade prüfen: b.ts')
        const texts = await ui.findAll({ type: 'Text' })
        expect(texts.some(found => found.text === '◀ Haupt-Chat · du siehst gerade prüfen: b.ts' && found.props.color === 'claude')).toBe(true)
        expect(texts.some(found => found.text === 'Enter im Prompt geht jetzt an diesen Agent' && found.props.dimColor === true)).toBe(true)
        const at = (pattern: RegExp) => texts.findIndex(found => pattern.test(found.text))
        expect(at(/^◀ Haupt-Chat/)).toBeGreaterThanOrEqual(0)
        expect(at(/^◀ Haupt-Chat/)).toBeLessThan(at(/^Enter im Prompt/))
        expect(at(/^Enter im Prompt/)).toBeLessThan(at(first))
        await ui.press({ key: 'main-chat' })
        expect(views.at(-1)).toEqual({})
        await ui.unmount()
      }

      // An agent the tab does not know (from before load, or past its 50): named as such.
      const unknown = await agentsTabViewing($, surface, 'gone-1')
      expect((await unknown.find({ type: 'Button', key: 'main-chat' }))?.text).toBe('◀ Haupt-Chat · du siehst gerade einen Agent')
      await unknown.unmount()
    }
  })

  test('the row of the agent in the main view is marked across its line, on the accent; the mark follows the view', async ($, on) => {
    await clickable($, on)
    for (const surface of SURFACES) {
      const ui = await agentsTabViewing($, surface, 'p-b')
      const marked = await markedTexts(ui)
      expect(marked).toContain('b.ts')
      // The whole line: its indent, the gap before the figures, the figures.
      expect(marked).toContain('    ')
      expect(marked.some(text => /^– +–$/.test(text))).toBe(true)
      expect(marked).not.toContain('a.ts')
      expect(marked).not.toContain('review diff')

      await ui.redraw(viewing('p-c'))
      expect(await markedTexts(ui)).toContain('c.ts')
      expect(await markedTexts(ui)).not.toContain('b.ts')
      await ui.redraw(viewing('r1'))
      expect(await markedTexts(ui)).toContain('review diff')
      expect(await markedTexts(ui)).not.toContain('c.ts')
      // The main chat in view again: nothing marked, no way back.
      await ui.redraw(viewing(null))
      expect(await markedTexts(ui)).toEqual([])
      expect(await ui.find({ type: 'Button', key: 'main-chat' })).toBeUndefined()
      await ui.unmount()

      // The compact view marks the running agent's line as well.
      const short = await agentsTabViewing($, surface, 'r1', 48, 12)
      expect(await markedTexts(short)).toContain('review diff')
      await short.redraw(viewing('s1', 48, 12))
      expect(await markedTexts(short)).toContain('solo task –')
      expect(await markedTexts(short)).not.toContain('review diff')
      await short.unmount()
    }
  })

  test('a group\'s head folds it, ▾ open, ▸ closed: the full card open, the compact view closed, each kept apart and across redraws', async ($, on) => {
    // Kept in $.state, in the contract's shape, not in the module: what each press wrote.
    const written: unknown[] = []
    on('state.set', { plugin: 'noxdeck' }, (_, e, next) => {
      if (e.key === 'agentFolds') written.push(e.value)
      return next(e)
    })
    on('session.end', (_, e) => ({ sessionId: e.sessionId }))
    await clickable($, on)
    const head = async (ui: { find: (q: { type: string; key: string }) => Promise<Found | undefined> }) =>
      (await ui.find({ type: 'Button', key: 'group-prüfen' }))?.text ?? ''
    const members = async (ui: { find: (q: { type: string; key: string }) => Promise<Found | undefined> }) => {
      const found = []
      for (const id of ['p-a', 'p-b', 'p-c', 'p-d']) if ((await ui.find({ type: 'Button', key: id })) !== undefined) found.push(id)
      return found
    }
    for (const surface of SURFACES) {
      // The full card: open, its agents under it; a press closes it.
      let ui = await agentsTab($, surface)
      expect(await head(ui)).toMatch(/^✓ ▾ prüfen ×4 /)
      expect(await members(ui)).toEqual(['p-a', 'p-b', 'p-c', 'p-d'])
      await ui.press({ key: 'group-prüfen' })
      expect(await head(ui)).toMatch(/^✓ ▸ prüfen ×4 /)
      expect(await members(ui)).toEqual([])
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: ['prüfen'], opened: [] } })
      // Kept when the pane draws again, and in a new drawing.
      await ui.redraw()
      expect(await head(ui)).toMatch(/^✓ ▸ prüfen ×4 /)
      await ui.unmount()
      ui = await agentsTab($, surface)
      expect(await head(ui)).toMatch(/^✓ ▸ prüfen ×4 /)
      expect(await members(ui)).toEqual([])
      await ui.unmount()

      // The compact view: closed by default, whatever the full card does; a press opens it there.
      let short = await agentsTab($, surface, 48, 12)
      expect(await head(short)).toMatch(/^✓ ▸ prüfen ×4 /)
      expect(await members(short)).toEqual([])
      await short.press({ key: 'group-prüfen' })
      expect(await head(short)).toMatch(/^✓ ▾ prüfen ×4 /)
      expect((await members(short)).slice(0, 2)).toEqual(['p-a', 'p-b'])
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: ['prüfen'], opened: ['prüfen'] } })
      await short.redraw()
      expect(await head(short)).toMatch(/^✓ ▾ prüfen ×4 /)
      await short.unmount()
      // The full card's own fold stands.
      ui = await agentsTab($, surface)
      expect(await head(ui)).toMatch(/^✓ ▸ prüfen ×4 /)

      // Both back to their defaults for the next surface.
      await ui.press({ key: 'group-prüfen' })
      expect(await head(ui)).toMatch(/^✓ ▾ prüfen ×4 /)
      await ui.unmount()
      short = await agentsTab($, surface, 48, 12)
      await short.press({ key: 'group-prüfen' })
      expect(await head(short)).toMatch(/^✓ ▸ prüfen ×4 /)
      await short.unmount()
    }
    // Folded once more, then /clear: another conversation starts with every view at its default.
    const ui = await agentsTab($, 'terminal')
    await ui.press({ key: 'group-prüfen' })
    await ui.unmount()
    expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: ['prüfen'], opened: [] } })
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: [], opened: [] } })
  })

  test('in the narrowest pane a group\'s indent gives way, never the figures', async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    modelBeneath(on, () => usageOf(0, 0, 6200 * K, 0))
    await start($)
    await spawnListed($, world, [done('p-a', 'prüfen: a.ts'), done('p-b', 'prüfen: b.ts'), done('s1', 'solo')])
    for (const id of ['p-a', 'p-b', 's1']) {
      await $.turn.start({ text: '', turnId: id, agentId: id })
      await step($, id)
      await $.turn.complete({ turnId: id, agentId: id, durationMs: 3_725_000, ...ANSWERED })
    }
    await clock.advance(1000)
    for (const columns of [24, 25, 26, 30]) {
      const ui = await agentsTab($, 'terminal', columns)
      const rows = (await ui.findAll({ type: 'Button' })).filter(found => !found.key?.startsWith('tab-') && found.key !== 'processed')
      expect(rows.map(found => found.key)).toEqual(['s1', 'group-prüfen', 'p-a', 'p-b'])
      // Every row its card's width, the figures whole at its end.
      for (const row of rows) expect(cellsOf(row.text)).toBe(columns - 8)
      expect(rows[0]?.text).toMatch(/^✓ .* 6,2M 1:02:05$/)
      expect(rows[1]?.text).toMatch(/^✓ ?▾.* 12,4M +0:00$/)
      expect(rows[2]?.text).toMatch(/ 6,2M 1:02:05$/)
      await ui.unmount()
    }
  })

  test('wide characters in a description (CJK, an emoji) are measured in cells: the row keeps its width, its figures whole', async ($, on) => {
    expect([cellsOf('差分'), cellsOf('✅'), cellsOf('ü'), cellsOf('u\u0308'), cellsOf('◉ ✓ ✗ ■ ▾ ▸ █ ◀')]).toEqual([4, 2, 1, 1, 15])
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    await start($)
    await spawnListed($, world, [
      running('r1', '差分を確認する'),
      done('s1', '✅ テストを実行'),
      done('p-a', 'prüfen: 表示.ts'),
      done('p-b', 'prüfen: b.ts'),
    ])
    await $.turn.start({ text: '', turnId: 'r', agentId: 'r1' })
    await clock.advance(83_000)
    for (const [columns, rows, width] of [[52, 80, 44], [36, 80, 28], [52, 12, 46], [30, 12, 24]] as const) {
      const ui = await agentsTab($, 'terminal', columns, rows)
      const drawn = (await ui.findAll({ type: 'Button' })).filter(found => !found.key?.startsWith('tab-'))
      expect(drawn.length).toBeGreaterThan(1)
      for (const row of drawn) expect(cellsOf(row.text)).toBe(width)
      const r1 = drawn.find(found => found.key === 'r1')?.text ?? ''
      expect(r1).toMatch(rows === 80 ? / – 1:23$/ : /1:23 · – *$/)
      await ui.unmount()
    }
  })

  /**
   * The pots for the table: the main chat's steps (78k processed with a
   * block of 2k + 70k + 5k = 77k, then 62k with a smaller one, 1k + 57k + 2k =
   * 60k, as after a compaction), a finished agent's step (95k), a fork's
   * (23k); and a group of two finished agents no step was seen of.
   */
  async function potsWorld($: Engine, on: On, mainSteps = 2) {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    modelBeneath(on, e =>
      e.agentId === undefined
        ? e.index === 0
          ? usageOf(2 * K, 1 * K, 70 * K, 5 * K)
          : usageOf(1 * K, 2 * K, 57 * K, 2 * K)
        : e.agentId === 'a1'
          ? usageOf(1 * K, 3 * K, 70 * K, 21 * K)
          : usageOf(3 * K, 0, 20 * K, 0),
    )
    await start($)
    await spawnListed($, world, [done('a1', 'review diff'), done('p-a', 'prüfen: a.ts'), done('p-b', 'prüfen: b.ts')])
    for (let index = 0; index < mainSteps; index += 1) await step($, null, { index })
    await step($, 'a1')
    await step($, 'fork-1')
    await clock.advance(1000)
  }

  /** The head of what the pots processed, as its Button draws it, the padding after it cut. */
  const processedHead = async (ui: { find: (q: { type: string; key: string }) => Promise<Found | undefined> }) =>
    (await ui.find({ type: 'Button', key: 'processed' }))?.text.trimEnd()

  test('„Verarbeitet seit Laden“ is a Button of its own: ▸ the pots after it, ▾ a table in their place; kept in $.state across redraws', async ($, on) => {
    // Kept in $.state, in the contract's shape: what each press wrote.
    const written: unknown[] = []
    on('state.set', { plugin: 'noxdeck' }, (_, e, next) => {
      if (e.key === 'isProcessedOpen') written.push(e.value)
      return next(e)
    })
    await potsWorld($, on)
    for (const surface of SURFACES) {
      // Closed: the pots after the head, as before.
      let ui = await agentsTab($, surface)
      expect(await processedHead(ui)).toBe('▸ Verarbeitet seit Laden · Haupt-Chat 140k · Agents 95k · Sonstiges 23k')
      expect(has(await ui.findAll({ type: 'Text' }), /du \+ Claude|Jeder Schritt/)).toBe(false)

      // A press opens it: the head alone, the table under it.
      await ui.press({ key: 'processed' })
      expect(await processedHead(ui)).toBe('▾ Verarbeitet seit Laden')
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: true })
      expect(has(await ui.findAll({ type: 'Text' }), /^Haupt-Chat 140k/)).toBe(false)
      expect(has(await ui.findAll({ type: 'Text' }), /^Haupt-Chat +du \+ Claude/)).toBe(true)

      // Kept when the pane draws again, and in a new drawing.
      await ui.redraw()
      expect(await processedHead(ui)).toBe('▾ Verarbeitet seit Laden')
      await ui.unmount()
      ui = await agentsTab($, surface)
      expect(await processedHead(ui)).toBe('▾ Verarbeitet seit Laden')
      expect(has(await ui.findAll({ type: 'Text' }), /^Haupt-Chat +du \+ Claude/)).toBe(true)

      // A press closes it again, and that is kept too.
      await ui.press({ key: 'processed' })
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: false })
      await ui.redraw()
      expect(await processedHead(ui)).toBe('▸ Verarbeitet seit Laden · Haupt-Chat 140k · Agents 95k · Sonstiges 23k')
      expect(has(await ui.findAll({ type: 'Text' }), /du \+ Claude|Jeder Schritt/)).toBe(false)
      await ui.unmount()
    }
  })

  test('the table: wer · Block · verarbeitet from the three pots, heads dim, figures right-aligned; B, N and Ø from the main chat\'s steps', async ($, on) => {
    await potsWorld($, on)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      await ui.press({ key: 'processed' })
      const texts = await ui.findAll({ type: 'Text' })
      const line = (pattern: RegExp) => texts.find(found => pattern.test(found.text))?.text ?? ''
      // B: input, cache read and cache creation of the main chat's last step (1k + 57k + 2k), not the larger
      // first one's 77k. Processed: the pots as the closed head sums them (78k + 62k; the agent's 95k; the fork's 23k).
      const rows = [
        line(/^wer +Block +verarbeitet$/),
        line(/^Haupt-Chat +du \+ Claude +60k +140k$/),
        line(/^Agents +Helfer +eigene +95k$/),
        line(/^Sonstiges +Haushalt +– +23k$/),
      ]
      expect(rows.every(row => row !== '')).toBe(true)
      // Right-aligned: every row as wide, so the figures end in one column, under their heads.
      expect(new Set(rows.map(cellsOf)).size).toBe(1)
      for (const [row, block] of [[rows[1], '60k'], [rows[2], 'eigene'], [rows[3], '–']] as const) {
        expect(row?.indexOf(block) ?? -1).toBe((rows[0]?.indexOf('Block') ?? 0) + 'Block'.length - block.length)
      }
      expect(has(texts, /77k/)).toBe(false)
      // The column heads dim.
      for (const head of ['wer', 'Block', 'verarbeitet']) expect(texts.some(found => found.text === head && found.props.dimColor === true)).toBe(true)
      // Under the table, dim: each step reads the whole block again; N steps × Ø (processed ÷ N, 140k ÷ 2).
      expect(texts.some(found => found.text === 'Jeder Schritt liest den ganzen Block neu:' && found.props.dimColor === true)).toBe(true)
      expect(texts.some(found => found.text === 'Haupt-Chat 2 Schritte × ~70k ≈ 140k' && found.props.dimColor === true)).toBe(true)
      // In that order, between the head and the finished agents.
      const at = (pattern: RegExp) => texts.findIndex(found => pattern.test(found.text))
      const order = [/^▾ Verarbeitet seit Laden/, /^wer /, /^Haupt-Chat +du/, /^Agents +Helfer/, /^Sonstiges +Haushalt/, /^Jeder Schritt/, /^Haupt-Chat 2 Schritte/, /^✓ review diff/]
      const places = order.map(at)
      expect(places.every(place => place >= 0)).toBe(true)
      expect([...places].sort((a, b) => a - b)).toEqual(places)
      // Every cell of the rows drawn in the text color, none dim as the heads are.
      const table = texts.slice(at(/^wer /), at(/^Jeder Schritt/))
      for (const cell of ['Haupt-Chat', 'du + Claude', '60k', '140k', 'Agents', 'Helfer', 'eigene', '95k', 'Sonstiges', 'Haushalt', '–', '23k']) {
        expect(table.some(found => found.text === cell && found.props.color === 'text' && found.props.dimColor !== true)).toBe(true)
        expect(table.some(found => found.text === cell && found.props.dimColor === true)).toBe(false)
      }
      // Closed again for the next surface.
      await ui.press({ key: 'processed' })
      await ui.unmount()
    }
  })

  test('one main step: „1 Schritt“, Ø the step itself; no step yet: B –, the sum line left out', async ($, on) => {
    on('session.end', (_, e) => ({ sessionId: e.sessionId }))
    await potsWorld($, on, 1)
    let ui = await agentsTab($, 'terminal')
    await ui.press({ key: 'processed' })
    let texts = await ui.findAll({ type: 'Text' })
    // B: 2k + 70k + 5k of the one step; it processed 78k, output included.
    expect(has(texts, /^Haupt-Chat +du \+ Claude +77k +78k$/)).toBe(true)
    expect(has(texts, /^Haupt-Chat 1 Schritt × ~78k ≈ 78k$/)).toBe(true)
    await ui.unmount()

    // A conversation started over: no step of the main chat yet. The table stays open, as the tab stays.
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    ui = await agentsTab($, 'terminal')
    expect(await processedHead(ui)).toBe('▾ Verarbeitet seit Laden')
    texts = await ui.findAll({ type: 'Text' })
    expect(has(texts, /^Haupt-Chat +du \+ Claude +– +0$/)).toBe(true)
    expect(has(texts, /^Agents +Helfer +eigene +0$/)).toBe(true)
    expect(has(texts, /^Sonstiges +Haushalt +– +0$/)).toBe(true)
    expect(has(texts, /^Jeder Schritt liest den ganzen Block neu:$/)).toBe(true)
    expect(has(texts, /Schritte? ×/)).toBe(false)
    await ui.unmount()
  })

  test('the compact view shows no table and no head to press, open or not', async ($, on) => {
    await potsWorld($, on)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      await ui.press({ key: 'processed' })
      await ui.unmount()
      const short = await agentsTab($, surface, 48, 10)
      const texts = await short.findAll({ type: 'Text' })
      expect(has(texts, /^ 3 ✓ · verarbeitet 95k$/)).toBe(true)
      expect(await short.find({ type: 'Button', key: 'processed' })).toBeUndefined()
      expect(has(texts, /Verarbeitet seit Laden|du \+ Claude|Helfer|Haushalt|Jeder Schritt|Schritte ×|Summe aller Schritte/)).toBe(false)
      await short.unmount()
      // Back to closed for the next surface.
      const again = await agentsTab($, surface)
      await again.press({ key: 'processed' })
      await again.unmount()
    }
  })

  test('opening the table never swaps the full card for the compact view: whether it fits is judged closed', async ($, on) => {
    await potsWorld($, on)
    // Rows just enough for the closed card on the terminal: 3 head lines at 48 columns, 4 agent rows, 2 footer rows, the frame.
    const ui = await agentsTab($, 'terminal', 48, 15)
    expect(await processedHead(ui)).toMatch(/^▸ /)
    await ui.press({ key: 'processed' })
    expect(await processedHead(ui)).toBe('▾ Verarbeitet seit Laden')
    expect(has(await ui.findAll({ type: 'Text' }), /^Haupt-Chat +du \+ Claude/)).toBe(true)
    await ui.press({ key: 'processed' })
    await ui.unmount()
    // A row less: the card shortened, the table kept; opened, the card stays shortened as it was.
    const shorter = await agentsTab($, 'terminal', 48, 14)
    expect(await processedHead(shorter)).toMatch(/^▸ /)
    expect(has(await shorter.findAll({ type: 'Text' }), /^Zeitleiste/)).toBe(false)
    await shorter.press({ key: 'processed' })
    expect(await processedHead(shorter)).toBe('▾ Verarbeitet seit Laden')
    expect(has(await shorter.findAll({ type: 'Text' }), /^Zeitleiste/)).toBe(false)
    await shorter.press({ key: 'processed' })
    await shorter.unmount()
    // Too short for even the shortened card: the compact view, which has no table.
    const short = await agentsTab($, 'terminal', 48, 8)
    expect(await short.find({ type: 'Button', key: 'processed' })).toBeUndefined()
    await short.unmount()
  })

  test('nothing reaches past the frame: the head, the table, the lines under it and the footer, at every width, open and closed', async ($, on) => {
    await potsWorld($, on)
    for (const surface of SURFACES) {
      for (const columns of [24, 30, 40, 48, 60, 90]) {
        const width = columns - 8
        for (const isOpen of [false, true]) {
          const ui = await agentsTab($, surface, columns)
          if (isOpen) await ui.press({ key: 'processed' })
          // The head is a row the card's width, its words cut where they must be.
          expect(cellsOf((await ui.find({ type: 'Button', key: 'processed' }))?.text ?? '')).toBe(width)
          const texts = await ui.findAll({ type: 'Text' })
          const over = texts.filter(found => cellsOf(found.text) > width).map(found => found.text)
          expect(over).toEqual([])
          // The figures stay whole in the narrowest table; the footer breaks into rows instead.
          if (isOpen) {
            expect(texts.some(found => found.text === '140k')).toBe(true)
            expect(texts.some(found => found.text === 'eigene')).toBe(true)
          }
          // At 48 columns, the width the pane docks at: the table's last head shorter, its gaps wide; the
          // line under it in two even rows, no word left alone.
          if (isOpen && columns === 48) {
            expect(has(texts, /^wer {23}Block {2}verarb\.$/)).toBe(true)
            expect(has(texts, /^Haupt-Chat {2}du \+ Claude {5}60k {5}140k$/)).toBe(true)
            expect(has(texts, /^Jeder Schritt liest$/)).toBe(true)
            expect(has(texts, /^den ganzen Block neu:$/)).toBe(true)
          }
          // The footer's rows, the card's last: its words whole and in order, as many rows as counted.
          const note = 'Verarbeitet = Summe aller Schritte, inkl. Wiederholung aus dem Cache'
          const footer: string[] = []
          for (const found of texts.slice(texts.findIndex(one => one.text.startsWith('Verarbeitet =')))) {
            if (found.props.dimColor !== true || found.text.startsWith(' ')) break
            footer.push(found.text)
          }
          expect(footer.join(' ')).toBe(note)
          expect(footer.length).toBe(wrappedRows(note, width))
          if (isOpen) await ui.press({ key: 'processed' })
          await ui.unmount()
        }
      }
    }
  })

  test('a closed group holding the agent in the main view: its head on the accent, in the full card and the compact view', async ($, on) => {
    await clickable($, on)
    for (const surface of SURFACES) {
      // The full card shows prüfen open: the agent's row is marked, not the head.
      const ui = await agentsTabViewing($, surface, 'p-b')
      expect(await markedTexts(ui)).toContain('b.ts')
      expect(await markedTexts(ui)).not.toContain('prüfen ×4')
      // Closed: the head is marked across its line, the agent's row gone.
      await ui.press({ key: 'group-prüfen' })
      const marked = await markedTexts(ui)
      expect(marked).toContain('prüfen ×4')
      expect(marked).toContain('▸')
      expect(marked).not.toContain('b.ts')
      // Another agent in view: the head no longer.
      await ui.redraw(viewing('s1'))
      expect(await markedTexts(ui)).not.toContain('prüfen ×4')
      expect(await markedTexts(ui)).toContain('solo task')
      await ui.redraw(viewing(null))
      expect(await markedTexts(ui)).toEqual([])
      await ui.press({ key: 'group-prüfen' })
      await ui.unmount()

      // The compact view shows its groups closed: the head marked while one of its agents is in view.
      const short = await agentsTabViewing($, surface, 'p-c', 48, 12)
      expect(await markedTexts(short)).toContain('prüfen ×4 –')
      await short.redraw(viewing('r1', 48, 12))
      expect(await markedTexts(short)).not.toContain('prüfen ×4 –')
      expect(await markedTexts(short)).toContain('review diff')
      await short.unmount()
      // Opened there: its agent's row marked instead (a row more, so a.ts fits under the head on the desktop too).
      const opened = await agentsTabViewing($, surface, 'p-a', 48, 13)
      expect(await markedTexts(opened)).toContain('prüfen ×4 –')
      await opened.press({ key: 'group-prüfen' })
      expect(await markedTexts(opened)).not.toContain('prüfen ×4 –')
      expect(await markedTexts(opened)).toContain('a.ts –')
      await opened.press({ key: 'group-prüfen' })
      await opened.unmount()
    }
  })

  test('noxdeck reads no agent\'s messages: drawing, a press, a fold and the way back ask for no transcript', async ($, on) => {
    const asked: string[] = []
    on('session.messages', () => {
      asked.push('messages')
      return { value: [] } as never
    })
    on('session.turns', () => {
      asked.push('turns')
      return { value: [] } as never
    })
    await clickable($, on)
    for (const surface of SURFACES) {
      const ui = await agentsTabViewing($, surface, 'p-a')
      await ui.press({ key: 'p-b' })
      await ui.press({ key: 'group-prüfen' })
      await ui.press({ key: 'group-prüfen' })
      await ui.press({ key: 'processed' })
      await ui.press({ key: 'processed' })
      await ui.press({ key: 'main-chat' })
      await ui.unmount()
    }
    expect(asked).toEqual([])
  })

  /**
   * Running agents and finished ones, all spawned after load. Finished:
   * `solo task` (s1, no step seen) and `prüfen: x.ts`, `y.ts` (400k and
   * 130k, from 0:00 to 0:01). Running: `review diff` (r1, 50k, from 0:00)
   * and, spawned at 0:01, `verify: a.ts`, `b.ts`, `c.ts` (100k, 200k, 300k),
   * started at 0:01, 0:11 and 0:21, c.ts a workflow's agent; a.ts read
   * a.ts at 0:21. The clock at 1:24; every view asked for and every toast kept.
   */
  async function runningWorld($: Engine, on: On) {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    const views: SiteView[] = []
    const toasts: string[] = []
    on('ui.view', (_, e) => {
      views.push(e)
      return { value: {} }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('tool.call', () => READ_RESULT)
    // l1 only where a test spawns it.
    const read: Readonly<Record<string, number>> = { 'p-x': 400 * K, 'p-y': 130 * K, 'v-a': 100 * K, 'v-b': 200 * K, 'v-c': 300 * K, l1: 12_400 * K }
    // r1: context 1k + 47k, processed 50k, new 1k + 2k.
    modelBeneath(on, e => (e.agentId === 'r1' ? usageOf(1 * K, 2 * K, 47 * K, 0) : usageOf(0, 0, read[e.agentId ?? ''] ?? 0, 0)))
    await start($)
    const begin = async (id: string) => {
      await $.turn.start({ text: '', turnId: id, agentId: id })
      await step($, id)
    }
    await spawnListed($, world, [done('s1', 'solo task'), done('p-x', 'prüfen: x.ts'), done('p-y', 'prüfen: y.ts'), running('r1', 'review diff')])
    for (const id of ['p-x', 'p-y', 'r1']) await begin(id)
    await clock.advance(1000)
    for (const id of ['p-x', 'p-y']) await $.turn.complete({ turnId: id, agentId: id, durationMs: 1000, ...ANSWERED })
    await spawnListed($, world, [
      running('v-a', 'verify: a.ts'),
      running('v-b', 'verify: b.ts'),
      { id: 'v-c', description: 'verify: c.ts', type: 'workflow-subagent', status: 'running' },
    ])
    await begin('v-a')
    await clock.advance(10_000)
    await begin('v-b')
    await clock.advance(10_000)
    await begin('v-c')
    await $.tool.call({ tool: 'Read', file_path: '/proj/very/private/a.ts', agentId: 'v-a' })
    await clock.advance(63_000)
    return { views, toasts, world }
  }

  /** The parts of the row whose whole text matches `pattern`: the Texts after its wrapper, up to the next row's. */
  const partsOf = (texts: readonly Found[], pattern: RegExp) => {
    const at = texts.findIndex(found => found.props.wrap !== undefined && pattern.test(found.text))
    if (at < 0) return []
    const next = texts.findIndex((found, i) => i > at && found.props.wrap !== undefined)
    return texts.slice(at + 1, next < 0 ? undefined : next)
  }

  /** The agents' rows (their Buttons, the tabs and the pots' head aside) by key. */
  const rowsOf = async (ui: { findAll: (q: { type: string }) => Promise<(Found & { key?: string })[]> }) =>
    Object.fromEntries(
      (await ui.findAll({ type: 'Button' })).filter(found => !found.key?.startsWith('tab-') && found.key !== 'processed').map(found => [found.key ?? '', found.text]),
    )

  test('running agents by the words before „:“: a head on the accent with their sum and the time since the first start, each agent by the rest of its name', async ($, on) => {
    await runningWorld($, on)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      const texts = await ui.findAll({ type: 'Text' })
      const rows = await rowsOf(ui)
      // The head: ◉ ▾ verify ×3 on the accent; 100k + 200k + 300k, white and bold; from a.ts's start at 0:01 to now, 1:23, in the accent.
      expect(texts.some(found => found.text === '◉ ▾ verify ×3' && found.props.backgroundColor === 'claude' && found.props.color === 'inverseText' && found.props.bold === true)).toBe(true)
      // Each agent a row: ◉, the rest of its name, what it processed (white, bold) and its own time (accent); no „läuft“.
      // An agent without a group alone, by its whole name.
      const figures = [
        [/^◉ ▾ verify ×3 +600k 1:23$/, '600k', '1:23'],
        [/^ {2}◉ a\.ts +100k 1:23$/, '100k', '1:23'],
        [/^ {2}◉ b\.ts +200k 1:13$/, '200k', '1:13'],
        [/^ {2}◉ c\.ts workflow-subagent +300k 1:03$/, '300k', '1:03'],
        [/^◉ review diff +50k 1:24$/, '50k', '1:24'],
      ] as const
      for (const [row, processed, time] of figures) {
        const parts = partsOf(texts, row)
        expect(parts.some(found => found.text === processed && found.props.color === 'text' && found.props.bold === true)).toBe(true)
        expect(parts.some(found => found.text === time && found.props.color === 'claude' && found.props.backgroundColor === undefined)).toBe(true)
      }
      expect(rows['group-live:verify']).toMatch(/^◉ ▾ verify ×3 +600k 1:23$/)
      expect(has(texts, /^verify: [abc]\.ts$|^läuft/)).toBe(false)
      // Under each, as before: model · effort · steps dim, the figures in the text color, the last call dim; a group's agent's under its name.
      const line = (text: string, look: 'dim' | 'text') =>
        texts.some(found => found.text === text && (look === 'dim' ? found.props.dimColor === true : found.props.color === 'text' && found.props.dimColor !== true))
      expect(line('    opus · high · 1 Schritt', 'dim')).toBe(true)
      expect(line('    Kontext 100k · verarbeitet 100k · davon neu 0', 'text')).toBe(true)
      expect(line('    → Read a.ts · vor 1 min', 'dim')).toBe(true)
      expect(line('  opus · high · 1 Schritt', 'dim')).toBe(true)
      expect(line('  Kontext 48k · verarbeitet 50k · davon neu 3k', 'text')).toBe(true)
      await ui.unmount()

      // Where the line has no room for the long words, the short ones, as before.
      const narrow = await agentsTab($, surface, 48)
      const tight = await narrow.findAll({ type: 'Text' })
      expect(tight.some(found => found.text === '    Kontext 100k · verarb. 100k · neu 0' && found.props.color === 'text' && found.props.dimColor !== true)).toBe(true)
      expect(tight.some(found => found.text === '  Kontext 48k · verarb. 50k · neu 3k' && found.props.color === 'text' && found.props.dimColor !== true)).toBe(true)
      await narrow.unmount()
    }
  })

  test('running and finished rows share their columns: what each processed and its time end where the other\'s do', async ($, on) => {
    const { world } = await runningWorld($, on)
    // A finished agent with wider figures than any running one's: 12,4M in over an hour.
    await spawnListed($, world, [done('l1', 'long run')])
    await $.turn.start({ text: '', turnId: 'l1', agentId: 'l1' })
    await step($, 'l1')
    await $.turn.complete({ turnId: 'l1', agentId: 'l1', durationMs: 3_725_000, ...ANSWERED })
    for (const surface of SURFACES) {
      for (const columns of [90, 60, 48, 38]) {
        const ui = await agentsTab($, surface, columns)
        const rows = await rowsOf(ui)
        // The cell a figure ends at, in its row.
        const endOf = (key: string, figure: string) => {
          const text = rows[key] ?? ''
          return cellsOf(text.slice(0, text.lastIndexOf(figure) + figure.length))
        }
        const width = columns - 8
        for (const text of Object.values(rows)) expect(cellsOf(text)).toBe(width)
        // What was processed: one column, as wide as 12,4M, its last cell the time's eight before the edge (` 1:02:05`).
        const processed = [
          endOf('v-a', '100k'),
          endOf('r1', '50k'),
          endOf('group-live:verify', '600k'),
          endOf('p-x', '400k'),
          endOf('group-prüfen', '530k'),
          endOf('l1', '12,4M'),
        ]
        expect(new Set(processed)).toEqual(new Set([width - 8]))
        // The time at the row's end, right-aligned in its column, for every row.
        const times = [endOf('v-a', '1:23'), endOf('r1', '1:24'), endOf('group-live:verify', '1:23'), endOf('p-x', '0:01'), endOf('group-prüfen', '0:01'), endOf('l1', '1:02:05')]
        expect(new Set(times)).toEqual(new Set([width]))
        expect(rows['v-a']).toMatch(/ 100k {4}1:23$/)
        // s1, nothing seen: its – in both columns.
        expect(rows['s1']).toMatch(/ {4}– {7}–$/)
        await ui.unmount()
      }
    }
  })

  test('a dim ┄ between running agents, a dim ─ between them and the finished', async ($, on) => {
    await runningWorld($, on)
    for (const surface of SURFACES) {
      for (const columns of [90, 48]) {
        const ui = await agentsTab($, surface, columns)
        const texts = await ui.findAll({ type: 'Text' })
        const card = texts.slice(0, texts.findIndex(found => /^Zeitleiste/.test(found.text)))
        const marks = card
          .map(found => found.text)
          .filter(text => /^(┄+|─+|◉ ▾ verify ×3|[abcxy]\.ts|review diff|prüfen ×2|solo task)$/.test(text))
          .map(text => (/^┄+$/.test(text) ? '┄' : /^─+$/.test(text) ? '─' : text))
        // The newest group first (verify, spawned after review diff); its agents in start order.
        expect(marks).toEqual(['◉ ▾ verify ×3', 'a.ts', '┄', 'b.ts', '┄', 'c.ts', '┄', 'review diff', '─', 'prüfen ×2', 'x.ts', 'y.ts', 'solo task'])
        // Each a whole row of the card, dim.
        for (const rule of card.filter(found => /^(┄+|─+)$/.test(found.text))) {
          expect(cellsOf(rule.text)).toBe(columns - 8)
          expect(rule.props.dimColor).toBe(true)
        }
        await ui.unmount()
      }
    }
  })

  test('a running group\'s head folds it, its agents\' rows show them, a workflow\'s agent says where to see it; the finished fold apart', async ($, on) => {
    const written: unknown[] = []
    on('state.set', { plugin: 'noxdeck' }, (_, e, next) => {
      if (e.key === 'agentFolds') written.push(e.value)
      return next(e)
    })
    const { views, toasts } = await runningWorld($, on)
    const shown = async (ui: { find: (q: { type: string; key: string }) => Promise<Found | undefined> }) => {
      const found = []
      for (const id of ['v-a', 'v-b', 'v-c', 'r1', 'p-x']) if ((await ui.find({ type: 'Button', key: id })) !== undefined) found.push(id)
      return found
    }
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      expect(await shown(ui)).toEqual(['v-a', 'v-b', 'v-c', 'r1', 'p-x'])
      // Closed: the head alone, its sum and time kept; one ┄ left, between it and review diff. The finished group stays open.
      await ui.press({ key: 'group-live:verify' })
      expect(await shown(ui)).toEqual(['r1', 'p-x'])
      expect((await ui.find({ type: 'Button', key: 'group-live:verify' }))?.text).toMatch(/^◉ ▸ verify ×3 +600k 1:23$/)
      expect((await ui.findAll({ type: 'Text' })).filter(found => /^┄+$/.test(found.text))).toHaveLength(1)
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: ['live:verify'], opened: [] } })
      // Kept across redraws; the finished group of other words folds on its own.
      await ui.redraw()
      expect(await shown(ui)).toEqual(['r1', 'p-x'])
      await ui.press({ key: 'group-prüfen' })
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: ['live:verify', 'prüfen'], opened: [] } })
      expect(await shown(ui)).toEqual(['r1'])
      await ui.press({ key: 'group-prüfen' })
      await ui.press({ key: 'group-live:verify' })
      expect(await shown(ui)).toEqual(['v-a', 'v-b', 'v-c', 'r1', 'p-x'])
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: [], opened: [] } })
      // A press on an agent's row shows its transcript; on a workflow's agent, where to see it instead.
      await ui.press({ key: 'v-b' })
      await ui.press({ key: 'r1' })
      await ui.press({ key: 'v-c' })
      await ui.unmount()

      // Closed while one of its agents is in the main view: the head is marked across its line in that agent's place.
      // (Its name stands on the accent whether marked or not: its figures tell.)
      const viewed = await agentsTabViewing($, surface, 'v-b')
      expect(await markedTexts(viewed)).toContain('b.ts')
      expect(await markedTexts(viewed)).not.toContain('600k')
      await viewed.press({ key: 'group-live:verify' })
      expect(await markedTexts(viewed)).toContain('600k')
      expect(await markedTexts(viewed)).not.toContain('b.ts')
      await viewed.press({ key: 'group-live:verify' })
      expect(await markedTexts(viewed)).not.toContain('600k')
      await viewed.unmount()

      // The compact view: the running group a line, closed, its time and sum as an agent's line says them; opened, its agents.
      const short = await agentsTab($, surface, 48, 12)
      expect((await short.find({ type: 'Button', key: 'group-live:verify' }))?.text).toMatch(/^◉ ▸ verify ×3 1:23 · 600k *$/)
      expect(await short.find({ type: 'Button', key: 'v-a' })).toBeUndefined()
      await short.press({ key: 'group-live:verify' })
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: [], opened: ['live:verify'] } })
      expect((await short.find({ type: 'Button', key: 'group-live:verify' }))?.text).toMatch(/^◉ ▾ verify ×3 1:23 · 600k *$/)
      expect((await short.find({ type: 'Button', key: 'v-a' }))?.text).toMatch(/^ {2}◉ a\.ts 1:23 · 100k → Read a\.ts *$/)
      await short.press({ key: 'v-a' })
      await short.press({ key: 'group-live:verify' })
      expect(await short.find({ type: 'Button', key: 'v-a' })).toBeUndefined()
      await short.unmount()
    }
    expect(views).toEqual([{ agentId: 'v-b' }, { agentId: 'r1' }, { agentId: 'v-a' }, { agentId: 'v-b' }, { agentId: 'r1' }, { agentId: 'v-a' }])
    expect(toasts).toEqual(['Workflow-Agents siehst du über /workflows', 'Workflow-Agents siehst du über /workflows'])
  })

  test('a running group\'s head counts what its agents processed so far and its time from the first start, while one has not stepped or started', async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    modelBeneath(on, () => usageOf(0, 0, 50 * K, 0))
    await start($)
    await spawnListed($, world, [
      running('v-a', 'verify: a.ts'),
      running('v-b', 'verify: b.ts'),
      { id: 'v-c', description: 'verify: c.ts', type: 'general-purpose', status: 'pending' },
    ])
    await $.turn.start({ text: '', turnId: 'a', agentId: 'v-a' })
    await step($, 'v-a')
    await clock.advance(30_000)
    // b.ts starts, its first step not back; c.ts waits, not started.
    await $.turn.start({ text: '', turnId: 'b', agentId: 'v-b' })
    await clock.advance(5000)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface)
      const rows = await rowsOf(ui)
      // a.ts's 50k and nothing yet of the others; the time since a.ts started.
      expect(rows['group-live:verify']).toMatch(/^◉ ▾ verify ×3 +50k 0:35$/)
      expect(rows['v-b']).toMatch(/^ {2}◉ b\.ts +– 0:05$/)
      expect(rows['v-c']).toMatch(/^ {2}○ c\.ts +– +–$/)
      // The timeline has the group, running, from a.ts's start.
      const texts = await ui.findAll({ type: 'Text' })
      expect(has(texts, /^Zeitleiste seit Laden$/)).toBe(true)
      expect(texts.some(found => /^▆+▶$/.test(found.text) && found.props.color === 'claude')).toBe(true)
      await ui.unmount()
    }
  })

  test('the timeline measures its labels in cells: a wide character takes two, every row the card\'s width, its ▶ kept', async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    await start($)
    await spawnListed($, world, [running('k-a', '検証: a.ts'), running('k-b', '検証: b.ts'), running('j1', '日本語のファイルを全部確認する')])
    for (const id of ['k-a', 'k-b', 'j1']) await $.turn.start({ text: '', turnId: id, agentId: id })
    await clock.advance(10_000)
    for (const columns of [48, 90]) {
      const ui = await agentsTab($, 'terminal', columns)
      const texts = await ui.findAll({ type: 'Text' })
      const bars = texts.slice(texts.findIndex(found => /^Zeitleiste/.test(found.text))).filter(found => found.props.wrap === 'truncate' && /▶$/.test(found.text))
      expect(bars).toHaveLength(2)
      for (const bar of bars) expect(cellsOf(bar.text)).toBe(columns - 8)
      // The labels' column a quarter of the card in cells (10 of 40, 20 of 82): 検証 whole, the long name cut where its cells run out.
      const labels = columns === 48 ? ['検証      ', '日本語の… '] : [`検証${' '.repeat(16)}`, '日本語のファイルを… ']
      for (const label of labels) expect(texts.some(found => found.text === label)).toBe(true)
      await ui.unmount()
    }
  })

  test('an odd type is said shorter where the row has no room (general-purpose → general), else left out; never cut', async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    await start($)
    // Explore is the type most have: the others name theirs.
    await spawnListed($, world, [
      done('e1', 'look around', 'Explore'),
      done('e2', 'look further', 'Explore'),
      done('s1', 'set up the line', 'statusline-setup'),
      running('r1', 'review the diff'),
    ])
    await $.turn.start({ text: '', turnId: 'r', agentId: 'r1' })
    await clock.advance(5000)
    // The running row: `◉ `, the name's 15 cells, the type, a gap, `– 0:05`. The finished: `✓ `, the
    // name, the type, a gap, the bar's ten cells and a gap, `–    –`.
    const cases = [
      ['r1', 48, ' general-purpose'],
      ['r1', 47, ' general'],
      ['r1', 40, ' general'],
      ['r1', 39, null],
      ['s1', 90, ' statusline-setup'],
      ['s1', 60, ' statusline-setup'],
      ['s1', 59, ' statusline'],
      ['s1', 54, ' statusline'],
      ['s1', 53, null],
    ] as const
    for (const [key, columns, type] of cases) {
      const ui = await agentsTab($, 'terminal', columns)
      const texts = await ui.findAll({ type: 'Text' })
      const row = (await ui.find({ type: 'Button', key }))?.text ?? ''
      expect(cellsOf(row)).toBe(columns - 8)
      const name = key === 'r1' ? 'review the diff' : 'set up the line'
      // The name whole, the type whole or short or not at all: no ellipsis anywhere in the row.
      expect(row.startsWith(`${key === 'r1' ? '◉' : '✓'} ${name}${type ?? ' '}`)).toBe(true)
      expect(row).not.toContain('…')
      if (type !== null) expect(texts.some(found => found.text === type && found.props.dimColor === true)).toBe(true)
      expect(has(texts, /gen…|general-p…|statusl…|statusline-s…/)).toBe(false)
      await ui.unmount()
    }
  })

  test('the timeline\'s head says „Zeitleiste“ where the row has no room for „Zeitleiste seit Laden“, never broken', async ($, on) => {
    await runningWorld($, on)
    // `Zeitleiste seit Laden 1:24`: 26 cells, so a card of 26 (34 columns) holds it.
    for (const surface of SURFACES) {
      for (const [columns, head] of [[90, 'Zeitleiste seit Laden'], [34, 'Zeitleiste seit Laden'], [33, 'Zeitleiste'], [24, 'Zeitleiste']] as const) {
        const ui = await agentsTab($, surface, columns, 120)
        const texts = await ui.findAll({ type: 'Text' })
        const shown = texts.find(found => /^Zeitleiste/.test(found.text))
        expect(shown?.text).toBe(head)
        expect(shown?.props.wrap).toBe('truncate-end')
        expect(shown?.props.dimColor).toBe(true)
        expect(cellsOf(head) + 1 + '1:24'.length).toBeLessThanOrEqual(columns - 8)
        expect(texts.some(found => found.text === '1:24' && found.props.dimColor === true)).toBe(true)
        await ui.unmount()
      }
    }
  })

  test('the timeline\'s head in English: Timeline where the row has no room', { options: { language: 'en' } }, async ($, on) => {
    await runningWorld($, on)
    for (const [columns, head] of [[90, 'Timeline since load'], [32, 'Timeline since load'], [31, 'Timeline']] as const) {
      const ui = await agentsTab($, 'terminal', columns, 120)
      expect((await ui.findAll({ type: 'Text' })).find(found => /^Timeline/.test(found.text))?.text).toBe(head)
      await ui.unmount()
    }
  })

  test('the bars are whole cells of ▆, their empty rest dim ▆, in the Agents tab and the timeline; no █ and no part of a block', async ($, on) => {
    await runningWorld($, on)
    for (const surface of SURFACES) {
      // p-y processed 130k of the largest 400k: 3,25 of ten cells is three, 1,95 of six two; no bar where the row has no room.
      for (const [columns, bar, full] of [[90, 10, 3], [60, 10, 3], [38, 6, 2], [30, 0, 0]] as const) {
        const ui = await agentsTab($, surface, columns, 120)
        const texts = await ui.findAll({ type: 'Text' })
        expect(has(texts, /[█▇▅▄▃▂▁▉▊▋▌▍▎▏▐▕]/)).toBe(false)
        const row = (await ui.find({ type: 'Button', key: 'p-y' }))?.text ?? ''
        expect(row.match(/▆/g)?.length ?? 0).toBe(bar)
        if (bar > 0) {
          expect(row).toContain(`${'▆'.repeat(bar)} 130k`)
          expect(texts.some(found => found.text === '▆'.repeat(full) && found.props.color === 'success')).toBe(true)
          expect(texts.some(found => found.text === '▆'.repeat(bar - full) && found.props.dimColor === true && found.props.color === undefined)).toBe(true)
          expect((await ui.find({ type: 'Button', key: 'p-x' }))?.text).toContain(`${'▆'.repeat(bar)} 400k`)
        }
        // The timeline: its bars in ▆ (▶ where a group still runs), the dotted track around them as before.
        const timeline = texts.slice(texts.findIndex(found => /^Zeitleiste/.test(found.text)))
        expect(timeline.some(found => /^▆+▶$/.test(found.text) && found.props.color === 'claude')).toBe(true)
        expect(timeline.some(found => /^▆+$/.test(found.text) && found.props.color === 'success')).toBe(true)
        expect(timeline.some(found => /^·+$/.test(found.text) && found.props.color === 'subtle')).toBe(true)
        await ui.unmount()
      }
      // The row in the main view: on the accent, the bar's cells keep theirs, the rest dim.
      const viewed = await agentsTabViewing($, surface, 'p-y')
      const marked = (await viewed.findAll({ type: 'Text' })).filter(found => found.props.backgroundColor === 'claude')
      expect(marked.some(found => found.text === '▆▆▆' && found.props.color === 'success')).toBe(true)
      expect(marked.some(found => found.text === '▆▆▆▆▆▆▆' && found.props.dimColor === true)).toBe(true)
      await viewed.unmount()
    }
  })

  test('the table ends in „Gesamt“, the three pots summed under a thin rule, its Block empty', async ($, on) => {
    await potsWorld($, on)
    for (const surface of SURFACES) {
      for (const columns of [90, 48, 30]) {
        const ui = await agentsTab($, surface, columns)
        await ui.press({ key: 'processed' })
        const texts = await ui.findAll({ type: 'Text' })
        const at = (pattern: RegExp) => texts.findIndex(found => pattern.test(found.text))
        // 140k + 95k + 23k, the three rows above it; nothing in wer's or Block's place.
        const total = texts[at(/^Gesamt /)]?.text ?? ''
        expect(total).toMatch(/^Gesamt +258k$/)
        const head = texts[at(/^wer /)]?.text ?? ''
        expect(cellsOf(total)).toBe(cellsOf(head))
        // Right-aligned under the last head, as the pots' figures.
        expect(total.length).toBe(texts[at(/^Sonsti/)]?.text.length)
        // The rule: dim, the table's width, between Sonstiges and Gesamt.
        const rule = texts[at(/^─+$/)]
        expect(rule?.props.dimColor).toBe(true)
        expect(cellsOf(rule?.text ?? '')).toBe(cellsOf(head))
        expect(at(/^Sonsti/)).toBeLessThan(at(/^─+$/))
        expect(at(/^─+$/)).toBe(at(/^Gesamt /) - 1)
        // Its cells in the text color, as the pots'.
        expect(texts.some(found => found.text === 'Gesamt' && found.props.color === 'text')).toBe(true)
        expect(texts.some(found => found.text === '258k' && found.props.color === 'text')).toBe(true)
        await ui.press({ key: 'processed' })
        await ui.unmount()
      }
    }
  })

  test('in English', { options: { language: 'en' } }, async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    modelBeneath(on, () => usageOf(1 * K, 1 * K, 90 * K, 0))
    await start($)
    await spawnListed($, world, [running('a1', 'review diff')])
    await step($, null)
    await step($, 'a1')
    await clock.advance(1000)
    const ui = await agentsTab($, 'terminal')
    const texts = await ui.findAll({ type: 'Text' })
    expect(has(texts, /^▸ Processed since load · Main chat 92k · Agents 92k · Other 0$/)).toBe(true)
    expect(has(texts, /^ {2}context 91k · processed 92k · new 2k$/)).toBe(true)
    expect(has(texts, /^ {2}opus · high · 1 step$/)).toBe(true)
    expect(has(texts, /^Processed = sum over all steps, cache re-reads included$/)).toBe(true)
    // The table, open.
    await ui.press({ key: 'processed' })
    const table = await ui.findAll({ type: 'Text' })
    expect((await ui.find({ type: 'Button', key: 'processed' }))?.text.trimEnd()).toBe('▾ Processed since load')
    expect(has(table, /^who +block +processed$/)).toBe(true)
    expect(has(table, /^Main chat +you \+ Claude +91k +92k$/)).toBe(true)
    expect(has(table, /^Agents +helpers +own +92k$/)).toBe(true)
    expect(has(table, /^Other +housekeeping +– +0$/)).toBe(true)
    // The pots summed under a thin rule: 92k + 92k + 0.
    expect(has(table, /^Total +184k$/)).toBe(true)
    expect(table.some(found => /^─+$/.test(found.text) && found.props.dimColor === true)).toBe(true)
    expect(has(table, /^Every step re-reads the whole block:$/)).toBe(true)
    expect(has(table, /^Main chat 1 step × ~92k ≈ 92k$/)).toBe(true)
    // Where the row has no room, the last head says it shorter.
    await ui.unmount()
    const narrow = await agentsTab($, 'terminal', 44)
    const tight = await narrow.findAll({ type: 'Text' })
    expect(has(tight, /^who +block +proc\.$/)).toBe(true)
    expect(has(tight, /^Main chat +you \+ Claude +91k +92k$/)).toBe(true)
    await narrow.press({ key: 'processed' })
    await narrow.unmount()
    const viewed = await $.ui.mount({ ...PANE, props: { ...PANE.props, view: { agentId: 'a1' } }, surface: 'terminal' })
    expect((await viewed.find({ type: 'Button', key: 'main-chat' }))?.text).toBe('◀ Main chat · you are viewing review diff')
    expect(await viewed.find({ type: 'Text', text: 'Enter in the prompt now goes to this agent' })).toBeDefined()
    await viewed.unmount()
  })

  /**
   * The Agents tab of a live session (version 0.19.2): a workflow's thirteen
   * agents, never listed, each 100k processed. Finished at 0:01:
   * `check:unpack`, `step0`, `diff`, `hat` and `verify:diff#0`–`#3`; still
   * running, each last in Bash: `verify:hat#0`–`#4`. The clock at 0:06;
   * every toast kept.
   */
  async function workflowSession($: Engine, on: On) {
    const clock = engine(on)
    const finished = [...['unpack', 'step0', 'diff', 'hat'].map(x => `check:${x}`), ...[0, 1, 2, 3].map(i => `verify:diff#${i}`)]
    const live = [0, 1, 2, 3, 4].map(i => `verify:hat#${i}`)
    const ids = new Map([...finished, ...live].map((description, i) => [description, `wf-${i}`]))
    const idOf = (description: string) => ids.get(description) ?? 'unknown'
    on('agent.spawn', (_, e) => ({ model: 'm', agentId: idOf(e.description) }))
    const toasts: string[] = []
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('tool.call', (_, e) => (e.tool === 'Bash' ? BASH_OK : READ_RESULT))
    modelBeneath(on, () => usageOf(0, 0, 100 * K, 0))
    await start($)
    for (const description of [...finished, ...live]) {
      await $.agent.spawn({ ...SPAWN, description, subagentType: 'workflow-subagent' })
      await $.turn.start({ text: '', turnId: idOf(description), agentId: idOf(description) })
      await step($, idOf(description))
    }
    await clock.advance(1000)
    for (const description of finished) await $.turn.complete({ turnId: idOf(description), agentId: idOf(description), durationMs: 1000, ...ANSWERED })
    for (const description of live) await $.tool.call({ tool: 'Bash', command: 'bun x.ts', agentId: idOf(description) })
    await clock.advance(5000)
    return { toasts, idOf, clock }
  }

  /** The tab's rows as drawn: each Button's key and text (the tabs aside), and each line counting what was left out. */
  const drawnRows = async (ui: { findAll: (q: { type: string }) => Promise<(Found & { key?: string })[]> }) => [
    ...(await ui.findAll({ type: 'Button' })).filter(found => !found.key?.startsWith('tab-')).map(found => [found.key ?? '', found.text.trimEnd()] as const),
    ...(await ui.findAll({ type: 'Text' })).filter(found => /^\+\d+ [◉✓]$/.test(found.text)).map(found => ['', found.text] as const),
  ]

  /**
   * How the tab drew its agents: the full card (`full`), shortened (`lines`:
   * running agents a line each; `folded`: the finished groups closed too;
   * `untimed`: no timeline either), or the compact view. Read at the
   * groups' defaults: a group the person opened tells another layout.
   */
  async function agentsLayout(ui: { findAll: (q: { type: string }) => Promise<(Found & { key?: string })[]> }) {
    const texts = await ui.findAll({ type: 'Text' })
    const buttons = await ui.findAll({ type: 'Button' })
    if (!buttons.some(found => found.key === 'processed')) return 'compact'
    if (has(texts, /Kontext/)) return 'full'
    const isFolded = buttons.some(found => /^group-(check|verify|prüfen)$/.test(found.key ?? '') && /^✓ ▸ /.test(found.text))
    if (!has(texts, /^Zeitleiste/)) return isFolded ? 'untimed' : 'untimed, open'
    return isFolded ? 'folded' : 'lines'
  }

  test('a live session\'s thirteen workflow agents in a pane of 40 rows: the card shortened, running agents a line each, not the compact view; 12 rows: the compact view', async ($, on) => {
    const { toasts } = await workflowSession($, on)
    for (const surface of SURFACES) {
      for (const columns of [48, 90]) {
        const ui = await agentsTab($, surface, columns, 40)
        expect(await agentsLayout(ui)).not.toBe('compact')
        expect(await agentsLayout(ui)).not.toBe('full')
        const rows = Object.fromEntries(await drawnRows(ui))
        // The running group open on the accent, ▾; each of its agents in one line: the rest of its name, time · processed, → its last call.
        expect(rows['group-live:verify']).toMatch(/^◉ ▾ verify ×5 +500k 0:06$/)
        for (const i of [0, 1, 2, 3, 4]) expect(rows[`wf-${8 + i}`]).toMatch(new RegExp(`^ {2}◉ hat#${i} 0:06 · 100k → Bash$`))
        // No ┄ between them, no model's or figures' lines under them.
        const texts = await ui.findAll({ type: 'Text' })
        expect(has(texts, /^┄+$|Kontext|· \d+ Schritte?$/)).toBe(false)
        // The finished groups and the pots' head stay, as in the full card.
        expect(rows['group-verify']).toMatch(/^✓ [▾▸] verify ×4 /)
        expect(rows['group-check']).toMatch(/^✓ [▾▸] check ×4 /)
        expect(rows.processed).toMatch(/^▸ Verarbeitet seit Laden/)
        // A press on a workflow's agent says where to see it, as before.
        await ui.press({ key: 'wf-8' })
        await ui.unmount()

        const short = await agentsTab($, surface, columns, 12)
        expect(await agentsLayout(short)).toBe('compact')
        expect(has(await short.findAll({ type: 'Text' }), /^ 5 ◉ · 8 ✓ · verarbeitet 1,3M$/)).toBe(true)
        expect(Object.fromEntries(await drawnRows(short))['group-live:verify']).toMatch(/^◉ ▸ verify ×5 0:06 · 500k$/)
        await short.unmount()
      }
    }
    expect(toasts).toEqual(Array.from({ length: 4 }, () => 'Workflow-Agents siehst du über /workflows'))
  })

  test('a group\'s head opens and closes it in the shortened card and in the compact view, running or finished; another group\'s head never gives way to its agents', async ($, on) => {
    const written: unknown[] = []
    on('state.set', { plugin: 'noxdeck' }, (_, e, next) => {
      if (e.key === 'agentFolds') written.push(e.value)
      return next(e)
    })
    await workflowSession($, on)
    const keysOf = async (ui: { findAll: (q: { type: string }) => Promise<(Found & { key?: string })[]> }) => (await drawnRows(ui)).map(([key]) => key)
    for (const surface of SURFACES) {
      // The compact view (12 rows): every group closed, the running one and the finished.
      const short = await agentsTab($, surface, 90, 12)
      expect(await agentsLayout(short)).toBe('compact')
      expect(await drawnRows(short)).toEqual([
        ['group-live:verify', '◉ ▸ verify ×5 0:06 · 500k'],
        ['group-verify', '✓ ▸ verify ×4 400k'],
        ['group-check', '✓ ▸ check ×4 400k'],
      ])
      // The running group opened: its agents in a line each, under its head; the finished heads stay.
      await short.press({ key: 'group-live:verify' })
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: [], opened: ['live:verify'] } })
      const opened = Object.fromEntries(await drawnRows(short))
      expect(opened['group-live:verify']).toBe('◉ ▾ verify ×5 0:06 · 500k')
      expect(opened['wf-8']).toBe('  ◉ hat#0 0:06 · 100k → Bash')
      expect(await keysOf(short)).toContain('group-verify')
      expect(await keysOf(short)).toContain('group-check')
      await short.press({ key: 'group-live:verify' })
      // A finished group opened, then the other: their agents in the rows there are, every head still there to press.
      await short.press({ key: 'group-verify' })
      expect(Object.fromEntries(await drawnRows(short))['group-verify']).toBe('✓ ▾ verify ×4 400k')
      expect(await keysOf(short)).toContain('wf-4')
      await short.press({ key: 'group-check' })
      expect(Object.fromEntries(await drawnRows(short))['group-check']).toBe('✓ ▾ check ×4 400k')
      // Each open group keeps its first agent longest: the one opened last shows one too.
      const both = await keysOf(short)
      expect(both).toEqual(expect.arrayContaining(['group-live:verify', 'group-verify', 'group-check', 'wf-4', 'wf-0']))
      // What did not fit is counted, the running group's five with none of them left out.
      const counted = (await drawnRows(short)).filter(([key]) => key === '').map(([, text]) => text)
      expect(counted).toHaveLength(1)
      expect(counted[0]).toMatch(/^\+\d ✓$/)
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: [], opened: ['verify', 'check'] } })
      await short.press({ key: 'group-verify' })
      await short.press({ key: 'group-check' })
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: [], opened: [] } })
      await short.unmount()

      // The full card shortened until its finished groups close (the rows found by shrinking the pane): a press opens one there.
      let rows = 40
      let folded = await agentsTab($, surface, 90, rows)
      while ((await agentsLayout(folded)) !== 'folded' && rows > 12) {
        await folded.unmount()
        rows -= 1
        folded = await agentsTab($, surface, 90, rows)
      }
      expect(await agentsLayout(folded)).toBe('folded')
      expect(await keysOf(folded)).not.toContain('wf-4')
      await folded.press({ key: 'group-verify' })
      // Open, the card shortened as it was (it scrolls where it runs past the pane); kept as the compact view keeps it.
      expect(Object.fromEntries(await drawnRows(folded))['group-verify']).toMatch(/^✓ ▾ verify ×4/)
      expect(await folded.find({ type: 'Button', key: 'processed' })).toBeDefined()
      expect(has(await folded.findAll({ type: 'Text' }), /^Zeitleiste/)).toBe(true)
      expect(await keysOf(folded)).toContain('wf-4')
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: [], opened: ['verify'] } })
      await folded.press({ key: 'group-verify' })
      expect(await keysOf(folded)).not.toContain('wf-4')
      // The running group folds there as in the full card.
      await folded.press({ key: 'group-live:verify' })
      expect(Object.fromEntries(await drawnRows(folded))['group-live:verify']).toMatch(/^◉ ▸ verify ×5 /)
      expect(await keysOf(folded)).not.toContain('wf-8')
      await folded.press({ key: 'group-live:verify' })
      expect(await keysOf(folded)).toContain('wf-8')
      expect(written.at(-1)).toEqual({ shape: 'noxdeck/3', value: { closed: [], opened: [] } })
      await folded.unmount()
    }
  })

  test('the card is shortened in this order as the pane shrinks: running agents a line each, then the finished groups closed, then no timeline; the compact view last', { timeoutMs: 15_000 }, async ($, on) => {
    await workflowSession($, on)
    for (const surface of SURFACES) {
      for (const columns of [48, 90]) {
        const seen: string[] = []
        for (let rows = 80; rows >= 6; rows -= 1) {
          const ui = await agentsTab($, surface, columns, rows)
          const layout = await agentsLayout(ui)
          if (seen.at(-1) !== layout) seen.push(layout)
          await ui.unmount()
        }
        // Each step once, in this order, each only where the one before does not fit.
        expect(seen).toEqual(['full', 'lines', 'folded', 'untimed', 'compact'])
      }
    }
  })

  test('▸ and ▾ fold, nothing else: a running agent\'s last call after →, in the full card, shortened and in the compact view', async ($, on) => {
    const { idOf } = await workflowSession($, on)
    const id = idOf('verify:hat#0')
    for (const surface of SURFACES) {
      for (const rows of [80, 40, 12]) {
        const ui = await agentsTab($, surface, 90, rows)
        if (rows === 12) {
          await ui.press({ key: 'group-live:verify' })
          await ui.press({ key: 'group-verify' })
        }
        const texts = await ui.findAll({ type: 'Text' })
        // A fold mark only on a group's head and the pots' head.
        for (const found of await ui.findAll({ type: 'Button' })) {
          if (/[▸▾]/.test(found.text)) expect(found.key).toMatch(/^(group-|processed$)/)
        }
        expect(has(texts, /[▸▾] *(Bash|Read)/)).toBe(false)
        expect(has(texts, /→ Bash/)).toBe(true)
        expect((await ui.find({ type: 'Button', key: id }))?.text).toMatch(rows === 80 ? /^ {2}◉ hat#0 / : /→ Bash/)
        if (rows === 12) {
          await ui.press({ key: 'group-live:verify' })
          await ui.press({ key: 'group-verify' })
        }
        await ui.unmount()
      }
    }
  })

  test('a press on a group\'s head turns that group alone, at every height from 40 rows to 12: it shows what it opened; the layout and the other heads stay', { timeoutMs: 60_000 }, async ($, on) => {
    await workflowSession($, on)
    // Each head's agents, by their ids.
    const membersOf: Readonly<Record<string, readonly string[]>> = {
      'group-live:verify': ['wf-8', 'wf-9', 'wf-10', 'wf-11', 'wf-12'],
      'group-verify': ['wf-4', 'wf-5', 'wf-6', 'wf-7'],
      'group-check': ['wf-0', 'wf-1', 'wf-2', 'wf-3'],
    }
    const heads = Object.keys(membersOf)
    const markOf = (text: string | undefined) => text?.slice(0, 3)
    // The layout apart from the folds the press turns: lines and folded tell the finished heads' marks, which are checked one by one.
    const shapeOf = async (ui: Parameters<typeof agentsLayout>[0]) => (await agentsLayout(ui)).replace(/^folded$/, 'lines').replace(/^untimed, open$/, 'untimed')
    for (const surface of SURFACES) {
      for (let rows = 40; rows >= 12; rows -= 1) {
        const ui = await agentsTab($, surface, 90, rows)
        const layout = await shapeOf(ui)
        for (const key of heads) {
          const before = Object.fromEntries(await drawnRows(ui))
          expect(before[key]).toBeDefined()
          const wasOpen = /^. ▾/.test(before[key] ?? '')
          await ui.press({ key })
          const after = Object.fromEntries(await drawnRows(ui))
          expect(await shapeOf(ui)).toBe(layout)
          expect(after[key]).toMatch(wasOpen ? /^. ▸ / : /^. ▾ /)
          for (const other of heads.filter(one => one !== key)) expect(markOf(after[other])).toBe(markOf(before[other]))
          const shown = (membersOf[key] ?? []).filter(id => after[id] !== undefined)
          if (wasOpen) expect(shown).toEqual([])
          else expect(shown.length).toBeGreaterThan(0)
          // Pressed again: as it was.
          await ui.press({ key })
          expect(Object.fromEntries(await drawnRows(ui))).toEqual(before)
        }
        await ui.unmount()
      }
    }
  })

  test('the compact view keeps every group\'s head however many agents without a group run; a press opens one, its agents shown', async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    modelBeneath(on, () => usageOf(0, 0, 100 * K, 0))
    await start($)
    await spawnListed($, world, [
      ...['diff#0', 'diff#1', 'diff#2', 'diff#3'].map((rest, i) => done(`v-${i}`, `verify: ${rest}`)),
      ...['unpack', 'step0', 'diff', 'hat'].map((rest, i) => done(`c-${i}`, `check: ${rest}`)),
      ...['alpha', 'bravo', 'charlie', 'delta', 'echo'].map(name => running(`r-${name}`, `${name} task`)),
    ])
    for (const id of world.agents.map(one => one.id)) await step($, id)
    await clock.advance(1000)
    for (const surface of SURFACES) {
      const short = await agentsTab($, surface, 90, 12)
      expect(await agentsLayout(short)).toBe('compact')
      let keys = (await drawnRows(short)).map(([key]) => key)
      expect(keys).toEqual(expect.arrayContaining(['group-verify', 'group-check']))
      // Each opened in turn: its first agent shows, the running agents that do not fit counted under the ones that do.
      for (const [key, first] of [['group-verify', 'v-0'], ['group-check', 'c-0']] as const) {
        await short.press({ key })
        keys = (await drawnRows(short)).map(([one]) => one)
        expect(keys).toEqual(expect.arrayContaining(['group-verify', 'group-check', first]))
        expect((await drawnRows(short)).some(([one, text]) => one === '' && /^\+\d ◉$/.test(text))).toBe(true)
      }
      expect(keys).toEqual(expect.arrayContaining(['v-0', 'c-0']))
      await short.press({ key: 'group-verify' })
      await short.press({ key: 'group-check' })
      await short.unmount()
    }
  })

  test('in the narrowest panes a running agent\'s line keeps its figures whole: the indent and the name give way, as a group\'s head keeps its count and figures', async ($, on) => {
    const { clock } = await workflowSession($, on)
    for (const surface of SURFACES) {
      for (const columns of [24, 26, 28, 30, 36]) {
        const width = columns - 8
        const ui = await agentsTab($, surface, columns, 40)
        expect(await agentsLayout(ui)).not.toBe('compact')
        const rows = Object.fromEntries(await drawnRows(ui))
        for (const id of ['wf-8', 'wf-12']) {
          expect(rows[id]).toMatch(/0:06 · 100k( →.*)?$/)
          expect(cellsOf(rows[id] ?? '')).toBeLessThanOrEqual(width)
        }
        await ui.unmount()
        const short = await agentsTab($, surface, columns, 12)
        expect(await agentsLayout(short)).toBe('compact')
        const lines = Object.fromEntries(await drawnRows(short))
        // Its time gives way where four cells of its words leave no room for it; at 36 columns it stays.
        expect(lines['group-live:verify']).toMatch(/^◉ ▸ (\S+ ×5 500k|\S{4,} ×5 0:06 · 500k)$/)
        if (columns >= 36) expect(lines['group-live:verify']).toMatch(/×5 0:06 · 500k$/)
        expect(lines['group-verify']).toMatch(/×4 400k$/)
        await short.unmount()
      }
    }
    // An hour on: 14 cells of figures (1:00:06 · 100k). At 24 columns the indent and the name give way; at 20 cells of card the time too.
    for (let i = 0; i < 60; i += 1) await clock.advance(60_000)
    for (const surface of SURFACES) {
      const ui = await agentsTab($, surface, 24, 40)
      const rows = Object.fromEntries(await drawnRows(ui))
      expect(rows['wf-8']).toBe('◉ 1:00:06 · 100k')
      await ui.unmount()
      // The full card's running head: its words cut, at 28 columns left out, its glyph, fold mark, count and figures whole.
      for (const [columns, head] of [[28, /^◉ ▾ ×5 +500k 1:00:06$/], [32, /^◉ ▾ \S+ ×5 +500k 1:00:06$/]] as const) {
        const wider = await agentsTab($, surface, columns, 40)
        expect(Object.fromEntries(await drawnRows(wider))['group-live:verify']).toMatch(head)
        await wider.unmount()
      }
    }
  })

  test('in the shortest panes the compact view keeps every head to press, the counts giving way first', async ($, on) => {
    await workflowSession($, on)
    const heads = ['group-live:verify', 'group-verify', 'group-check']
    for (const surface of SURFACES) {
      for (const rows of surface === 'terminal' ? [8, 9] : [9, 10]) {
        const ui = await agentsTab($, surface, 90, rows)
        expect(await agentsLayout(ui)).toBe('compact')
        for (const key of heads) {
          await ui.press({ key })
          const keys = (await drawnRows(ui)).map(([one]) => one)
          expect(keys).toEqual(expect.arrayContaining(heads))
          await ui.press({ key })
        }
        await ui.unmount()
      }
    }
  })

  test('the compact view: a finished agent\'s line cuts its name, never what it processed', async ($, on) => {
    const world = { agents: [] as AgentInfo[] }
    const clock = engine(on, world)
    spawnsAs(on, world)
    modelBeneath(on, () => usageOf(0, 0, 100 * K, 0))
    await start($)
    await spawnListed($, world, [done('s1', 'review the authentication middleware and the session store')])
    await step($, 's1')
    await clock.advance(1000)
    for (const surface of SURFACES) {
      const short = await agentsTab($, surface, 48, 8)
      expect(await agentsLayout(short)).toBe('compact')
      const line = Object.fromEntries(await drawnRows(short)).s1 ?? ''
      expect(line).toMatch(/^✓ review the .*… 100k$/)
      expect(cellsOf(line)).toBeLessThanOrEqual(46)
      await short.unmount()
    }
  })

  test('the compact view: the agent in the main view keeps its line longest in an open group, and where it is left out its open head is marked', async ($, on) => {
    await workflowSession($, on)
    for (const surface of SURFACES) {
      // diff#3, the last of verify's: with a row too few its line stays, an agent before it gives way.
      const viewed = await agentsTabViewing($, surface, 'wf-7', 90, surface === 'terminal' ? 13 : 14)
      await viewed.press({ key: 'group-verify' })
      const rows = Object.fromEntries(await drawnRows(viewed))
      expect(rows['wf-7']).toBe('    diff#3 100k')
      expect(Object.keys(rows).filter(key => /^wf-[4-6]$/.test(key)).length).toBeLessThan(3)
      expect(await markedTexts(viewed)).toContain('diff#3 100k')
      // The running group opened too: every other agent under a head gives way before diff#3.
      await viewed.press({ key: 'group-live:verify' })
      expect(Object.fromEntries(await drawnRows(viewed))['wf-7']).toBe('    diff#3 100k')
      await viewed.unmount()
      // A row fewer: no row left for it, and its head is marked in its place.
      const fewer = await agentsTabViewing($, surface, 'wf-7', 90, surface === 'terminal' ? 12 : 13)
      const rows2 = Object.fromEntries(await drawnRows(fewer))
      expect(rows2['wf-7']).toBeUndefined()
      expect(rows2['group-verify']).toBe('✓ ▾ verify ×4 400k')
      expect(await markedTexts(fewer)).toContain('verify ×4 400k')
      await fewer.press({ key: 'group-live:verify' })
      await fewer.press({ key: 'group-verify' })
      await fewer.unmount()
    }
  })
})

// ---------------------------------------------------------------- the fine Nox (version 0.17; its sprites since 0.18.1, its costumes since 0.19)

const OWLS = ['big', 'mini'] as const
const SHEETS = NOX_SPRITES.sizes

/**
 * The SHA-256 of the sprites' `sizes` as recorded: both sizes' frames and
 * every costume's states with their frames and ms, written as
 * JSON.stringify writes them. A change to any frame or time fails here.
 */
const SIZES_SHA256 = '6308459b275498e8ca24c14411c9339da466ee4304e0b3a579b84e819378f3b7'

const sha256Of = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('')

const sequenceOf = (owl: Owl, costume: NoxCostume, state: NoxState) => SHEETS[owl].costumes[costume].states[state]
/** The frames a state's sprites name, each once, in order. */
const framesOfState = (owl: Owl, costume: NoxCostume, state: NoxState) => [...new Set(sequenceOf(owl, costume, state).map(([frame]) => frame))]
/** The costume's `schweiss` frames that hold its drop. */
const dropFramesOf = (owl: Owl, costume: NoxCostume) => [...lookFor(owl, costume).drops.keys()]

/** Whose frame a frame is: every frame is one costume's (the sprites test below says so). */
const FRAME_COSTUME: Readonly<Record<Owl, ReadonlyMap<number, NoxCostume>>> = {
  big: new Map(COSTUMES.flatMap(costume => NOX_STATES.flatMap(state => framesOfState('big', costume, state).map(frame => [frame, costume] as const)))),
  mini: new Map(COSTUMES.flatMap(costume => NOX_STATES.flatMap(state => framesOfState('mini', costume, state).map(frame => [frame, costume] as const)))),
}

/** Every pose a fine owl can show in a costume: each frame of each state, bare and with each drop that has room on it. */
function* allPoses(owl: Owl, costume: NoxCostume): Generator<FinePose> {
  for (const state of NOX_STATES) {
    for (const frame of framesOfState(owl, costume, state)) {
      yield { costume, state, frame, drop: null }
      for (const drop of dropFramesOf(owl, costume)) if (dropFits(owl, costume, frame, drop)) yield { costume, state, frame, drop }
    }
  }
}

/**
 * Each picture the fine owls can show (standard palette), in every costume,
 * by its RGBA: `fine:` or `fineMini:`, the first state that shows the frame,
 * and the pose's key (`fine:lesen:20`, `fine:lesen:20+drop80`). A frame is
 * one costume's, so the key tells the costume too (`costumeOfPicture`).
 */
let picturesByRgba: Map<string, string> | null = null
function pictureNames(): Map<string, string> {
  if (picturesByRgba !== null) return picturesByRgba
  const names = new Map<string, string>()
  const name = (rgba: string, label: string) => names.has(rgba) || names.set(rgba, label)
  for (const costume of COSTUMES) {
    for (const pose of allPoses('big', costume)) name(noxSource(pose, PALETTES.standard).rgba, `fine:${pose.state}:${poseKey(pose)}`)
    for (const pose of allPoses('mini', costume)) name(miniSource(pose, PALETTES.standard).rgba, `fineMini:${pose.state}:${poseKey(pose)}`)
  }
  picturesByRgba = names
  return names
}

type FoundImage = { props: Record<string, unknown> }
const sourceOf = (image: FoundImage | undefined) => image?.props.source as { rgba: string; width: number; height: number } | undefined
/** The bytes of a base64 text. */
const bytesOf = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0))

/**
 * The owl STATUS shows: `fine:<state>:<key>` or `fineMini:<state>:<key>` for
 * a picture, else the block owl's name (`idle`, `mini:idle`, …), `hidden`
 * without one.
 */
async function pictureIn(ui: { find: (q: { type: string; key: string }) => Promise<FoundImage | undefined>; findAll: (q: { type: string }) => Promise<Found[]> }) {
  for (const key of ['nox', 'mini']) {
    const source = sourceOf(await ui.find({ type: 'Image', key }))
    if (source !== undefined) return pictureNames().get(source.rgba) ?? `${key}:unknown`
  }
  return poseIn(await ui.findAll({ type: 'Text' }))
}

async function shownPicture($: Engine, size: Size = TALL, surface: (typeof SURFACES)[number] = 'terminal'): Promise<string> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: size.columns, scroll: { offset: 0, bodyRows: size.rows } }, surface })
  const name = await pictureIn(ui)
  await ui.unmount()
  return name
}

/** The pictures the pane shows, a fine step at a time, over `ms`. */
async function picturesOver($: Engine, clock: { advance: (ms: number) => Promise<void> }, ms: number, size: Size = TALL): Promise<Set<string>> {
  const seen = new Set<string>()
  for (let t = 0; t < ms; t += FINE_FRAME_MS) {
    await clock.advance(FINE_FRAME_MS)
    seen.add(await shownPicture($, size))
  }
  return seen
}

/** The state of a picture's name: `fine:lesen:20+drop80` → `lesen`. */
const pictureState = (name: string) => name.split(':')[1] ?? name
const pictureStates = (seen: Iterable<string>) => new Set([...seen].map(pictureState))
/** Its frame and drop: `fine:lesen:20+drop80` → `20+drop80`. */
const pictureKey = (name: string) => name.split(':')[2] ?? name
/** The frames pictures show, by their names. */
const shownFrames = (seen: Iterable<string>) => [...seen].map(name => Number.parseInt(pictureKey(name), 10))
/** The costume a picture's name shows: its frame's. */
const costumeOfPicture = (name: string) => FRAME_COSTUME[name.startsWith('fineMini:') ? 'mini' : 'big'].get(Number.parseInt(pictureKey(name), 10))
/** The name of an owl's still picture in a costume: ruhe's first frame. */
const stillName = (owl: Owl, costume: NoxCostume) => `${owl === 'big' ? 'fine' : 'fineMini'}:ruhe:${fineStillOf(owl, costume).frame}`

/** Starts a session whose terminal draws pictures and lets the probe answer: a drawing, then a tick. */
async function startWithPictures($: Engine, clock: { advance: (ms: number) => Promise<void> }): Promise<void> {
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.unmount()
  // The first tick blits the probe: a quarter of a second, a second with animations off.
  await clock.advance(1000)
}

const PICTURES: World = { images: 'ok' }
/** The fine style, set: the default again since 0.18.1. */
const FEIN = { noxStyle: 'fein' } as const
/** The owl's blits (the probe's left out). */
const owlBlits = (world: World) => (world.blits ?? []).filter(blit => blit.key !== 'probe')

/** The unit tests' moment: a step's start, about 10 000 s in. */
const FINE_AT0 = FINE_FRAME_MS * 60_000

/** At rest since the unit tests' moment: far from the yawn. */
const FINE_REST: Scene = {
  isWorking: false,
  isBusy: false,
  tool: null,
  isAsking: false,
  startledAt: null,
  wavedAt: null,
  answeredAt: null,
  restingSince: FINE_AT0,
  isHot: false,
  isTired: false,
  isLooping: false,
}

const poseOfOwl = (owl: Owl) => (owl === 'big' ? finePoseOf : fineMiniPoseOf)

/** The poses an owl in a costume shows over `ms` from `from`, a step at a time. */
function posesOfOwl(owl: Owl, costume: NoxCostume, scene: Scene, from: number, ms: number, animations: Animations = 'voll'): FinePose[] {
  const poses: FinePose[] = []
  for (let at = from; at < from + ms; at += FINE_FRAME_MS) poses.push(poseOfOwl(owl)(costume, scene, at, animations))
  return poses
}

/** The poses a look shows over `ms` from `from`, a step at a time. */
function posesOfLook(look: Look, scene: Scene, from: number, ms: number, animations: Animations = 'voll'): FinePose[] {
  const poses: FinePose[] = []
  for (let at = from; at < from + ms; at += FINE_FRAME_MS) poses.push(fineLookPose(look, scene, at, animations))
  return poses
}

/** A list with each run of equal neighbours as one. */
const runsOf = <T,>(items: readonly T[]) => items.filter((item, i) => i === 0 || item !== items[i - 1])

describe('fine Nox: the sprites (nox-sprites/2, „Nox fein + Knuddel“)', () => {
  test('unpacked, the frames and times are the ones recorded, character for character: their SHA-256 matches; format nox-sprites/2', async () => {
    expect(NOX_SPRITES.format).toBe('nox-sprites/2')
    expect([SHEETS.big.frames.length, SHEETS.mini.frames.length]).toEqual([438, 265])
    expect(await sha256Of(JSON.stringify(NOX_SPRITES.sizes))).toBe(SIZES_SHA256)
    // The sum tells a pixel apart, and a time: one of either otherwise, and it is another.
    const pixel = JSON.parse(JSON.stringify(NOX_SPRITES.sizes))
    const row: string = pixel.mini.frames[264][15]
    pixel.mini.frames[264][15] = `${row.slice(0, 15)}${row.endsWith('D') ? '.' : 'D'}`
    expect(await sha256Of(JSON.stringify(pixel))).not.toBe(SIZES_SHA256)
    const time = JSON.parse(JSON.stringify(NOX_SPRITES.sizes))
    time.big.costumes.hacker.states.muede[0][1] += 1
    expect(await sha256Of(JSON.stringify(time))).not.toBe(SIZES_SHA256)
  })

  test('the grids: Nox 32 × 32 and the mini owl 16 × 16, every frame that size', () => {
    expect([SHEETS.big.width, SHEETS.big.height, SHEETS.mini.width, SHEETS.mini.height]).toEqual([32, 32, 16, 16])
    expect([NOX_PIXELS, MINI_PIXELS]).toEqual([32, 16])
    for (const owl of OWLS) {
      const { width, height, frames } = SHEETS[owl]
      for (const frame of frames) {
        expect(frame.length).toBe(height)
        for (const row of frame) expect([...row].length).toBe(width)
      }
    }
  })

  test('only the legend\'s characters; every palette colors each of them but transparent, in #rrggbb', () => {
    const legend = Object.keys(NOX_SPRITES.legend)
    expect(NOX_SPRITES.legend['.']).toBe('transparent')
    expect(legend.length).toBe(25)
    const used = new Set<string>()
    for (const owl of OWLS) for (const frame of SHEETS[owl].frames) for (const row of frame) for (const pixel of row) used.add(pixel)
    for (const pixel of used) expect(legend).toContain(pixel)
    expect(Object.keys(NOX_SPRITES.palettes).sort()).toEqual(['nacht', 'retro', 'standard'])
    for (const colors of Object.values(NOX_SPRITES.palettes)) {
      expect(Object.keys(colors).sort()).toEqual(legend.filter(pixel => pixel !== '.').sort())
      for (const hex of Object.values(colors)) expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    }
    // As colors: every character a palette names, and '.' none.
    for (const palette of Object.values(PALETTES)) {
      expect(Object.keys(palette.colors).sort()).toEqual(legend.filter(pixel => pixel !== '.').sort())
      expect(palette.colors['.']).toBeUndefined()
    }
  })

  test('five costumes, each with the fourteen states, Nox\'s and the mini owl\'s; every frame there, every time at least 170 ms', () => {
    expect(COSTUMES).toEqual(['ohne', 'zauberer', 'astronaut', 'detektiv', 'hacker'])
    expect(Object.keys(NOX_SPRITES.costumes)).toEqual([...COSTUMES])
    expect(NOX_STATES).toEqual([
      'ruhe',
      'gaehnen',
      'schlaf',
      'lesen',
      'schreiben',
      'shell',
      'denken',
      'winken',
      'wartet-auf-dich',
      'fertig',
      'fehler',
      'loop-warnung',
      'schweiss',
      'muede',
    ])
    let sequences = 0
    for (const owl of OWLS) {
      const { frames, costumes } = SHEETS[owl]
      expect(Object.keys(costumes)).toEqual([...COSTUMES])
      for (const costume of COSTUMES) {
        const { states } = costumes[costume]
        expect(Object.keys(states)).toEqual([...NOX_STATES])
        for (const state of NOX_STATES) {
          sequences += 1
          expect(states[state].length).toBeGreaterThan(0)
          for (const [frame, ms] of states[state]) {
            expect(frames[frame]).toBeDefined()
            expect(Number.isInteger(ms) && ms >= 170).toBe(true)
          }
        }
      }
    }
    expect(sequences).toBe(2 * 5 * 14)
  })

  test('each frame is one costume\'s: none shows in another', () => {
    for (const owl of OWLS) {
      const owner = new Map<number, NoxCostume>()
      for (const costume of COSTUMES) {
        for (const state of NOX_STATES) {
          for (const frame of framesOfState(owl, costume, state)) {
            expect(owner.get(frame) ?? costume).toBe(costume)
            owner.set(frame, costume)
          }
        }
      }
      expect(owner.size).toBe(SHEETS[owl].frames.length)
    }
  })

  test('square pixels: Nox fills 16 × 8 cells and the mini owl 6 × 3, two columns to a row as a cell is twice as tall', () => {
    expect([NOX_COLUMNS, NOX_ROWS]).toEqual([16, 8])
    expect([MINI_FINE_COLUMNS, MINI_FINE_ROWS]).toEqual([6, 3])
    expect(NOX_COLUMNS / NOX_ROWS).toBe(2)
    expect(MINI_FINE_COLUMNS / MINI_FINE_ROWS).toBe(2)
  })

  test('RGBA: each pixel a SCALE × SCALE block in its palette\'s color as it is, transparent where the sprite is empty; every costume', () => {
    for (const owl of OWLS) {
      const size = SHEETS[owl].width
      for (const costume of COSTUMES) {
        const still = fineStillOf(owl, costume)
        for (const palette of Object.values(PALETTES)) {
          const grid = fineGridOf(owl, still)
          expect(grid).toEqual(SHEETS[owl].frames[still.frame])
          const { bytes, width, height } = rgbaOf(grid, palette)
          expect([width, height]).toEqual([size * SCALE, size * SCALE])
          expect(bytes.length).toBe(width * height * 4)
          const hexes = NOX_SPRITES.palettes[palette.name]
          for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
              const pixel = grid[y]?.[x] ?? '.'
              const hex = pixel === '.' ? null : (hexes[pixel] ?? 'none')
              // Every byte of the pixel's block: the same color, unchanged, no blending with a neighbour.
              for (let dy = 0; dy < SCALE; dy += 1) {
                for (let dx = 0; dx < SCALE; dx += 1) {
                  const at = ((y * SCALE + dy) * width + x * SCALE + dx) * 4
                  const rgba = [...bytes.slice(at, at + 4)]
                  if (hex === null) expect(rgba).toEqual([0, 0, 0, 0])
                  else expect(`#${rgba.slice(0, 3).map(byte => byte.toString(16).padStart(2, '0')).join('')}/${rgba[3]}`).toBe(`${hex.toLowerCase()}/255`)
                }
              }
            }
          }
        }
      }
    }
    const plain = fineStillOf('big', 'ohne')
    const nox = noxSource(plain, PALETTES.standard)
    expect([nox.width, nox.height]).toEqual([64, 64])
    expect(bytesOf(nox.rgba).length).toBe(64 * 64 * 4)
    const mini = miniSource(fineStillOf('mini', 'ohne'), PALETTES.standard)
    expect([mini.width, mini.height]).toEqual([32, 32])
    // The probe: one transparent pixel.
    expect(PROBE_SOURCE).toMatchObject({ width: 1, height: 1 })
    expect([...bytesOf(PROBE_SOURCE.rgba)]).toEqual([0, 0, 0, 0])
    // The palettes differ, and so do the costumes.
    expect(noxSource(plain, PALETTES.nacht).rgba).not.toBe(noxSource(plain, PALETTES.standard).rgba)
    expect(noxSource(plain, PALETTES.retro).rgba).not.toBe(noxSource(plain, PALETTES.standard).rgba)
    for (const owl of OWLS) {
      const source = owl === 'big' ? noxSource : miniSource
      expect(new Set(COSTUMES.map(costume => source(fineStillOf(owl, costume), PALETTES.standard).rgba)).size).toBe(COSTUMES.length)
    }
  })

  test('pictures are made once and kept: the same pose is the same picture, a tick only looks it up', () => {
    const scenes: Scene[] = [
      FINE_REST,
      { ...FINE_REST, isWorking: true, tool: 'read', isHot: true },
      { ...FINE_REST, isWorking: true, tool: 'edit' },
      { ...FINE_REST, answeredAt: FINE_AT0 },
      { ...FINE_REST, startledAt: FINE_AT0, isLooping: true },
    ]
    const run = () => {
      const keys = new Set<string>()
      for (const costume of COSTUMES) {
        for (const scene of scenes) {
          for (let at = FINE_AT0; at < FINE_AT0 + 30_000; at += FINE_FRAME_MS) {
            const pose = finePoseOf(costume, scene, at, 'voll')
            expect(noxSource(pose, PALETTES.standard)).toBe(noxSource(pose, PALETTES.standard))
            keys.add(`${costume}:${poseKey(pose)}`)
            const mini = fineMiniPoseOf(costume, scene, at, 'voll')
            expect(miniSource(mini, PALETTES.standard)).toBe(miniSource(mini, PALETTES.standard))
          }
        }
      }
      return keys
    }
    const before = cacheStats().made
    const keys = run()
    const made = cacheStats().made
    // At most one picture made per pose seen (fewer where an earlier test made it), Nox's and the mini owl's.
    expect(made - before).toBeLessThanOrEqual(keys.size * 2)
    // The same scenes again: nothing new is made.
    run()
    expect(cacheStats().made).toBe(made)
  })

  test('the cache\'s size: 21 KB a picture of Nox, 5 KB of the mini owl, and what a costume could ever show', () => {
    expect(noxSource(fineStillOf('big', 'ohne'), PALETTES.standard).rgba.length).toBe(21_848)
    expect(miniSource(fineStillOf('mini', 'ohne'), PALETTES.standard).rgba.length).toBe(5_464)
    // Were every one of a costume's pictures shown, the cache would hold this much; a session holds the ones it showed, of one costume.
    for (const costume of COSTUMES) {
      const nox = new Set([...allPoses('big', costume)].map(poseKey))
      const mini = new Set([...allPoses('mini', costume)].map(poseKey))
      expect(nox.size).toBeLessThan(300)
      expect(mini.size).toBeLessThan(200)
      expect(nox.size * 21_848 + mini.size * 5_464).toBeLessThan(8 * 1024 * 1024)
    }
  })
})

describe('fine Nox: the costumes (noxCostume)', () => {
  test('the option: ohne, zauberer, astronaut, detektiv, hacker or zufall; anything else is ohne', () => {
    for (const costume of COSTUMES) expect(costumeOptionOf(costume)).toBe(costume)
    expect(costumeOptionOf('zufall')).toBe('zufall')
    for (const value of [undefined, null, '', 'pirat', 'Zauberer', ' hacker', 'hacker ', 'zufällig', 'ZUFALL', 0, 42, true, {}, ['hacker']]) {
      expect(costumeOptionOf(value)).toBe('ohne')
    }
  })

  test('zufall draws from the clock alone: one of the four, never ohne, each about as often, the same moment the same', () => {
    expect(DRAWN_COSTUMES).toEqual(['zauberer', 'astronaut', 'detektiv', 'hacker'])
    // 28 Oct 2026, and on from there a millisecond, a tenth, a second or a minute apart: a clock that only ticks coarsely draws all four too.
    const NOW = 1_793_199_918_000
    for (const apart of [1, 100, 1000, 60_000]) {
      const counts = new Map<NoxCostume, number>()
      for (let i = 0; i < 4000; i += 1) {
        const drawn = costumeDrawnAt(NOW + i * apart)
        counts.set(drawn, (counts.get(drawn) ?? 0) + 1)
      }
      expect([...counts.keys()].sort()).toEqual([...DRAWN_COSTUMES].sort())
      for (const count of counts.values()) {
        expect(count).toBeGreaterThan(850)
        expect(count).toBeLessThan(1150)
      }
    }
    expect(costumeDrawnAt(NOW)).toBe(costumeDrawnAt(NOW))
    for (const at of [0, -1, 1.5, 1_000_000, Number.NaN, 2 ** 53]) expect(DRAWN_COSTUMES).toContain(costumeDrawnAt(at))
    for (const value of DRAWN_COSTUMES) expect(isDrawnCostume(value)).toBe(true)
    for (const value of ['ohne', 'zufall', 'pirat', null, undefined, 3]) expect(isDrawnCostume(value)).toBe(false)
  })

  test('each costume wears its own frames in every state and every animation, Nox and the mini owl, its drop its own', () => {
    const working = { ...FINE_REST, isWorking: true }
    const scenes: Scene[] = [
      FINE_REST,
      { ...working, tool: 'read', isHot: true },
      { ...working, tool: 'edit', isHot: true },
      { ...working, tool: 'shell' },
      working,
      { ...working, wavedAt: FINE_AT0 },
      { ...working, isAsking: true },
      { ...FINE_REST, answeredAt: FINE_AT0 },
      { ...working, startledAt: FINE_AT0 },
      { ...working, startledAt: FINE_AT0, isLooping: true },
      { ...FINE_REST, isHot: true },
      { ...FINE_REST, isTired: true },
      { ...FINE_REST, restingSince: FINE_AT0 - YAWN_AFTER_MS },
      { ...FINE_REST, restingSince: FINE_AT0 - YAWN_AFTER_MS - 10_000 },
    ]
    for (const owl of OWLS) {
      for (const costume of COSTUMES) {
        for (const scene of scenes) {
          for (const animations of ['voll', 'ruhig', 'aus'] as const) {
            for (const pose of posesOfOwl(owl, costume, scene, FINE_AT0, 4000, animations)) {
              expect(pose.costume).toBe(costume)
              expect(FRAME_COSTUME[owl].get(pose.frame)).toBe(costume)
              if (pose.drop !== null) expect(dropFramesOf(owl, costume)).toContain(pose.drop)
            }
          }
        }
      }
    }
  })
})

describe('fine Nox: the times of the sprites', () => {
  test('each state\'s frames in order on a grid of steps, in every costume: each at least one step, none more than two steps from its time, the run its length', () => {
    for (const owl of OWLS) {
      for (const costume of COSTUMES) {
        for (const state of NOX_STATES) {
          const sequence = sequenceOf(owl, costume, state)
          const steps = animationOf(owl, costume, state).lively
          // In order: the frames shown, runs as one, are the sprites' frames, runs as one.
          expect(runsOf(steps)).toEqual(runsOf(sequence.map(([frame]) => frame)))
          // The run keeps its length to half a step.
          const total = sequence.reduce((sum, [, ms]) => sum + ms, 0)
          expect(Math.abs(steps.length * FINE_FRAME_MS - total)).toBeLessThanOrEqual(FINE_FRAME_MS / 2)
          // Each step shows a frame the sprites show within two steps of it.
          const frameAt = (ms: number) => {
            let end = 0
            for (const [frame, held] of sequence) {
              end += held
              if (ms < end) return frame
            }
            return sequence.at(-1)?.[0]
          }
          steps.forEach((frame, i) => {
            const near = new Set<number | undefined>()
            for (let ms = Math.max(0, (i - 2) * FINE_FRAME_MS); ms < Math.min(total, (i + 3) * FINE_FRAME_MS); ms += 10) near.add(frameAt(ms))
            expect(near.has(frame)).toBe(true)
          })
        }
      }
    }
    // A frame long enough holds its time to a step: ruhe's first frame, 1400 ms, holds 8 steps (1336 ms).
    expect(animationOf('big', 'ohne', 'ruhe').lively.slice(0, 9)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1])
    // The blink, one closed frame of 170 ms, holds one step; no frame of the sprites is shorter than a step.
    expect(animationOf('big', 'ohne', 'ruhe').lively.slice(30, 33)).toEqual([0, 4, 0])
    for (const owl of OWLS) {
      for (const costume of COSTUMES) for (const state of NOX_STATES) for (const [, ms] of sequenceOf(owl, costume, state)) expect(ms).toBeGreaterThanOrEqual(FINE_FRAME_MS)
    }
  })

  test('each costume runs to its own times: the sprites time the costumes alike, and one timed otherwise runs to its own', () => {
    // As the sprites stand, every costume holds its frames as long as plain Nox does, state by state.
    for (const owl of OWLS) {
      for (const state of NOX_STATES) {
        expect(new Set(COSTUMES.map(costume => sequenceOf(owl, costume, state).map(([, ms]) => ms).join())).size).toBe(1)
      }
    }
    // Its own times, never plain Nox's: the wizard, every frame held twice as long, runs twice as long.
    const slowed = (states: Readonly<Record<NoxState, readonly (readonly [number, number])[]>>) => {
      const slow = { ...states }
      for (const state of NOX_STATES) slow[state] = states[state].map(([frame, ms]) => [frame, ms * 2] as const)
      return slow
    }
    for (const owl of OWLS) {
      const slow = slowed(SHEETS[owl].costumes.zauberer.states)
      const wizard = lookOf('zauberer', SHEETS[owl].frames, slow)
      for (const state of NOX_STATES) {
        expect(wizard.animations[state].lively).toEqual(stepsOf(slow[state]))
        const total = slow[state].reduce((sum, [, ms]) => sum + ms, 0)
        expect(Math.abs(wizard.animations[state].lively.length * FINE_FRAME_MS - total)).toBeLessThanOrEqual(FINE_FRAME_MS / 2)
      }
      // At rest it loops its own run: its first frame twice as many steps.
      const rest = wizard.animations.ruhe.lively
      const first = (FINE_AT0 / FINE_FRAME_MS) % rest.length
      posesOfLook(wizard, FINE_REST, FINE_AT0, rest.length * FINE_FRAME_MS).forEach((pose, i) => expect(pose.frame).toBe(rest[(first + i) % rest.length]))
      expect(rest.length).not.toBe(animationOf(owl, 'zauberer', 'ruhe').lively.length)
    }
  })

  test('at most six pictures a second, in every costume: a frame changes only at a step\'s start and holds at least one step', () => {
    const scenes: Scene[] = [
      FINE_REST,
      { ...FINE_REST, isWorking: true, tool: 'edit', isHot: true },
      { ...FINE_REST, startledAt: FINE_AT0 + 50, isLooping: true },
      { ...FINE_REST, answeredAt: FINE_AT0 + 100 },
      { ...FINE_REST, wavedAt: FINE_AT0 + 30 },
    ]
    for (const owl of OWLS) {
      for (const costume of COSTUMES) {
        for (const scene of scenes) {
          let last = ''
          let since = FINE_AT0
          for (let at = FINE_AT0; at < FINE_AT0 + 9000; at += 1) {
            const key = poseKey(poseOfOwl(owl)(costume, scene, at, 'voll'))
            if (key === last) continue
            if (at > FINE_AT0) {
              expect(at % FINE_FRAME_MS).toBe(0)
              expect(at - since).toBeGreaterThanOrEqual(FINE_FRAME_MS)
            }
            last = key
            since = at
          }
        }
      }
    }
  })

  test('a state that lasts loops on the clock; one that answers an event runs once from its moment; every costume', () => {
    for (const owl of OWLS) {
      for (const costume of COSTUMES) {
        const animation = (state: NoxState) => animationOf(owl, costume, state).lively
        // ruhe: its run over and over.
        const rest = animation('ruhe')
        const shown = posesOfOwl(owl, costume, FINE_REST, FINE_AT0, rest.length * FINE_FRAME_MS * 2).map(pose => pose.frame)
        const first = (FINE_AT0 / FINE_FRAME_MS) % rest.length
        shown.forEach((frame, i) => expect(frame).toBe(rest[(first + i) % rest.length]))
        // fertig from the answer: its run once, then ruhe.
        const done = animation('fertig')
        const answered = posesOfOwl(owl, costume, { ...FINE_REST, answeredAt: FINE_AT0 }, FINE_AT0, (done.length + 4) * FINE_FRAME_MS)
        expect(answered.slice(0, done.length).map(pose => pose.frame)).toEqual(done)
        expect(new Set(answered.slice(0, done.length).map(pose => pose.state))).toEqual(new Set(['fertig']))
        expect(new Set(answered.slice(done.length).map(pose => pose.state))).toEqual(new Set(['ruhe']))
        // fehler and loop-warnung from the failure, once.
        for (const [isLooping, state] of [
          [false, 'fehler'],
          [true, 'loop-warnung'],
        ] as const) {
          const run = animation(state)
          const failed = posesOfOwl(owl, costume, { ...FINE_REST, startledAt: FINE_AT0, isLooping }, FINE_AT0, (run.length + 3) * FINE_FRAME_MS)
          expect(failed.slice(0, run.length).map(pose => pose.frame)).toEqual(run)
          expect(failed.at(-1)?.state).toBe('ruhe')
        }
        // winken: its run looped for the wave's two seconds, from the spawn.
        const wave = animation('winken')
        const waved = posesOfOwl(owl, costume, { ...FINE_REST, wavedAt: FINE_AT0 }, FINE_AT0, WAVE_MS + 2 * FINE_FRAME_MS)
        const waving = waved.filter(pose => pose.state === 'winken')
        expect(waving.length).toBe(Math.ceil(WAVE_MS / FINE_FRAME_MS))
        waving.forEach((pose, i) => expect(pose.frame).toBe(wave[i % wave.length]))
        expect(waved.at(-1)?.state).toBe('ruhe')
        // gaehnen two minutes into the rest, once, then schlaf.
        const yawn = animation('gaehnen')
        const resting = { ...FINE_REST, restingSince: FINE_AT0 - YAWN_AFTER_MS }
        const yawned = posesOfOwl(owl, costume, resting, FINE_AT0, (yawn.length + 3) * FINE_FRAME_MS)
        expect(yawned.slice(0, yawn.length).map(pose => pose.frame)).toEqual(yawn)
        expect(new Set(yawned.slice(yawn.length).map(pose => pose.state))).toEqual(new Set(['schlaf']))
      }
    }
  })
})

describe('fine Nox: what it does when', () => {
  const at0 = FINE_AT0
  const working = { ...FINE_REST, isWorking: true }

  test('each scene its state, as in 0.18.2: Nox and the mini owl alike, in every costume', () => {
    const cases: [string, Scene, NoxState][] = [
      ['no turn', FINE_REST, 'ruhe'],
      ['two minutes without a turn', { ...FINE_REST, restingSince: at0 - YAWN_AFTER_MS }, 'gaehnen'],
      ['then', { ...FINE_REST, restingSince: at0 - YAWN_AFTER_MS - 10_000 }, 'schlaf'],
      ['agents at work keep it awake', { ...FINE_REST, isBusy: true, restingSince: at0 - YAWN_AFTER_MS - 10_000 }, 'ruhe'],
      ['Read', { ...working, tool: 'read' }, 'lesen'],
      ['Edit', { ...working, tool: 'edit' }, 'schreiben'],
      ['Bash', { ...working, tool: 'shell' }, 'shell'],
      ['no tool', working, 'denken'],
      ['another tool (an agent, TodoWrite, a skill, an MCP tool)', { ...working, tool: 'other' }, 'denken'],
      ['a subagent starts', { ...working, wavedAt: at0 }, 'winken'],
      ['waited on', { ...working, tool: 'ask', isAsking: true }, 'wartet-auf-dich'],
      ['the turn done', { ...FINE_REST, answeredAt: at0 }, 'fertig'],
      ['a failure', { ...working, startledAt: at0 }, 'fehler'],
      ['a failure in a loop', { ...working, startledAt: at0, isLooping: true }, 'loop-warnung'],
      ['hot at rest', { ...FINE_REST, isHot: true }, 'schweiss'],
      ['hot at work', { ...working, tool: 'read', isHot: true }, 'lesen'],
      ['tired', { ...FINE_REST, isTired: true }, 'muede'],
      ['tired and hot', { ...FINE_REST, isTired: true, isHot: true }, 'muede'],
      ['waited on comes first', { ...working, isAsking: true, startledAt: at0, wavedAt: at0 }, 'wartet-auf-dich'],
    ]
    for (const costume of COSTUMES) {
      for (const [, scene, state] of cases) {
        expect(finePoseOf(costume, scene, at0, 'voll').state).toBe(state)
        expect(fineMiniPoseOf(costume, scene, at0, 'voll').state).toBe(state)
      }
    }
  })

  test('the drop of sweat is laid over the other states where it has room, as it runs in schweiss; every costume its own', () => {
    for (const owl of OWLS) {
      for (const costume of COSTUMES) {
        const drops = dropFramesOf(owl, costume)
        const run = animationOf(owl, costume, 'schweiss').lively
        for (const tool of ['read', 'edit', null] as const) {
          const poses = posesOfOwl(owl, costume, { ...working, tool, isHot: true }, at0, run.length * FINE_FRAME_MS)
          // The drop runs with the schweiss run's frames, step by step, where it has room.
          poses.forEach((pose, i) => {
            const due = run[((at0 / FINE_FRAME_MS) % run.length + i) % run.length] ?? -1
            const expected = drops.includes(due) && dropFits(owl, costume, pose.frame, due) ? due : null
            expect(pose.drop).toBe(expected)
          })
          expect(poses.some(pose => pose.drop !== null)).toBe(true)
          // In the pixels: the drop's color where it lies, on top of the frame's own.
          const dropped = poses.find(pose => pose.drop !== null)
          if (dropped !== undefined) {
            const blue = (grid: readonly string[]) => grid.join('').split('B').length - 1
            const grid = fineGridOf(owl, dropped)
            expect(blue(grid)).toBe(blue(SHEETS[owl].frames[dropped.frame] ?? []) + (lookFor(owl, costume).drops.get(dropped.drop ?? -1)?.length ?? -1))
          }
        }
        // Cool, no drop; hot at rest, schweiss itself and nothing laid over.
        for (const pose of posesOfOwl(owl, costume, { ...working, tool: 'read' }, at0, 3000)) expect(pose.drop).toBeNull()
        for (const pose of posesOfOwl(owl, costume, { ...FINE_REST, isHot: true }, at0, 3000)) {
          expect(pose.state).toBe('schweiss')
          expect(pose.drop).toBeNull()
        }
      }
    }
    // Where the head moved or a wing is up, no room: the loop warning's fright, the tired owl.
    for (const drop of dropFramesOf('big', 'ohne')) {
      expect(dropFits('big', 'ohne', 78, drop)).toBe(false)
      expect(dropFits('big', 'ohne', 85, drop)).toBe(false)
    }
  })

  test('each costume\'s drop: its schweiss frames\' sweat, the astronaut\'s badge left out, judged against the resting picture it was drawn on', () => {
    // The resting picture: ruhe's still frame, but the mini astronaut sweats in its other pose.
    expect(COSTUMES.map(costume => animationOf('big', costume, 'ruhe').still)).toEqual([0, 90, 181, 267, 349])
    expect(COSTUMES.map(costume => lookFor('big', costume).dropRest)).toEqual([0, 90, 181, 267, 349])
    expect(COSTUMES.map(costume => animationOf('mini', costume, 'ruhe').still)).toEqual([0, 53, 106, 164, 213])
    expect(COSTUMES.map(costume => lookFor('mini', costume).dropRest)).toEqual([0, 53, 108, 164, 213])
    // The drops' frames: the schweiss frames that hold the sweat's color where no frame of ruhe has it, as the sprites have them.
    const sweating = (owl: Owl, costume: NoxCostume) => {
      const worn = new Set(sequenceOf(owl, costume, 'ruhe').flatMap(([frame]) => (SHEETS[owl].frames[frame] ?? []).flatMap((row, y) => [...row].flatMap((pixel, x) => (pixel === 'B' ? [`${x},${y}`] : [])))))
      return framesOfState(owl, costume, 'schweiss').filter(frame => SHEETS[owl].frames[frame]?.some((row, y) => [...row].some((pixel, x) => pixel === 'B' && !worn.has(`${x},${y}`))))
    }
    for (const owl of OWLS) for (const costume of COSTUMES) expect(dropFramesOf(owl, costume)).toEqual(sweating(owl, costume))
    expect(COSTUMES.map(costume => dropFramesOf('big', costume))).toEqual([
      [80, 81, 82, 83, 84],
      [171, 172, 173, 174, 175],
      [259, 260, 261, 262, 263],
      [342, 343, 344, 345, 346],
      [431, 432, 433, 434, 435],
    ])
    expect(COSTUMES.map(costume => dropFramesOf('mini', costume))).toEqual([
      [47, 48, 49, 50],
      [100, 101, 102, 103],
      [157, 158, 159, 160],
      [208, 209, 210, 211],
      [260, 261, 262, 263],
    ])
    for (const owl of OWLS) {
      for (const costume of COSTUMES) {
        const look = lookFor(owl, costume)
        // A drop of eight pixels for Nox, two for the mini owl, in the sweat's color, never where ruhe has that color of its own.
        const worn = new Set(sequenceOf(owl, costume, 'ruhe').flatMap(([frame]) => (SHEETS[owl].frames[frame] ?? []).flatMap((row, y) => [...row].flatMap((pixel, x) => (pixel === 'B' ? [`${x},${y}`] : [])))))
        for (const [frame, pixels] of look.drops) {
          expect(pixels.length).toBe(owl === 'big' ? 8 : 2)
          for (const [x, y] of pixels) {
            expect(SHEETS[owl].frames[frame]?.[y]?.[x]).toBe('B')
            expect(worn.has(`${x},${y}`)).toBe(false)
          }
        }
      }
    }
    // The astronaut's badge (the sweat's light blue) is its own: in ruhe, never a drop.
    expect(sequenceOf('big', 'astronaut', 'ruhe').some(([frame]) => SHEETS.big.frames[frame]?.some(row => row.includes('B')))).toBe(true)
    // At work the astronaut sweats like the others: on its read, its pencil and its shell.
    for (const tool of ['read', 'edit', 'shell'] as const) {
      expect(posesOfOwl('big', 'astronaut', { ...working, tool, isHot: true }, at0, 6000).some(pose => pose.drop !== null)).toBe(true)
    }
  })

  test('a costume whose drop sits on none of its resting pictures lays none over: hot, it shows its own schweiss, under ruhig too', () => {
    const { frames } = SHEETS.big
    const astronaut = SHEETS.big.costumes.astronaut.states
    // Were it to rest in its upper pose alone, the astronaut's sweat, drawn on its lower breath, would sit on none of its resting pictures.
    const upright = lookOf('astronaut', frames, { ...astronaut, ruhe: astronaut.ruhe.filter(([frame]) => frame === 179) })
    expect(upright.drops.size).toBeGreaterThan(0)
    expect(upright.dropRest).toBeNull()
    // And a costume whose sweat holds no drop at all.
    const plain = SHEETS.big.costumes.ohne.states
    const dry = lookOf('ohne', frames, { ...plain, schweiss: [[0, 500], [1, 500]] })
    expect(dry.drops.size).toBe(0)
    expect(dry.dropRest).toBeNull()
    for (const look of [upright, dry]) {
      // At work, hot: its work, and no drop anywhere.
      for (const tool of ['read', 'edit', 'shell', null] as const) {
        for (const animations of ['voll', 'ruhig'] as const) {
          for (const pose of posesOfLook(look, { ...working, tool, isHot: true }, at0, 4000, animations)) {
            expect(pose.state).toBe(tool === 'read' ? 'lesen' : tool === 'edit' ? 'schreiben' : tool === 'shell' ? 'shell' : 'denken')
            expect(pose.drop).toBeNull()
          }
        }
      }
      // Hot at rest: its own schweiss, under voll and under ruhig (its still frame and its blinks).
      expect(new Set(posesOfLook(look, { ...FINE_REST, isHot: true }, at0, 4000).map(pose => pose.state))).toEqual(new Set(['schweiss']))
      const calm = posesOfLook(look, { ...FINE_REST, isHot: true }, at0, 8000, 'ruhig')
      expect(new Set(calm.map(pose => pose.state))).toEqual(new Set(['schweiss']))
      const { still, blinks } = look.animations.schweiss
      for (const pose of calm) expect(pose.frame === still || blinks.has(pose.frame)).toBe(true)
      // Cool at rest under ruhig: ruhe; aus: ruhe's first frame.
      expect(new Set(posesOfLook(look, FINE_REST, at0, 4000, 'ruhig').map(pose => pose.state))).toEqual(new Set(['ruhe']))
      expect(fineLookPose(look, { ...FINE_REST, isHot: true }, at0, 'aus')).toEqual(look.still)
    }
    // The sprites' own costumes: each one's drop sits on a resting picture, so each lays it over.
    for (const owl of OWLS) for (const costume of COSTUMES) expect(lookFor(owl, costume).dropRest).not.toBeNull()
    // The mini astronaut's sweat sits on its other pose, none on the one it rests on under ruhig: hot at rest there, its own schweiss.
    const mini = posesOfOwl('mini', 'astronaut', { ...FINE_REST, isHot: true }, at0, 8000, 'ruhig')
    expect(new Set(mini.map(pose => pose.state))).toEqual(new Set(['schweiss']))
    expect(new Set(mini.map(pose => pose.frame))).toEqual(new Set([animationOf('mini', 'astronaut', 'schweiss').still]))
    expect(dropFramesOf('mini', 'astronaut')).toContain(animationOf('mini', 'astronaut', 'schweiss').still)
    // At work it lays its drop over as the others do.
    expect(posesOfOwl('mini', 'astronaut', { ...working, tool: 'read', isHot: true }, at0, 4000).some(pose => pose.drop !== null)).toBe(true)
  })

  test('ruhig: each state\'s still frame and its blinks, the drop standing; aus: ruhe\'s first frame; every costume', () => {
    // The blinks: fewer pupils, the same outline, nothing below the eyes changed.
    const blinks = (owl: Owl, costume: NoxCostume) =>
      Object.fromEntries(
        NOX_STATES.flatMap(state => {
          const frames = [...animationOf(owl, costume, state).blinks].sort((a, b) => a - b)
          return frames.length > 0 ? [[state, frames] as const] : []
        }),
      )
    expect(blinks('big', 'ohne')).toEqual({ ruhe: [4], lesen: [25], 'wartet-auf-dich': [54], muede: [88] })
    expect(blinks('mini', 'ohne')).toEqual({ ruhe: [1], lesen: [15], schreiben: [18], 'wartet-auf-dich': [30] })
    // A screen below the eyes is no eye: the hacker's laptop as it reads, the shell's terminal.
    expect(blinks('big', 'hacker')).toEqual({ ruhe: [353], 'wartet-auf-dich': [405], muede: [353] })
    expect(blinks('mini', 'hacker')).toEqual({ ruhe: [214], schreiben: [231], 'wartet-auf-dich': [242] })
    for (const costume of COSTUMES) expect(animationOf('mini', costume, 'shell').blinks.size).toBe(0)
    // The astronaut breathes in two poses a pixel apart and blinks in its lower one: there it rests.
    expect(blinks('big', 'astronaut')).toEqual({ ruhe: [184], lesen: [204], 'wartet-auf-dich': [233], muede: [198] })
    expect(blinks('mini', 'astronaut')).toEqual({ ruhe: [107], lesen: [124], schreiben: [127], 'wartet-auf-dich': [140] })
    // The still frames: the one each holds longest (never one ruhe rests or breathes in, for another state).
    const stills = (owl: Owl, costume: NoxCostume) => NOX_STATES.map(state => animationOf(owl, costume, state).still)
    expect(stills('big', 'ohne')).toEqual([0, 11, 4, 20, 33, 40, 45, 49, 52, 65, 74, 78, 84, 85])
    expect(stills('mini', 'ohne')).toEqual([0, 7, 9, 12, 16, 19, 26, 27, 29, 37, 40, 45, 47, 51])
    // The astronaut's yawn, its turn done and its sweat stand on frames of their own, its sleep on its blink.
    expect(stills('big', 'astronaut')).toEqual([181, 190, 184, 199, 212, 219, 224, 228, 231, 244, 253, 257, 263, 264])
    expect(stills('mini', 'astronaut')).toEqual([106, 114, 117, 121, 125, 128, 136, 137, 139, 147, 150, 155, 157, 161])
    for (const owl of OWLS) {
      for (const costume of COSTUMES) {
        const ruhe = animationOf(owl, costume, 'ruhe')
        // Every costume blinks at rest, Nox and the mini owl.
        expect(ruhe.blinks.size).toBeGreaterThan(0)
        const resting = new Set(sequenceOf(owl, costume, 'ruhe').map(([frame]) => frame).filter(frame => !ruhe.blinks.has(frame)))
        for (const state of NOX_STATES) {
          const { still, blinks: closed } = animationOf(owl, costume, state)
          if (state !== 'ruhe') expect(resting.has(still)).toBe(false)
          // A blink changes the eyes alone: rows down to the still frame's last row of iris and one under it.
          const base = SHEETS[owl].frames[still] ?? []
          const eyesEnd = base.findLastIndex(row => row.includes('Y'))
          for (const blink of closed) {
            const grid = SHEETS[owl].frames[blink] ?? []
            const changed = base.flatMap((row, y) => (row === grid[y] ? [] : [y]))
            expect(changed.length).toBeGreaterThan(0)
            expect(Math.max(...changed)).toBeLessThanOrEqual(eyesEnd + 1)
          }
        }
      }
    }
    const scenes: Scene[] = [
      FINE_REST,
      { ...working, tool: 'read', isHot: true },
      { ...working, tool: 'edit' },
      working,
      { ...FINE_REST, answeredAt: at0 },
      { ...FINE_REST, startledAt: at0, isLooping: true },
      { ...FINE_REST, restingSince: at0 - YAWN_AFTER_MS - 10_000 },
      { ...FINE_REST, isAsking: true },
      { ...FINE_REST, isTired: true },
      { ...FINE_REST, isHot: true },
    ]
    for (const owl of OWLS) {
      for (const costume of COSTUMES) {
        for (const scene of scenes) {
          const calm = posesOfOwl(owl, costume, scene, at0, 12_000, 'ruhig').filter(pose => pose.state === poseOfOwl(owl)(costume, scene, at0, 'ruhig').state)
          const { still, blinks: closed } = animationOf(owl, costume, calm[0]?.state ?? 'ruhe')
          for (const pose of calm) expect(pose.frame === still || closed.has(pose.frame)).toBe(true)
          // Hot: the drop stands, the same one throughout; or, showing schweiss itself (the mini astronaut at rest), its sweat is its own.
          if (scene.isHot) expect(new Set(calm.map(pose => pose.drop)).size).toBe(1)
          const isOwnSweat = calm[0]?.state === 'schweiss'
          expect(calm.some(pose => pose.drop !== null)).toBe(scene.isHot && !isOwnSweat)
          if (isOwnSweat) expect(dropFramesOf(owl, costume)).toContain(calm[0]?.frame)
          for (let at = at0; at < at0 + 4000; at += FINE_FRAME_MS) expect(poseOfOwl(owl)(costume, scene, at, 'aus')).toEqual(fineStillOf(owl, costume))
        }
        // At rest the blink stays: within one run of ruhe, every one of its blinks.
        const ruhe = animationOf(owl, costume, 'ruhe')
        const rest = posesOfOwl(owl, costume, FINE_REST, at0, ruhe.lively.length * FINE_FRAME_MS, 'ruhig').map(pose => pose.frame)
        expect(new Set(rest)).toEqual(new Set([ruhe.still, ...ruhe.blinks]))
        // Hot at rest under ruhig: ruhe with the drop standing, through the blink too, so the blink stays (the mini astronaut aside, see above).
        if (owl === 'mini' && costume === 'astronaut') continue
        const hot = posesOfOwl(owl, costume, { ...FINE_REST, isHot: true }, at0, 8000, 'ruhig')
        expect(new Set(hot.map(pose => pose.state))).toEqual(new Set(['ruhe']))
        expect(new Set(hot.map(pose => pose.frame))).toEqual(new Set([ruhe.still, ...ruhe.blinks]))
        expect(new Set(hot.map(pose => pose.drop)).size).toBe(1)
        expect(fineStillOf(owl, costume)).toEqual({ costume, state: 'ruhe', frame: sequenceOf(owl, costume, 'ruhe')[0]?.[0], drop: null })
      }
    }
    expect(fineStillOf('mini', 'astronaut')).toEqual({ costume: 'astronaut', state: 'ruhe', frame: 106, drop: null })
    // The drop that stands at rest: the first of schweiss's (its still frame, then its run) with room on ruhe's still frame and its blinks.
    const standing = (owl: Owl) => COSTUMES.map(costume => posesOfOwl(owl, costume, { ...FINE_REST, isHot: true }, at0, 1000, 'ruhig')[0]?.drop)
    expect(standing('big')).toEqual([80, 171, 259, 342, 431])
    expect(standing('mini')).toEqual([47, 100, null, 208, 260])
    // Where a blink has no room for any drop (plain Nox waited on, its eyes wide), the drop stands on the still frame and sits the blink out.
    const waited = posesOfOwl('big', 'ohne', { ...FINE_REST, isAsking: true, isHot: true }, at0, 12_000, 'ruhig')
    expect(new Set(waited.map(pose => `${pose.frame}:${pose.drop}`))).toEqual(new Set(['52:84', '54:null']))
  })
})

describe('fine Nox in the pane', () => {
  test('where the terminal draws pictures: the probe first, then Nox as one picture of 16 × 8 cells; off the terminal the blocks', { options: FEIN }, async ($, on) => {
    const world: World = { ...PICTURES, blits: [] }
    const clock = engine(on, world)
    await start($)
    // The first drawing: the block Nox, and the probe, one transparent pixel in one cell, its alt a blank.
    const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const probe = await first.find({ type: 'Image', key: 'probe' })
    expect(probe?.props).toMatchObject({ columns: 1, rows: 1, alt: ' ', source: { width: 1, height: 1 } })
    expect(await first.find({ type: 'Image', key: 'nox' })).toBeUndefined()
    expect(owlOf(poseIn(await first.findAll({ type: 'Text' })))).toBe('nox')
    await first.unmount()
    // The tick blits the probe; the terminal takes it.
    await clock.advance(FRAME_MS)
    expect(world.blits?.map(blit => blit.key)).toEqual(['probe'])
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const nox = await ui.find({ type: 'Image', key: 'nox' })
    expect(nox?.props).toMatchObject({ columns: 16, rows: 8, alt: 'Nox, die Eule' })
    const source = sourceOf(nox)
    expect([source?.width, source?.height]).toEqual([64, 64])
    expect(bytesOf(source?.rgba ?? '').length).toBe(64 * 64 * 4)
    expect(await pictureIn(ui)).toMatch(/^fine:/)
    // The probe stays, invisible, to ask again every few seconds. No block owl beside the picture; the caption stays under it.
    expect((await ui.find({ type: 'Image', key: 'probe' }))?.props).toMatchObject({ columns: 1, rows: 1, alt: ' ' })
    expect(poseIn(await ui.findAll({ type: 'Text' }))).toBe('hidden')
    expect((await captionOf(ui))?.text).toBe('bereit')
    await ui.unmount()
    // Off the terminal: no pictures, no probe, the block Nox.
    const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await desk.findAll({ type: 'Image' })).toEqual([])
    expect(owlOf(poseIn(await desk.findAll({ type: 'Text' })))).toBe('nox')
    await desk.unmount()
  })

  test('Mini-Nox where the pane is short: one picture of 6 × 3 cells beside STATUS\'s lines, the state in the title', { options: FEIN }, async ($, on) => {
    const clock = engine(on, PICTURES)
    await startWithPictures($, clock)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: SHORT.rows } }, surface: 'terminal' })
    const mini = await ui.find({ type: 'Image', key: 'mini' })
    expect(mini?.props).toMatchObject({ columns: 6, rows: 3, alt: 'Nox, die Eule' })
    expect([sourceOf(mini)?.width, sourceOf(mini)?.height]).toEqual([32, 32])
    expect(await pictureIn(ui)).toMatch(/^fineMini:/)
    expect(await ui.find({ type: 'Image', key: 'nox' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '· bereit ' })).toBeDefined()
    await ui.unmount()
    // The picture of Nox is two rows taller than the blocks: it shows from two rows more.
    expect(await shownPicture($, { rows: 32, columns: 48 })).toMatch(/^fineMini:/)
    expect(await shownPicture($, { rows: 33, columns: 48 })).toMatch(/^fine:/)
    // Too narrow for the mini owl: none.
    expect(await shownPicture($, { rows: SHORT.rows, columns: 39 })).toBe('hidden')
  })

  for (const images of ['alt', 'tmux', 'tmuxFix'] as const) {
    test(`a terminal that draws the alt (${images}): the block Nox stays, never an empty box or the alt alone; the probe asks again now and then`, { options: FEIN }, async ($, on) => {
      const world: World = { images, blits: [] }
      const clock = engine(on, world)
      await startWithPictures($, clock)
      for (const size of [TALL, SHORT]) {
        const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: size.rows } }, surface: 'terminal' })
        expect(['nox', 'mini']).toContain(owlOf(await pictureIn(ui)))
        expect(await pictureIn(ui)).not.toMatch(/^fine/)
        // The only picture is the probe: one cell, its alt a blank.
        expect((await ui.findAll({ type: 'Image' })).map(image => image.key)).toEqual(['probe'])
        expect(await ui.find({ type: 'Text', text: /Nox, die Eule/ })).toBeUndefined()
        await ui.unmount()
      }
      // The probe asks again every few seconds, not at every step.
      const before = world.blits?.length ?? 0
      await clock.advance(15_000)
      const asked = (world.blits?.length ?? 0) - before
      expect(asked).toBeGreaterThanOrEqual(2)
      expect(asked).toBeLessThanOrEqual(4)
      expect(owlBlits(world)).toEqual([])
      // Once the terminal draws them (tmux set up, a probe answered late), the owl turns picture.
      world.images = 'ok'
      await clock.advance(5000)
      expect(await shownPicture($)).toMatch(/^fine:/)
    })
  }

  test('a refusal that tells nothing (nothing mounted yet) keeps asking; a blit of the owl that meets the alt turns it back to blocks', { options: FEIN }, async ($, on) => {
    const world: World = { images: 'gone', blits: [] }
    const clock = engine(on, world)
    await startWithPictures($, clock)
    await clock.advance(1000)
    // Asked at every step while nothing is learned; the block owl meanwhile.
    expect((world.blits?.length ?? 0) >= 4).toBe(true)
    expect(owlOf(await shownPicture($))).toBe('nox')
    world.images = 'ok'
    await clock.advance(FRAME_MS)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pictureIn(ui)).toMatch(/^fine:/)
    // Thinking moves the picture; the terminal then stops drawing pictures (tmux attached elsewhere).
    await $.turn.start({ text: '', turnId: 't1' })
    world.images = 'tmux'
    await clock.advance(1000)
    expect(await pictureIn(ui)).not.toMatch(/^fine/)
    expect(owlOf(await pictureIn(ui))).toBe('nox')
    expect((await ui.findAll({ type: 'Image' })).map(image => image.key)).toEqual(['probe'])
    await ui.unmount()
  })

  for (const costume of COSTUMES) {
    test(`at most six pictures a second, a blit only when the picture changes, keyed by the owl (${costume})`, { options: { ...FEIN, noxCostume: costume } }, async ($, on) => {
      const world: World = { ...PICTURES, blits: [] }
      const clock = engine(on, world)
      const outer = $
      on('tool.call', async (_, e) => {
        await clock.advance(3000)
        return e.tool === 'Bash' ? { isError: true, result: 'exit 1', text: 'exit 1' } : READ_RESULT
      })
      await startWithPictures($, clock)
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      await $.turn.start({ text: '', turnId: 't1' })
      await clock.advance(2000)
      await outer.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
      await outer.tool.call({ tool: 'Edit', file_path: '/proj/a.ts', old_string: 'a', new_string: 'b' })
      await outer.tool.call({ tool: 'Bash', command: 'false' })
      // The fright first, then the answer: its flap.
      await clock.advance(STARTLE_MS)
      await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
      await clock.advance(6000)
      await ui.unmount()
      const blits = owlBlits(world)
      expect(blits.length).toBeGreaterThan(30)
      expect(new Set(blits.map(blit => blit.key))).toEqual(new Set(['nox']))
      const gaps = blits.slice(1).map((blit, i) => blit.at - (blits[i]?.at ?? 0))
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000 / 6)
      for (const blit of blits) expect(blits.filter(other => other.at >= blit.at && other.at < blit.at + 1000).length).toBeLessThanOrEqual(6)
      // Never the same picture twice in a row: a blit carries a change.
      blits.slice(1).forEach((blit, i) => {
        const before = blits[i]?.source as { rgba: string } | undefined
        expect((blit.source as { rgba: string }).rgba === before?.rgba).toBe(false)
      })
      // Each blit is a picture of Nox in the costume the cache holds, the read, the pencil, the ruffle and the flap among them.
      const names = blits.map(blit => pictureNames().get((blit.source as { rgba: string }).rgba) ?? 'unknown')
      expect(names).not.toContain('unknown')
      expect(new Set(names.map(costumeOfPicture))).toEqual(new Set([costume]))
      const states = pictureStates(names)
      for (const state of ['lesen', 'schreiben', 'fehler', 'fertig', 'denken']) expect(states).toContain(state)
    })
  }

  test('Mini-Nox in a short pane: its own picture blitted, keyed mini, 32 × 32; it reads, then the turn is done', { options: FEIN }, async ($, on) => {
    const world: World = { ...PICTURES, blits: [] }
    const clock = engine(on, world)
    const outer = $
    on('tool.call', async () => {
      await clock.advance(3000)
      return READ_RESULT
    })
    await startWithPictures($, clock)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: SHORT.rows } }, surface: 'terminal' })
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    await outer.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    await clock.advance(3000)
    await ui.unmount()
    const blits = owlBlits(world)
    expect(blits.length).toBeGreaterThan(5)
    for (const blit of blits) {
      const source = blit.source as { rgba: string; width: number; height: number }
      expect(blit.key).toBe('mini')
      expect([source.width, source.height]).toEqual([32, 32])
      expect(pictureNames().get(source.rgba) ?? 'unknown').toMatch(/^fineMini:/)
    }
    const gaps = blits.slice(1).map((blit, i) => blit.at - (blits[i]?.at ?? 0))
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000 / 6)
    const states = pictureStates(blits.map(blit => pictureNames().get((blit.source as { rgba: string }).rgba) ?? ''))
    for (const state of ['lesen', 'fertig']) expect(states).toContain(state)
  })

  test('a failure: fehler; a failure in a loop: the loop warning, the picture in the pane', { options: FEIN }, async ($, on) => {
    const clock = engine(on, PICTURES)
    on('tool.call', () => ({ isError: true, result: 'exit 1', text: 'exit 1' }))
    await startWithPictures($, clock)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
    const once = pictureStates(await picturesOver($, clock, 1000))
    expect(once).toContain('fehler')
    expect(once).not.toContain('loop-warnung')
    await clock.advance(STARTLE_MS)
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
    const frightened = pictureStates(await picturesOver($, clock, 1500))
    expect(frightened).toContain('loop-warnung')
    expect(frightened).not.toContain('fehler')
  })

  test('another tool running (TodoWrite, an MCP tool): denken, as between tool calls', { options: FEIN }, async ($, on) => {
    const clock = engine(on, PICTURES)
    const outer = $
    const seen: Set<string>[] = []
    on('tool.call', async () => {
      seen.push(await picturesOver(outer, clock, 1500))
      return { result: 'ok' }
    })
    await startWithPictures($, clock)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
    await $.tool.call({ tool: 'mcp__docs__search', query: 'nox' })
    // denken's frames alone (its run ends on the frame Nox rests on), its own among them.
    expect(seen.length).toBe(2)
    for (const pictures of seen) {
      for (const name of pictures) expect(framesOfState('big', 'ohne', 'denken')).toContain(Number.parseInt(pictureKey(name), 10))
      expect(pictureStates(pictures)).toContain('denken')
    }
  })

  test('the animation pauses while the pane is not shown and goes on when it is', { options: FEIN }, async ($, on) => {
    const world: World = { ...PICTURES, blits: [] }
    const clock = engine(on, world)
    await startWithPictures($, clock)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    expect(owlBlits(world).length).toBeGreaterThan(0)
    world.pane = 'hidden'
    await clock.advance(FINE_FRAME_MS)
    const paused = owlBlits(world).length
    await clock.advance(4000)
    expect(owlBlits(world).length).toBe(paused)
    world.pane = 'shown'
    await clock.advance(2000)
    expect(owlBlits(world).length).toBeGreaterThan(paused)
    await ui.unmount()
  })

  test('voll: at rest every frame of ruhe, its glances, its blink and its breath', { options: FEIN }, async ($, on) => {
    const clock = engine(on, PICTURES)
    await startWithPictures($, clock)
    const lively = await picturesOver($, clock, 20_000)
    expect(pictureStates(lively)).toEqual(new Set(['ruhe']))
    expect(new Set([...lively].map(pictureKey))).toEqual(new Set(sequenceOf('big', 'ohne', 'ruhe').map(([frame]) => String(frame))))
  })

  test('ruhig, with pictures: at rest the still owl and its blink; at work the work\'s still frame and its blink', { options: { ...FEIN, animations: 'ruhig' } }, async ($, on) => {
    const clock = engine(on, PICTURES)
    const outer = $
    let reading = new Set<string>()
    on('tool.call', async () => {
      reading = await picturesOver(outer, clock, 8000)
      return READ_RESULT
    })
    await startWithPictures($, clock)
    expect([...(await picturesOver($, clock, 12_000))].sort()).toEqual(['fine:ruhe:0', 'fine:ruhe:4'])
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    // lesen's still frame, and the blink of its own.
    expect([...reading].sort()).toEqual(['fine:lesen:20', 'fine:lesen:25'])
  })

  test('aus, with pictures: a terminal that stops drawing them gets the block Nox back within seconds', { options: { ...FEIN, animations: 'aus' } }, async ($, on) => {
    const world: World = { ...PICTURES, blits: [] }
    const clock = engine(on, world)
    await startWithPictures($, clock)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pictureIn(ui)).toBe('fine:ruhe:0')
    // A background session attached from a terminal without pictures: the probe, asked again, meets the alt.
    world.images = 'alt'
    await clock.advance(6000)
    expect(owlOf(await pictureIn(ui))).toBe('nox')
    expect(await pictureIn(ui)).not.toMatch(/^fine/)
    expect((await ui.findAll({ type: 'Image' })).map(image => image.key)).toEqual(['probe'])
    await ui.unmount()
    expect(owlBlits(world)).toEqual([])
  })

  test('aus, with pictures: one still picture and never a blit of the owl', { options: { ...FEIN, animations: 'aus' } }, async ($, on) => {
    const world: World = { ...PICTURES, blits: [] }
    const clock = engine(on, world)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    // Animations off: the tick runs once a second and still asks the probe.
    await clock.advance(1000)
    await ui.unmount()
    expect(await shownPicture($)).toBe('fine:ruhe:0')
    await $.turn.start({ text: '', turnId: 't1' })
    expect([...(await picturesOver($, clock, 6000))]).toEqual(['fine:ruhe:0'])
    expect(owlBlits(world)).toEqual([])
  })

  test('Reduce motion holds voll to ruhig: no breath, no glance, the blink stays; the block owls too', { options: FEIN }, async ($, on) => {
    const clock = engine(on, { ...PICTURES, isMotionReduced: true })
    await startWithPictures($, clock)
    expect([...(await picturesOver($, clock, 12_000))].sort()).toEqual(['fine:ruhe:0', 'fine:ruhe:4'])
  })

  test('Reduce motion switched on mid-session holds the owl still from the next main turn on', { options: FEIN }, async ($, on) => {
    const world: World = { ...PICTURES }
    const clock = engine(on, world)
    await startWithPictures($, clock)
    world.isMotionReduced = true
    await $.turn.start({ text: '', turnId: 't1' })
    // Thinking under ruhig: denken's still frame only (ruhe's pictures until the turn's motion is read).
    const thinking = [...(await picturesOver($, clock, 3000))]
    expect(thinking).toContain('fine:denken:45')
    expect(thinking.filter(name => name !== 'fine:denken:45' && pictureState(name) !== 'ruhe')).toEqual([])
  })

  test('Reduce motion, block owls: the classic Nox at rest only blinks', { options: { noxStyle: 'klassisch' } }, async ($, on) => {
    const clock = engine(on, { isMotionReduced: true })
    await start($)
    expect([...(await posesOver($, clock, 12_000))].sort()).toEqual(['blink', 'idle'])
  })

  test('noxStyle fein is the default: the picture where the terminal draws pictures', async ($, on) => {
    const world: World = { ...PICTURES, blits: [] }
    const clock = engine(on, world)
    await startWithPictures($, clock)
    // A picture, Nox's or the mini owl's, at rest: whichever frame of ruhe the clock is on.
    expect(await shownPicture($)).toMatch(/^fine:ruhe:/)
    expect(await shownPicture($, SHORT)).toMatch(/^fineMini:ruhe:/)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(2000)
    expect(owlBlits(world).length).toBeGreaterThan(0)
  })

  for (const [named, options] of [
    ['set', { noxStyle: 'klassisch' }],
    ['in a costume', { noxStyle: 'klassisch', noxCostume: 'zauberer' }],
  ] as const) {
    test(`noxStyle klassisch (${named}): the block Nox even where pictures draw; no probe, no blit`, { options }, async ($, on) => {
      const world: World = { ...PICTURES, blits: [] }
      const clock = engine(on, world)
      await startWithPictures($, clock)
      await $.turn.start({ text: '', turnId: 't1' })
      for (const size of [TALL, SHORT]) {
        const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: size.rows } }, surface: 'terminal' })
        expect(await ui.findAll({ type: 'Image' })).toEqual([])
        expect(['nox', 'mini']).toContain(owlOf(await pictureIn(ui)))
        await ui.unmount()
      }
      await clock.advance(3000)
      expect(world.blits).toEqual([])
    })
  }

  for (const name of ['nacht', 'retro'] as const) {
    test(`noxPalette ${name}: the picture in its colors`, { options: { ...FEIN, noxPalette: name, animations: 'aus' } }, async ($, on) => {
      const clock = engine(on, PICTURES)
      await startWithPictures($, clock)
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const rgba = sourceOf(await ui.find({ type: 'Image', key: 'nox' }))?.rgba
      expect(rgba).toBeDefined()
      const kinds = Object.values(PALETTES).map(palette => [palette.name, noxSource(fineStillOf('big', 'ohne'), palette).rgba] as const)
      expect(kinds.filter(([, picture]) => picture === rgba).map(([kind]) => kind)).toEqual([name])
      await ui.unmount()
    })
  }

  for (const costume of COSTUMES) {
    test(`noxCostume ${costume}: Nox and the mini owl wear it, at rest and at work`, { options: { ...FEIN, noxCostume: costume } }, async ($, on) => {
      const clock = engine(on, PICTURES)
      await startWithPictures($, clock)
      const resting = await picturesOver($, clock, 3000)
      const short = await picturesOver($, clock, 2000, SHORT)
      await $.turn.start({ text: '', turnId: 't1' })
      const thinking = await picturesOver($, clock, 2000)
      for (const seen of [resting, short, thinking]) {
        expect([...seen].filter(name => !name.startsWith('fine'))).toEqual([])
        expect(new Set([...seen].map(costumeOfPicture))).toEqual(new Set([costume]))
      }
      expect(pictureStates(resting)).toEqual(new Set(['ruhe']))
      expect([...short].every(name => name.startsWith('fineMini:'))).toBe(true)
      expect(shownFrames(short).every(frame => framesOfState('mini', costume, 'ruhe').includes(frame))).toBe(true)
      expect(shownFrames(thinking).every(frame => framesOfState('big', costume, 'denken').includes(frame))).toBe(true)
      expect(pictureStates(thinking)).toContain('denken')
    })
  }

  for (const costume of COSTUMES) {
    test(`noxCostume ${costume}, aus: ruhe's first frame of the costume, in the palette as set`, { options: { ...FEIN, noxCostume: costume, noxPalette: 'nacht', animations: 'aus' } }, async ($, on) => {
      const clock = engine(on, PICTURES)
      await startWithPictures($, clock)
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      expect(sourceOf(await ui.find({ type: 'Image', key: 'nox' }))?.rgba).toBe(noxSource(fineStillOf('big', costume), PALETTES.nacht).rgba)
      await ui.unmount()
      const short = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: SHORT.rows } }, surface: 'terminal' })
      expect(sourceOf(await short.find({ type: 'Image', key: 'mini' }))?.rgba).toBe(miniSource(fineStillOf('mini', costume), PALETTES.nacht).rgba)
      await short.unmount()
    })
  }

  for (const [named, value] of [
    ['unset', null],
    ['one it does not offer', 'pirat'],
    ['in capitals', 'Hacker'],
  ] as const) {
    test(`noxCostume ${named}: ohne, Nox as it is`, { options: value === null ? { ...FEIN, animations: 'aus' } : { ...FEIN, noxCostume: value, animations: 'aus' } }, async ($, on) => {
      const clock = engine(on, PICTURES)
      await startWithPictures($, clock)
      expect(await shownPicture($)).toBe(stillName('big', 'ohne'))
      expect(await shownPicture($, SHORT)).toBe(stillName('mini', 'ohne'))
    })
  }

  /** noxdeck's own reads and writes of the costume `zufall` drew, counted. */
  function costumeStateOf(on: On) {
    const kept = { reads: 0, writes: [] as unknown[] }
    on('state.get', { plugin: 'noxdeck', key: 'costume' }, (_, e, next) => {
      kept.reads += 1
      return next(e)
    })
    on('state.set', { plugin: 'noxdeck', key: 'costume' }, (_, e, next) => {
      kept.writes.push(e.value)
      return next(e)
    })
    return kept
  }

  /**
   * The costume an earlier load kept, as $.state holds it across a reload:
   * read as stored, a write landing as the store would take it (`update`
   * writes with the version it read).
   */
  function keptCostume(on: On, stored: unknown) {
    const kept = { stored, version: 1, writes: [] as unknown[] }
    on('state.get', { plugin: 'noxdeck', key: 'costume' }, () => ({ value: { value: kept.stored, version: kept.version } }) as never)
    on('state.set', { plugin: 'noxdeck', key: 'costume' }, (_, e) => {
      kept.writes.push(e.value)
      kept.stored = e.value
      kept.version += 1
      return { value: { isSet: true, version: kept.version } } as never
    })
    return kept
  }

  /** How long to wait from the test clock's start (1 000 000 ms) until zufall would draw `costume`. */
  function waitFor(costume: NoxCostume, from = 1_000_000): number {
    for (let ms = 0; ms < 100_000; ms += 1) if (costumeDrawnAt(from + ms) === costume) return ms
    throw new Error(`zufall never draws ${costume}`)
  }

  const ZUFALL = { ...FEIN, noxCostume: 'zufall', animations: 'aus' } as const

  for (const costume of DRAWN_COSTUMES) {
    test(`noxCostume zufall: a session starting at a moment that draws ${costume} wears it, Nox and the mini owl`, { options: ZUFALL }, async ($, on) => {
      const kept = costumeStateOf(on)
      const clock = engine(on, PICTURES)
      await clock.advance(waitFor(costume))
      await startWithPictures($, clock)
      expect(await shownPicture($)).toBe(stillName('big', costume))
      expect(await shownPicture($, SHORT)).toBe(stillName('mini', costume))
      // Drawn once and kept, under the state's shape.
      expect(kept.writes).toEqual([{ shape: 'noxdeck/3', value: costume }])
    })
  }

  test('noxCostume zufall, moving: every picture the drawn costume\'s, at rest and at work', { options: { ...FEIN, noxCostume: 'zufall' } }, async ($, on) => {
    const clock = engine(on, PICTURES)
    await clock.advance(waitFor('hacker'))
    await startWithPictures($, clock)
    const resting = await picturesOver($, clock, 3000)
    await $.turn.start({ text: '', turnId: 't1' })
    const thinking = await picturesOver($, clock, 2000)
    expect(new Set([...resting, ...thinking].map(costumeOfPicture))).toEqual(new Set(['hacker']))
    expect(shownFrames(thinking).every(frame => framesOfState('big', 'hacker', 'denken').includes(frame))).toBe(true)
    expect(pictureStates(thinking)).toContain('denken')
  })

  test('noxCostume zufall: a reload\'s session.start keeps the costume drawn, whatever the clock says then; one write', { options: ZUFALL }, async ($, on) => {
    const kept = costumeStateOf(on)
    const clock = engine(on, PICTURES)
    await clock.advance(waitFor('zauberer'))
    await startWithPictures($, clock)
    expect(await shownPicture($)).toBe(stillName('big', 'zauberer'))
    // Later, at a moment that draws another: session.start again, as a reload runs it.
    await clock.advance(waitFor('astronaut', clock.now()))
    expect(costumeDrawnAt(clock.now())).toBe('astronaut')
    await start($)
    await clock.advance(1000)
    expect(await shownPicture($)).toBe(stillName('big', 'zauberer'))
    expect(await shownPicture($, SHORT)).toBe(stillName('mini', 'zauberer'))
    expect(kept.writes).toEqual([{ shape: 'noxdeck/3', value: 'zauberer' }])
  })

  test('noxCostume zufall, a reload into a fresh module: the costume kept is worn from the first drawing on, before session.start; none drawn', { options: ZUFALL }, async ($, on) => {
    // What the earlier load kept: the costume it drew, and that the terminal draws pictures.
    const kept = keptCostume(on, { shape: 'noxdeck/3', value: 'detektiv' })
    on('state.get', { plugin: 'noxdeck', key: 'images' }, () => ({ value: { value: { shape: 'noxdeck/3', value: true }, version: 1 } }) as never)
    const clock = engine(on, PICTURES)
    // The clock would draw another now.
    await clock.advance(waitFor('hacker'))
    // The pane drawn again by the new module before its session.start has run (its cards still empty: Nox has the room).
    expect(await shownPicture($)).toBe(stillName('big', 'detektiv'))
    await startWithPictures($, clock)
    expect(await shownPicture($)).toBe(stillName('big', 'detektiv'))
    expect(await shownPicture($, SHORT)).toBe(stillName('mini', 'detektiv'))
    expect(kept.writes).toEqual([])
  })

  test('noxCostume zufall, a reload into a fresh module, moving: its ticks blit the costume kept, never the one the clock would draw', { options: { ...FEIN, noxCostume: 'zufall' } }, async ($, on) => {
    const kept = keptCostume(on, { shape: 'noxdeck/3', value: 'detektiv' })
    on('state.get', { plugin: 'noxdeck', key: 'images' }, () => ({ value: { value: { shape: 'noxdeck/3', value: true }, version: 1 } }) as never)
    const world: World = { ...PICTURES, blits: [] }
    const clock = engine(on, world)
    await clock.advance(waitFor('hacker'))
    await startWithPictures($, clock)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await clock.advance(2000)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(3000)
    await ui.unmount()
    const names = owlBlits(world).map(blit => pictureNames().get((blit.source as { rgba: string }).rgba) ?? 'unknown')
    expect(names.length).toBeGreaterThan(5)
    expect(new Set(names.map(costumeOfPicture))).toEqual(new Set(['detektiv']))
    expect(pictureStates(names)).toContain('denken')
    expect(kept.writes).toEqual([])
  })

  for (const [named, value] of [
    ['ohne', { shape: 'noxdeck/3', value: 'ohne' }],
    ['a word', { shape: 'noxdeck/3', value: 'pirat' }],
    ['written in another shape', { shape: 'noxdeck/2', value: 'hacker' }],
  ] as const) {
    test(`noxCostume zufall: a kept value that is no drawn costume (${named}) draws one anew`, { options: ZUFALL }, async ($, on) => {
      const kept = keptCostume(on, value)
      const clock = engine(on, PICTURES)
      await clock.advance(waitFor('astronaut'))
      await startWithPictures($, clock)
      expect(await shownPicture($)).toBe(stillName('big', 'astronaut'))
      expect(kept.writes).toEqual([{ shape: 'noxdeck/3', value: 'astronaut' }])
      // A reload then finds it.
      await clock.advance(waitFor('zauberer', clock.now()))
      await start($)
      expect(await shownPicture($)).toBe(stillName('big', 'astronaut'))
      expect(kept.writes.length).toBe(1)
    })
  }

  test('a costume set (not zufall) neither reads nor writes the one zufall draws', { options: { ...FEIN, noxCostume: 'astronaut' } }, async ($, on) => {
    const kept = costumeStateOf(on)
    const clock = engine(on, PICTURES)
    await startWithPictures($, clock)
    await $.turn.start({ text: '', turnId: 't1' })
    await picturesOver($, clock, 2000)
    await start($)
    expect(kept).toEqual({ reads: 0, writes: [] })
  })

  test('the block Nox wears no costume: where no picture is drawn it is the one it was, at rest and at work', { options: { ...FEIN, noxCostume: 'zufall' } }, async ($, on) => {
    const clock = engine(on, { images: 'alt' })
    await start($)
    const seen = await posesOver($, clock, 20_000)
    expect([...framesIn(seen)].sort()).toEqual(['blink', 'idle', 'lookLeft', 'lookRight'])
    expect(seen.has('idle+inhale')).toBe(true)
  })

  for (const noxCostume of [...COSTUMES, 'zufall'] as const) {
    test(`the pictures are made here: no $.fs, network, process or model call, whatever the owl does (${noxCostume})`, { options: { ...FEIN, noxCostume } }, async ($, on) => {
      const calls: string[] = []
      const counted =
        (name: string) =>
        (...[, e, next]: [unknown, never, (e: never) => unknown]) => {
          calls.push(name)
          return next(e)
        }
      on('fs.read', counted('fs.read') as never)
      on('fs.write', counted('fs.write') as never)
      on('fs.list', counted('fs.list') as never)
      on('fs.stat', counted('fs.stat') as never)
      on('fs.exists', counted('fs.exists') as never)
      on('fs.ancestors', counted('fs.ancestors') as never)
      on('http.fetch', counted('http.fetch') as never)
      on('process.run', counted('process.run') as never)
      on('model.complete', counted('model.complete') as never)
      on('model.classify', counted('model.classify') as never)
      on('model.fork', counted('model.fork') as never)
      on('process.spawn', async function* ($, e, next) {
        calls.push('process.spawn')
        return yield* next(e)
      })
      const world: World = { ...PICTURES, blits: [], messages: [130 * K] }
      const clock = engine(on, world)
      on('tool.call', async () => {
        await clock.advance(2000)
        return READ_RESULT
      })
      await startWithPictures($, clock)
      for (const size of [TALL, SHORT]) {
        const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: size.rows } }, surface: 'terminal' })
        await $.turn.start({ text: '', turnId: `t-${size.rows}` })
        await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
        await $.turn.complete({ turnId: `t-${size.rows}`, answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
        await clock.advance(3000)
        await ui.unmount()
      }
      // A reload's session.start too.
      await start($)
      await clock.advance(2000)
      expect(owlBlits(world).length).toBeGreaterThan(10)
      expect(calls).toEqual([])
    })
  }
})

// ---------------------------------------------------------------- the languages

/** A locale's keys, each with what it holds: a text, a function and how many arguments it takes, a list and how long. */
function keysOf(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return [`${path}: text`]
  if (typeof value === 'function') return [`${path}: function/${value.length}`]
  if (Array.isArray(value)) return [`${path}: list/${value.length}`, ...value.flatMap((item, index) => keysOf(item, `${path}[${index}]`))]
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value)
      .sort()
      .flatMap(key => keysOf((value as Record<string, unknown>)[key], path === '' ? key : `${path}.${key}`))
  }
  return [`${path}: ${typeof value}`]
}

/** Every text a locale holds as it is (not the ones its functions make). */
function textsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(textsOf)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(textsOf)
  return []
}

describe('the languages', () => {
  test('en and de hold the same keys: no text of the pane is missing in either', () => {
    expect(Object.keys(LOCALES).sort()).toEqual(['de', 'en'])
    const de = keysOf(LOCALES.de)
    const en = keysOf(LOCALES.en)
    expect(de.length).toBeGreaterThan(100)
    // Named this way, a failure lists the keys one language lacks.
    expect({ missingInEn: de.filter(key => !en.includes(key)) }).toEqual({ missingInEn: [] })
    expect({ missingInDe: en.filter(key => !de.includes(key)) }).toEqual({ missingInDe: [] })
    for (const locale of [LOCALES.de, LOCALES.en]) for (const text of textsOf(locale)) expect(text.trim().length).toBeGreaterThan(0)
  })

  test('English unless the option says de', () => {
    expect(stringsOf('en')).toBe(LOCALES.en)
    expect(stringsOf('de')).toBe(LOCALES.de)
    for (const other of [undefined, null, '', 'fr', 'DE']) expect(stringsOf(other)).toBe(LOCALES.en)
  })

  kitTest('without the language option the pane speaks English: the manifest\'s default is en', async ($, on) => {
    engine(on, { isMeasured: false })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('ready')
    expect(await ui.find({ type: 'Text', text: 'RADAR · nothing to note' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '5h limit · n/a' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' noxdeck ' })).toBeDefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'noxdeck', args: '', ...RUN }))?.text).toBe('noxdeck opened.')
    expect((await $.command.run({ command: 'noxdeck', args: 'agents', ...RUN }))?.text).toBe('noxdeck opened on agents.')
  })

  kitTest('language de: the pane speaks German', { options: { language: 'de' } }, async ($, on) => {
    engine(on, { isMeasured: false })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('bereit')
    expect(await ui.find({ type: 'Text', text: 'RADAR · keine Auffälligkeiten' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '5h-Limit · n/a' })).toBeDefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'noxdeck', args: '', ...RUN }))?.text).toBe('noxdeck geöffnet.')
  })
})
