// What the test files share.

// Where the hook inputs in these tests come from. The engine's own text (the
// frames and notes in agents.test.tsx) is copied from a recording or from
// Claude Code 2.1.318; an event's fields and their meaning are the types'
// (`.claude-plugin/types`), so is an Agent tool's first turn carrying its
// prompt, which no recording has yet; a tool's answer is the types' or a real
// transcript's. IDs, paths, commands, labels and the prompts a script would
// write are free values: nothing reads their form. A text read for its form
// that has none of these sources is marked `Invented:`.

import { mock, test as kitTest } from 'claude-code/testing'
import type { Engine, TestRest } from 'claude-code/testing'
import type { AgentInfo, ContextWindowSource, On, SessionContextBreakdown, SessionRateLimit, ImageBlitArgs, UiBlitResult } from 'claude-code'
import { FRAME_MS, mascotRows, MINI_ROWS, miniRows, STILL, gridOf } from '../hooks/mascot'
import { themeOf } from '../hooks/themes'
import type { MascotFrame, MiniFrame, MiniPose, Pose } from '../types'

// Nothing sits beneath the plugin in a test: each `on` hook here stands for
// the engine. A call on `$` is answered `{ value }`; an event by its result.

export const SURFACES = ['terminal', 'desktop'] as const

/**
 * The pane speaks English unless `language` says de. The tests here read
 * the German sentences, so each runs with `language: 'de'` unless it names a
 * language itself; `kitTest` runs one with the manifest's defaults.
 */
const GERMAN = { language: 'de' } as const
export const test = (name: string, ...rest: TestRest): void =>
  rest.length === 1
    ? kitTest(name, { options: GERMAN }, rest[0])
    : kitTest(name, { ...rest[0], options: { ...GERMAN, ...rest[0].options } }, rest[1])

export const PANE = {
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

export const K = 1000
/** A German percentage, as the pane writes it: the number, a no-break space, the sign. */
export const P = (n: number | string) => `${n}\u00a0%`

export const used = (name: string, tokens: number, color: string) => ({ name, tokens, color, isDeferred: false, kind: 'used' as const })

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

export type World = {
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
export function engine(on: On, world: World = {}) {
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
  on('classic.PostToolUseFailure', () => ({}))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.blit', (_, e) => {
    if ('source' in e) world.blits?.push({ ...e, at: clock.now() })
    return { value: BLIT_ANSWERS[world.images ?? 'alt'] }
  })
  on('settings.read', () => ({ value: world.isMotionReduced === true ? { prefersReducedMotion: true } : {} }))
  return clock
}

export const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

export const TODOS = [
  { content: 'Add the toggle', status: 'completed', activeForm: 'Adding the toggle' },
  { content: 'Read the styles', status: 'completed', activeForm: 'Reading the styles' },
  { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' },
  { content: 'Wire it into the header', status: 'in_progress', activeForm: 'Wiring it into the header' },
] as const

export const SPAWN = {
  tool_use_id: 'tu',
  prompt: 'not kept',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'm',
  background: true,
  fork: false,
} as const

export const MOOD = /^(arbeitet …|bereit|braucht deine Freigabe|fragt dich|Fehler|fertig|\d+ Agents? (läuft|laufen|wartet|warten)( · \d+ (wartet|warten))?)$/

const MOOD_EN = /^(working …|ready|needs your approval|asking you|error|done|\d+ agents? (running|waiting)( · \d+ waiting)?)$/

export type Found = { text: string; props: Record<string, unknown> }

/** Nox's caption: the state the STATUS card names after its limit line (5h, the week's, or none). */
export async function captionOf(ui: { findAll: (q: { type: string }) => Promise<Found[]> }): Promise<Found | undefined> {
  const texts = await ui.findAll({ type: 'Text' })
  const limit = texts.findLastIndex(found => LIMIT_LINE.test(found.text))
  return texts.slice(limit + 1).find(found => MOOD.test(found.text) || MOOD_EN.test(found.text))
}

/** The bar style of the limit; hearts are the default. */
export const BAR = { options: { limitStyle: 'bar' } } as const

/** STATUS's limit line in either language: the 5h window's or the week's, its text alone or after the cells. */
export const LIMIT_LINE = /^(?:[♥♡▊ ]*)?(?:5h[- ]limit|woche|week) · /i

/** A 5h reading without its reset time: STATUS has two lines, the edit line and the limit. */
export const TWO_LINES: World = { rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] }

// ---------------------------------------------------------------- mascot

export const FRAMES: readonly MascotFrame[] = [
  'idle', 'blink', 'lookLeft', 'lookRight', 'yawn', 'sleep', 'sleepRising', 'sleepStill', 'write', 'write2', 'focus',
  'wave1', 'wave2', 'think1', 'think2', 'think3', 'question', 'questionLow', 'happy', 'happyLanded', 'startled',
  'startledLanded', 'tired', 'tiredBlink',
]

/** A pose by name: the frame, then `+inhale`, `+drowsy`, `+drop0` or `+drop1` for what is laid over it. */
export const labelOf = (pose: Pose) =>
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

export const MINI_FRAMES: readonly MiniFrame[] = [
  'idle', 'blink', 'walkLeft', 'walkRight', 'lookLeft', 'hop', 'hopLanded', 'startled', 'sleep', 'sleepRising',
]

/** A mini pose by name: `mini:` and the frame, then `+ask` and `+drop0` or `+drop1`. */
export const miniLabelOf = (pose: MiniPose) =>
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
export type Size = { rows: number; columns: number }
export const TALL: Size = { rows: 80, columns: 48 }
/** Too short for Nox, wide enough for the mini owl. */
export const SHORT: Size = { rows: 26, columns: 48 }

/**
 * The owl among a drawing's texts, by its pose's name: Nox's (six rows),
 * the mini owl's as `mini:…` (three); `hidden` without one. An owl is its
 * first rows of cells, each a row Text followed by its runs.
 */
export function poseIn(texts: readonly Found[]): string {
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
export const owlOf = (label: string) => (label === 'hidden' ? 'none' : label.startsWith('mini:') ? 'mini' : 'nox')

/** The pose the STATUS card shows now, by name; `hidden` without an owl. */
export async function shownPose($: Engine, surface: (typeof SURFACES)[number] = 'terminal', size: Size = TALL): Promise<string> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: size.columns, scroll: { offset: 0, bodyRows: size.rows } }, surface })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return poseIn(texts)
}

/** The poses the pane shows, step by step, over `ms`. */
export async function posesOver($: Engine, clock: { advance: (ms: number) => Promise<void> }, ms: number, size: Size = TALL): Promise<Set<string>> {
  const seen = new Set<string>()
  for (let t = 0; t < ms; t += FRAME_MS) {
    await clock.advance(FRAME_MS)
    seen.add(await shownPose($, 'terminal', size))
  }
  return seen
}

export const frameOfLabel = (label: string) => label.split('+')[0] ?? label
export const framesIn = (seen: Set<string>) => new Set([...seen].map(frameOfLabel))

export const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const
export const READ_RESULT = { result: { type: 'text', file: { filePath: '/proj/a.ts', content: 'a', numLines: 1, startLine: 1, totalLines: 1 } } }

// ---------------------------------------------------------------- Live and RADAR

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const ANSWERED = { answer: '', isAborted: false, reason: 'answer' } as const
const FAILED = { isError: true, result: 'exit 1', text: 'exit 1' } as const
export const BASH_OK = { result: { stdout: '', stderr: '', interrupted: false } } as const

/**
 * Answers a call as a tool that ran and failed, as the engine reports one:
 * its PostToolUseFailure first (a call refused before its tool ran has
 * none), then the errored result.
 */
export async function failedRun($: Engine, e: { tool: string; tool_use_id?: string }) {
  await $.classic.PostToolUseFailure({ tool_name: e.tool, tool_input: {}, tool_use_id: e.tool_use_id ?? '', error: 'exit 1' })
  return FAILED
}

/** The pane's texts on the terminal at `bodyRows` rows (and `bodyColumns` columns). */
export async function textsAt($: Engine, bodyRows = 80, bodyColumns = 48): Promise<Found[]> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns, scroll: { offset: 0, bodyRows } }, surface: 'terminal' })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts
}

export const has = (texts: readonly Found[], pattern: RegExp) => texts.some(found => pattern.test(found.text))
