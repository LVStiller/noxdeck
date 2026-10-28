import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SiteView, Timer } from 'claude-code'

import type { Activity, AgentBoard, AgentRow, Ask, Cues, FinePose, NoxCostume, Tab, TodoTools, UsageTrack } from '../types'
import {
  costumeDrawnAt,
  costumeOptionOf,
  FINE_FRAME_MS,
  fineMiniPoseOf,
  finePoseOf,
  fineStillOf,
  isDrawnCostume,
  miniSource,
  noxSource,
  PALETTES,
  paletteOf,
  PROBE_SOURCE,
} from './fine'
import type { CostumeOption, Palette } from './fine'
import {
  bashChangesOf,
  callFileOf,
  changeOf,
  effortText,
  exactOf,
  fiveHourOf,
  isAgentLive,
  lastAgents,
  NO_FOLDS,
  NO_LEDGER,
  planFromTaskList,
  planFromTodos,
  planWithCreated,
  planWithTask,
  planWithUpdate,
  snapshotOf,
  withAgent,
  withChange,
  withFold,
  withLedgerStep,
  withWork,
} from './model'
import type { FoldView, ObservedChange } from './model'
import { FRAME_MS, MINI_STILL, miniPoseOf, poseOf, sameMiniPose, samePose, sceneOf, STILL, toolKindOf, waitingFor } from './mascot'
import type { Animations } from './mascot'
import {
  callKey,
  callLabel,
  ENDS_AT_ANSWER,
  filePathOf,
  isApproval,
  NO_RADAR,
  TODO_TOOLS,
  toolName,
  withAsking,
  withFailure,
  withFileUses,
  withNewTurn,
  withoutStreak,
} from './radar'
import { maskSecrets } from './secrets'
import { stringsOf } from './strings'
import { themeOf } from './themes'
import {
  agentsAtWorkOf,
  agentsCard,
  changesCard,
  contextCard,
  frame,
  frameRows,
  MINI_MIN_COLUMNS,
  moodOf,
  PANE_INSET,
  planCard,
  radarCard,
  statusCard,
  uiOf,
} from './view'
import type { LimitStyle, Owl, OwlPictures } from './view'

// noxdeck only watches. Every hook hands the event on unchanged with
// next(e) and returns what the chain beneath answered; what it learns goes
// into $.state, which the pane draws from. It makes no network request,
// starts no process, asks no model, writes no file and keeps no prompt text.
// The one thing it does is the person's own: a press on an agent's row (or
// on the way back) asks the engine to show that transcript in the main view.
// Its own pane it draws, and swaps the fine Nox's picture there with
// $.ui.blit; the pictures it makes in memory.

const PANE = 'noxdeck'
/** `/noxdeck <tab>`: `plan` opens Live, the tab that was called Plan & Context. */
const TAB_BY_ARG: Readonly<Record<string, Tab>> = { live: 'live', plan: 'live', changes: 'changes', agents: 'agents' }
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

const IDLE: Activity = {
  isWorking: false,
  hasTurnError: false,
  hasToolError: false,
  editing: null,
  lastEdited: null,
  answeredAt: null,
}
const NO_USAGE: UsageTrack = { history: [], compactions: 0, cacheRead: 0, inputTotal: 0 }
const NO_CUES: Cues = {
  running: [],
  asking: [],
  startledAt: null,
  wavedAt: null,
  restingSince: 0,
  waitedMs: 0,
  waitingSince: null,
  isWaitApprox: false,
  approvals: 0,
}
const NO_TODO_TOOLS: TodoTools = { isListed: false, isUsed: false }
const NO_BOARD: AgentBoard = { now: 0, rows: [], ledger: NO_LEDGER }

/**
 * The shape every value in $.state is kept under. $.state outlives a hot
 * reload and /reload-plugins; bump this whenever a value's shape changes,
 * so what an older version wrote reads as absent instead of being misread.
 */
const STATE_SHAPE = 'noxdeck/3'
const SHAPE = { shape: STATE_SHAPE } as const
/** The cues' shape since they sum the wait for approvals (version 0.8). */
const CUES_SHAPE = { shape: 'noxdeck/4' } as const
/** RADAR's shape since it counts a turn's failures and knows Bash by its description (version 0.9). */
const RADAR_SHAPE = { shape: 'noxdeck/5' } as const
/** The usage track's shape since it keeps no peak (version 0.13). */
const USAGE_SHAPE = { shape: 'noxdeck/7' } as const
/** The loops' tokens and work by agentId, and the Agents tab's snapshot of them (version 0.14.1; 0.14.0 kept noxdeck/8). */
const LEDGER_SHAPE = { shape: 'noxdeck/9' } as const

const tab = atom({ plugin: 'noxdeck', key: 'tab' } as const, 'live', SHAPE)
const plan = atom({ plugin: 'noxdeck', key: 'plan' } as const, [], SHAPE)
const context = atom({ plugin: 'noxdeck', key: 'context' } as const, null, SHAPE)
const usage = atom({ plugin: 'noxdeck', key: 'usage' } as const, NO_USAGE, USAGE_SHAPE)
const fiveHour = atom({ plugin: 'noxdeck', key: 'fiveHour' } as const, null, SHAPE)
const activity = atom({ plugin: 'noxdeck', key: 'activity' } as const, IDLE, SHAPE)
const changes = atom({ plugin: 'noxdeck', key: 'changes' } as const, [], SHAPE)
const missedFiles = atom({ plugin: 'noxdeck', key: 'missedFiles' } as const, 0, SHAPE)
const agents = atom({ plugin: 'noxdeck', key: 'agents' } as const, [], SHAPE)
const root = atom({ plugin: 'noxdeck', key: 'root' } as const, '', SHAPE)
const now = atom({ plugin: 'noxdeck', key: 'now' } as const, 0, SHAPE)
const isDismissed = atom({ plugin: 'noxdeck', key: 'isDismissed' } as const, false, SHAPE)
const cues = atom({ plugin: 'noxdeck', key: 'cues' } as const, NO_CUES, CUES_SHAPE)
const pose = atom({ plugin: 'noxdeck', key: 'pose' } as const, STILL, SHAPE)
const miniPose = atom({ plugin: 'noxdeck', key: 'miniPose' } as const, MINI_STILL, SHAPE)
const radar = atom({ plugin: 'noxdeck', key: 'radar' } as const, NO_RADAR, RADAR_SHAPE)
const todoTools = atom({ plugin: 'noxdeck', key: 'todoTools' } as const, NO_TODO_TOOLS, SHAPE)
const agentLedger = atom({ plugin: 'noxdeck', key: 'agentLedger' } as const, NO_LEDGER, LEDGER_SHAPE)
const agentBoard = atom({ plugin: 'noxdeck', key: 'agentBoard' } as const, NO_BOARD, LEDGER_SHAPE)
const agentFolds = atom({ plugin: 'noxdeck', key: 'agentFolds' } as const, NO_FOLDS, SHAPE)
const isProcessedOpen = atom({ plugin: 'noxdeck', key: 'isProcessedOpen' } as const, false, SHAPE)
const images = atom({ plugin: 'noxdeck', key: 'images' } as const, null, SHAPE)
const drawnCostume = atom({ plugin: 'noxdeck', key: 'costume' } as const, null, SHAPE)

/**
 * Keys an earlier version read while drawing and this one no longer uses.
 * On a hot reload or /reload-plugins the old version's render can still be
 * running, and the engine judges each of its $.state.get calls by this
 * module's scan; a key this module never names is refused there and that
 * render is skipped. Reading each once at session.start keeps them named.
 */
const RETIRED_HAS_TODO_TOOL = { plugin: 'noxdeck', key: 'hasTodoTool' } as const
const RETIRED_TURN = { plugin: 'noxdeck', key: 'turn' } as const
const RETIRED_PACE = { plugin: 'noxdeck', key: 'pace' } as const

const MAX_FILES = 2000

/** Runs an observation, never letting it disturb the event it watched. */
async function quietly(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // An observation that failed leaves the pane as it was.
  }
}

const pathOf = (e: { tool: string } & Record<string, unknown>): string | null => {
  const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
  return typeof path === 'string' ? path : null
}

/**
 * Reads the window: the status line's measured fill (history, the header,
 * what is left until compaction) and the /context breakdown's local
 * estimate (the bar, the table). `summary` counts locally and sends no
 * request.
 */
async function refreshContext($: EngineInterface, isTurn: boolean): Promise<void> {
  const measured = await $.session.usage({ breakdown: 'summary' })
  await update($, fiveHour, () => fiveHourOf(measured.rateLimits))
  const exact = exactOf(measured.context)
  const breakdown = measured.context.breakdown
  if (breakdown !== undefined) await update($, context, () => snapshotOf(breakdown, exact, measured.context.window))
  if (exact === null || !isTurn) return

  await update($, usage, track => ({
    ...track,
    history: [...track.history, { tokens: exact.tokens, window: exact.window }].slice(-240),
  }))
}

/**
 * The project folder CHANGES shows paths from: the session's root, which
 * `/cd` or a worktree move takes elsewhere after the start. `$.session.root()`
 * only reads.
 */
async function refreshRoot($: EngineInterface): Promise<void> {
  const folder = await $.session.root()
  await update($, root, current => (current === folder ? current : folder))
}

/** Whether the model has a todo tool now: the PLAN card shows, else RADAR. `$.tool.list()` only reads. */
async function refreshTodoTools($: EngineInterface): Promise<void> {
  const isListed = (await $.tool.list()).some(tool => TODO_TOOLS.has(tool.name))
  await update($, todoTools, state => (state.isListed === isListed ? state : { ...state, isListed }))
}

async function refreshAgents($: EngineInterface): Promise<void> {
  const listed = await $.agent.list()
  const at = await $.clock.now()
  await update($, agents, rows => {
    const next = rows.map(row => {
      const info = listed.find(one => one.id === row.id)
      if (info) {
        return {
          ...row,
          description: row.description ?? maskSecrets(info.description),
          type: row.type ?? info.type,
          listedStatus: info.status,
          isGone: false,
        }
      }
      // Listed before and dropped now: its loop has ended. A turn still open
      // then was never heard to end, so its duration is unknown.
      if (row.listedStatus !== null && !row.isGone) {
        const isOpen = row.turnStartedAt !== null
        return { ...row, isGone: true, turnStartedAt: null, isTimed: row.isTimed && !isOpen }
      }
      return row
    })
    for (const info of listed) {
      if (next.some(row => row.id === info.id)) continue
      next.push(newAgent(info.id, at, { description: maskSecrets(info.description), type: info.type, listedStatus: info.status }))
    }
    return lastAgents(next, isAgentLive)
  })
}

function newAgent(id: string, at: number, fields: Partial<AgentRow> = {}): AgentRow {
  return {
    id,
    description: null,
    type: null,
    listedStatus: null,
    endReason: null,
    turnStartedAt: null,
    doneMs: 0,
    isTimed: false,
    isGone: false,
    firstSeen: at,
    ...fields,
  }
}

const upsertAgent = (rows: AgentRow[], id: string, at: number, change: (row: AgentRow) => AgentRow): AgentRow[] =>
  rows.some(row => row.id === id)
    ? rows.map(row => (row.id === id ? change(row) : row))
    : lastAgents([...rows, change(newAgent(id, at))], row => row.id === id || isAgentLive(row))

/** The Agents tab's snapshot as last written: a write only when it changed, or while an agent's clock runs. */
let boardKey = ''

/**
 * Copies the agents and their work into the snapshot the Agents tab draws,
 * with the clock: the tab redraws at most once a second however often a
 * step, a call or a turn writes the ledger.
 */
async function flushBoard($: EngineInterface, at: number): Promise<void> {
  const rows = await read($, agents)
  const ledger = await read($, agentLedger)
  const key = JSON.stringify([rows, ledger])
  if (key === boardKey && !rows.some(isAgentLive)) return
  boardKey = key
  await update($, agentBoard, () => ({ now: at, rows, ledger }))
}

// While the pane is open or Claude or an agent works, a tick runs: one per
// animation step (four a second for the block owls, six for the fine
// pictures; one a second with animations off). It moves the mascot, whose
// pose is written only when it changes, and once a second the pane's clock
// and the agents' list; it stops once nothing is live and the pane is
// closed. The timer is this module's: a reload drops it, and session.start
// starts it again.
let ticker: Timer | null = null
/** The period the running tick was started with. */
let tickerMs = 0
/** The `animations` option this module was loaded with. */
let animations: Animations = 'voll'
/** The `noxStyle` option: the fine picture where the terminal draws pictures (the default), else the block characters. */
let noxStyle: 'fein' | 'klassisch' = 'fein'
/** The `noxPalette` option's colors for the fine pictures. */
let palette: Palette = PALETTES.standard
/** The `noxCostume` option: a costume, or `zufall`, the session's drawn at its start. */
let costumeOption: CostumeOption = 'ohne'
/** The costume the fine owls wear: the option's, or the one `zufall` drew (`ohne` until session.start has it). */
let costume: NoxCostume = 'ohne'
/** Claude Code's own `prefersReducedMotion` setting (/config → Reduce motion): voll moves no more than ruhig. */
let isMotionReduced = false
/** How much the owls move now: the option, held to ruhig under reduced motion. */
const motionOf = (): Animations => (isMotionReduced && animations === 'voll' ? 'ruhig' : animations)

// The fine owls. Whether the terminal draws pictures is learned, never
// guessed: a drawing on the terminal in the fein style holds a probe, one
// transparent pixel in the empty line under the tabs, and until the probe
// has answered the block owl; the tick blits the probe, and the answer
// decides. Taken (`{}`), the owl is a picture; refused because the picture
// shows its alt there (`the Image draws its alt here`, or tmux holding it
// back, `fix: 'tmux-passthrough'`), the block owl. The probe asks again
// every few seconds either way, so a terminal that stops drawing pictures
// (a session attached elsewhere) gets the block owl back even with
// animations off; the same unchanged pixel sends nothing to the terminal.
// Any other refusal (not mounted yet) or an error tells nothing. A blit of
// the owl that meets the alt turns it back too.
/** Whether this load's probe has answered; the answer is kept in $.state (`images`). */
let isProbed = false
let probedAt = Number.NEGATIVE_INFINITY
/** The last answer, mirrored from $.state for the tick's period. */
let isPictureDrawn = false
/** What the last drawing of the terminal holds: the probe, and the fine owl with the picture it shows. */
let isProbeDrawn = false
let fineShown: { owl: 'nox' | 'mini'; source: object } | null = null
/** The fine poses for this moment: what a drawing shows, and the tick blits when they change. */
let finePose: FinePose = fineStillOf('big', 'ohne')
let fineMiniPose: FinePose = fineStillOf('mini', 'ohne')
/** When the last blit of an owl went out: at most six a second. */
let blittedAt = Number.NEGATIVE_INFINITY
/** When each block owl's pose was last written: at most four a second, whatever the tick. */
let poseWrittenAt = Number.NEGATIVE_INFINITY
let miniPoseWrittenAt = Number.NEGATIVE_INFINITY
/** How often the probe asks again once it has answered. */
const PROBE_AGAIN_MS = 5000
/** The words an Image's refusal starts with where it draws its alt (Claude Code 2.1.311). */
const DRAWS_ALT = /draws its alt/
/** The second the once-a-second work last ran in. */
let lastSecond = -1
/** A tick still running: the next step skips rather than overtake it. */
let isTicking = false
/** Numbers the main loop's tool calls that come without a tool_use_id. */
let calls = 0

// A permission dialog names no call (its PermissionRequest carries none), so
// the calls tool.check put to one wait here, oldest first, with their input,
// until their PermissionRequest takes them. What a call met on its way is
// kept by its tool_use_id until its tool.call ends: a permission decision (a
// dialog, or a deny by a rule, a hook or the auto-mode check), the tool
// failing as it ran, how long it ran. Each is this module's: a reload
// drops them, and an ask then falls back to its tool and loop.
let checkedAsks: (Ask & { input: string })[] = []
const permissionCalls = new Set<string>()
const failedCalls = new Map<string, 'error' | 'interrupt'>()
/** How long each call's tool ran (PostToolUse's duration_ms: no dialog, no hook time), any loop. */
const ranMs = new Map<string, number>()
/** Subagents with a dialog open: only their calls need to look for one to end. */
const agentsAsking = new Set<string>()

/** A tool input as a key two events of one call share. */
function inputKey(input: unknown): string {
  try {
    return JSON.stringify(input) ?? ''
  } catch {
    return ''
  }
}

/** The open dialog a call ends: its own, else one of its tool and loop no check named. */
function askIndexOf(asking: readonly Ask[], id: string, tool: string, agentId: string | undefined): number {
  const own = asking.findIndex(ask => ask.id === id)
  if (own >= 0) return own
  return asking.findIndex(ask => ask.id === null && ask.tool === tool && ask.agentId === (agentId ?? null))
}

const withoutAsk = (asking: readonly Ask[], index: number): Ask[] => asking.filter((_, i) => i !== index)

const isAnythingLive = async ($: EngineInterface): Promise<boolean> =>
  (await read($, activity)).isWorking || (await read($, agents)).some(isAgentLive)

const isPaneShown = async ($: EngineInterface): Promise<boolean> =>
  (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)

const isPaneOpen = async ($: EngineInterface): Promise<boolean> => (await $.ui.panes()).some(pane => pane.id === PANE)

async function tick($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  const isNewSecond = Math.floor(at / 1000) !== lastSecond
  if (isNewSecond) {
    lastSecond = Math.floor(at / 1000)
    if ((await read($, agents)).some(isAgentLive)) await refreshAgents($)
  }
  if (await isPaneShown($)) {
    // Clocks, the done state and the Agents tab move on once a second, the mascot every step.
    if (isNewSecond) {
      await update($, now, () => at)
      await flushBoard($, at)
    }
    await probe($, at)
    if (motionOf() !== 'aus') await animate($, at)
    return
  }
  // Open behind another tab or not yet placed: keep ticking, draw nothing.
  if ((await isPaneOpen($)) || (await isAnythingLive($))) return
  ticker?.cancel()
  ticker = null
  // A turn, an agent or the pane may have come up while this tick was reading.
  if ((await isAnythingLive($)) || (await isPaneOpen($))) ensureTicker($)
}

/** The tick's period: a second with animations off, a fine step while the owl is a picture, else a block step. */
const tickMsOf = (): number => (motionOf() === 'aus' ? 1000 : noxStyle === 'fein' && isPictureDrawn ? FINE_FRAME_MS : FRAME_MS)

/** Starts the tick, or starts it again at another period once the owl became a picture or stopped being one. */
function ensureTicker($: EngineInterface): void {
  const ms = tickMsOf()
  if (ticker !== null && tickerMs !== ms) {
    ticker.cancel()
    ticker = null
  }
  if (ticker !== null) return
  tickerMs = ms
  ticker = $.clock.every(ms, () => {
    if (isTicking) return
    isTicking = true
    void quietly(() => tick($)).finally(() => {
      isTicking = false
    })
  })
}

type Blitted = 'drawn' | 'alt' | 'unknown'

/** Swaps the picture keyed `key` in the pane; what the answer tells about the terminal. */
async function blit($: EngineInterface, key: string, source: { rgba: string; width: number; height: number }): Promise<Blitted> {
  try {
    const answer = await $.ui.blit({ requestId: PANE, key, source })
    if (answer.deny === undefined) return 'drawn'
    return answer.fix === 'tmux-passthrough' || DRAWS_ALT.test(answer.deny) ? 'alt' : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Keeps what was learned about pictures: a change redraws the owl, and the tick's period follows. */
async function learnPictures($: EngineInterface, isDrawn: boolean): Promise<void> {
  isPictureDrawn = isDrawn
  if ((await read($, images)) !== isDrawn) await update($, images, () => isDrawn)
  ensureTicker($)
}

/**
 * Blits the probe while the drawing holds it: at every step until this
 * load's probe has answered, then every few seconds.
 */
async function probe($: EngineInterface, at: number): Promise<void> {
  if (!isProbeDrawn || (isProbed && at - probedAt < PROBE_AGAIN_MS)) return
  probedAt = at
  const answer = await blit($, 'probe', PROBE_SOURCE)
  if (answer === 'unknown') return
  isProbed = true
  await learnPictures($, answer === 'drawn')
}

/**
 * The poses of Nox and of the mini owl for this moment. The block owls'
 * are written only when they changed, at most four a second: a drawing
 * reads the one it shows, so the other one's writes redraw nothing, and a
 * resize that swaps them finds it current. The fine owls' are kept here,
 * and the picture the drawing holds is blitted when it changed, at most
 * six a second; nothing is drawn again for it.
 */
async function animate($: EngineInterface, at: number): Promise<void> {
  const scene = sceneOf(
    await read($, activity),
    await read($, cues),
    await read($, agents),
    await read($, context),
    await read($, fiveHour),
    at,
    await read($, radar),
  )
  const motion = motionOf()
  const next = poseOf(scene, at, motion)
  if (!samePose(await read($, pose), next) && at - poseWrittenAt >= FRAME_MS) {
    poseWrittenAt = at
    await update($, pose, () => next)
  }
  const nextMini = miniPoseOf(scene, at, motion)
  if (!sameMiniPose(await read($, miniPose), nextMini) && at - miniPoseWrittenAt >= FRAME_MS) {
    miniPoseWrittenAt = at
    await update($, miniPose, () => nextMini)
  }
  if (noxStyle !== 'fein' || !isPictureDrawn) return
  finePose = finePoseOf(costume, scene, at, motion)
  fineMiniPose = fineMiniPoseOf(costume, scene, at, motion)
  const shown = fineShown
  if (shown === null) return
  const source = shown.owl === 'nox' ? noxSource(finePose, palette) : miniSource(fineMiniPose, palette)
  // The same picture is never sent again: pictures are kept, so the same pose is the same object.
  if (source === shown.source || at - blittedAt < FINE_FRAME_MS) return
  blittedAt = at
  const answer = await blit($, shown.owl, source)
  if (answer === 'drawn') {
    if (fineShown?.owl === shown.owl) fineShown = { owl: shown.owl, source }
  } else if (answer === 'alt') {
    await learnPictures($, false)
  } else if (fineShown === shown) {
    // Not mounted (another tab, a pane drawn elsewhere): nothing to swap until the next drawing.
    fineShown = null
  }
}

/**
 * Reads Claude Code's `prefersReducedMotion` (one key of the settings; read
 * only): at the start, at every main turn and when /noxdeck opens the pane.
 */
async function readMotion($: EngineInterface): Promise<void> {
  isMotionReduced = (await $.settings.read({ key: 'prefersReducedMotion' })) === true
}

/** Dresses the fine owls in `next`: at rest until the next step poses them. */
function wear(next: NoxCostume): void {
  costume = next
  finePose = fineStillOf('big', next)
  fineMiniPose = fineStillOf('mini', next)
}

/**
 * The session's costume under `zufall`: the one kept in $.state, which a
 * reload finds; else one drawn from `at`, the start's clock, and kept.
 */
async function drawCostume($: EngineInterface, at: number): Promise<NoxCostume> {
  const kept = await read($, drawnCostume)
  if (isDrawnCostume(kept)) return kept
  const drawn = costumeDrawnAt(at)
  await update($, drawnCostume, () => drawn)
  return drawn
}

/** The costume a drawing shows: under `zufall` the session's as kept, so a drawing before session.start has run again (a reload) wears it too. */
async function wornCostume($: EngineInterface): Promise<NoxCostume> {
  if (costumeOption !== 'zufall') return costume
  const kept = await read($, drawnCostume)
  return isDrawnCostume(kept) ? kept : costume
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'noxdeck', columns: 52 })
}

/** A refusal as the toast shows it: its first line, cut short. */
const shortly = (text: string) => {
  const line = text.split('\n')[0]?.trim() ?? ''
  return line.length <= 160 ? line : `${line.slice(0, 159)}…`
}

/**
 * Puts the transcript the person pressed in the main view: an agent's from
 * its row, the main chat's from the way back. Called from the press itself,
 * as the engine moves the view only for the person's own input. A refusal
 * is shown as a toast, its reason as it came after `refused`'s words;
 * nothing else is tried. The engine's own comes back as `deny`; a plugin's
 * hook that refuses rejects the call, its reason after the engine's
 * `<plugin>: $.ui.view: `.
 */
function showView($: EngineInterface, view: SiteView, refused: (reason: string) => string): void {
  void quietly(async () => {
    const deny = await $.ui.view(view).then(
      shown => shown.deny,
      (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^[^\s:]+: \$\.ui\.view: /, ''),
    )
    if (deny !== undefined) $.ui.toast(shortly(refused(deny)))
  })
}

export const register: Register = (on, options) => {
  const theme = themeOf(options.theme)
  const s = stringsOf(options.language)
  const limitStyle: LimitStyle = options.limitStyle === 'bar' ? 'bar' : 'hearts'
  animations = options.animations === 'ruhig' || options.animations === 'aus' ? options.animations : 'voll'
  noxStyle = options.noxStyle === 'klassisch' ? 'klassisch' : 'fein'
  palette = paletteOf(options.noxPalette)
  costumeOption = costumeOptionOf(options.noxCostume)
  wear(costumeOption === 'zufall' ? 'ohne' : costumeOption)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await quietly(() => readMotion($))
    await quietly(async () => {
      isPictureDrawn = (await read($, images)) === true
    })
    await quietly(async () => {
      await $.state.get(RETIRED_HAS_TODO_TOOL)
      await $.state.get(RETIRED_TURN)
      await $.state.get(RETIRED_PACE)
      await update($, root, () => e.cwd)
      const at = await $.clock.now()
      // zufall: the costume drawn at this session's start, from this moment; a reload keeps the one kept.
      if (costumeOption === 'zufall') wear(await drawCostume($, at))
      await update($, cues, state => ({ ...state, restingSince: at }))
      // The pots count from here; a hot reload keeps them.
      await update($, agentLedger, ledger => (ledger.since > 0 ? ledger : { ...ledger, since: at }))
      await $.command.register({
        name: 'noxdeck',
        description: s.command.description,
        argumentHint: '[live|changes|agents]',
        immediate: true,
      })
      if (e.isInteractive && !(await read($, isDismissed))) void openPane($)
      await refreshContext($, false)
      await refreshAgents($)
      // Agents there before noxdeck loaded (or before this version did): what
      // they did until now was not seen, so their own figures stay –.
      const known = (await read($, agents)).filter(row => row.description !== null)
      await update($, agentLedger, ledger =>
        known.reduce(
          (sum, row) =>
            sum.work.some(one => one.id === row.id) ? sum : withWork(sum, row.id, work => ({ ...work, isAgent: true, isWhole: false })),
          ledger,
        ),
      )
      await flushBoard($, at)
      ensureTicker($)
    })
    await quietly(() => refreshTodoTools($))
    await quietly(() => refreshRoot($))
    return started
  })

  on('command.run', { command: 'noxdeck' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    const chosen: Tab | undefined = Object.hasOwn(TAB_BY_ARG, wanted) ? TAB_BY_ARG[wanted] : undefined
    if (chosen !== undefined) await update($, tab, () => chosen)
    await update($, isDismissed, () => false)
    // Opening the pane wakes the mascot.
    const at = await $.clock.now()
    await update($, cues, state => ({ ...state, restingSince: at }))
    await quietly(() => readMotion($))
    await openPane($)
    await quietly(() => flushBoard($, at))
    ensureTicker($)
    return { text: chosen === undefined ? s.command.opened : s.command.openedOn(chosen) }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    if (e.origin.kind === 'person') await quietly(() => update($, isDismissed, () => true))
    return closed
  })

  on('tool.call', async ($, e, next) => {
    const editPath = EDIT_TOOLS.has(e.tool) ? pathOf(e) : null
    if (editPath !== null) await quietly(() => update($, activity, state => ({ ...state, editing: editPath })))

    // While it runs, a main-loop call decides what the mascot does.
    const isMain = e.agentId === undefined
    const call = { id: e.tool_use_id ?? `call-${(calls += 1)}`, kind: toolKindOf(e.tool) }
    if (isMain) await quietly(() => update($, cues, state => ({ ...state, running: [...state.running, call].slice(-20) })))

    // A subagent's call is its latest activity: the tool and the file's name,
    // never a command, prompt, pattern or path.
    if (e.agentId !== undefined) {
      const id = e.agentId
      await quietly(async () => {
        const file = callFileOf(e as unknown as Record<string, unknown>)
        const lastCall = { tool: toolName(e.tool), file: file === null ? null : maskSecrets(file), at: await $.clock.now() }
        await update($, agentLedger, ledger => withWork(ledger, id, work => ({ ...work, lastCall })))
      })
    }

    // What the call met on its way: an open dialog as it ended, a permission
    // decision, the tool failing as it ran.
    let wasAsked = false
    let wasDecided = false
    let failure: 'error' | 'interrupt' | undefined
    let reply: Awaited<ReturnType<typeof next>> | undefined
    try {
      reply = await next(e)
    } finally {
      failure = failedCalls.get(call.id)
      failedCalls.delete(call.id)
      await quietly(async () => {
        // The call is over, and with it a permission dialog raised for it.
        checkedAsks = checkedAsks.filter(ask => ask.id !== call.id)
        if (!isMain && !(e.agentId !== undefined && agentsAsking.has(e.agentId))) return
        // A tool that ran after its dialog ends later than the answer: the wait
        // ends its run time before the call's end, and is approximate (hook time
        // stays in it). A call that failed as it ran or was interrupted ran too;
        // one that threw is not known to have waited only.
        const hasRun = failure !== undefined || reply === undefined || (reply.deny === undefined && reply.isError !== true)
        const ran = ranMs.get(call.id)
        const at = (await $.clock.now()) - (hasRun && ran !== undefined ? ran : 0)
        // Decided inside the update, which runs again on the newer value: a
        // read after next(e), in a hook that touched state before it, can be stale.
        await update($, cues, state => {
          const asked = askIndexOf(state.asking, call.id, e.tool, e.agentId)
          wasAsked = asked >= 0
          if (!isMain && asked < 0) return state
          const ask = state.asking[asked]
          const isApprox = ask !== undefined && isApproval(ask) && hasRun && !ENDS_AT_ANSWER.has(e.tool)
          const running = state.running.filter(one => one.id !== call.id)
          return withAsking({ ...state, running }, withoutAsk(state.asking, asked), at, isApprox)
        })
      })
      wasDecided = permissionCalls.delete(call.id)
      ranMs.delete(call.id)
    }
    const answer = reply as Awaited<ReturnType<typeof next>>
    // A call refused at a dialog, by a rule, a hook or the auto-mode check
    // comes back errored too; only one the tool failed in as it ran (a Bash
    // command's exit code other than 0 among them), or that failed with no
    // permission decision on its way, is a failure: it startles the mascot
    // and counts on RADAR.
    const isScare = answer.isError === true && (failure === 'error' || (failure === undefined && !wasAsked && !wasDecided))

    if (e.agentId !== undefined) {
      const id = e.agentId
      await quietly(() =>
        update($, agentLedger, ledger =>
          withWork(ledger, id, work => ({ ...work, calls: work.calls + 1, errors: work.errors + (isScare ? 1 : 0) })),
        ),
      )
    }

    await quietly(async () => {
      const at = await $.clock.now()
      const result = answer.deny === undefined && answer.isError !== true ? answer.result : undefined
      const input = e as unknown as Record<string, unknown>

      // RADAR: the main loop's failures, and the same call failing in a row,
      // kept by its tool and a hash of its target and named without either.
      if (isMain) {
        if (isScare) {
          const key = callKey(e.tool, input)
          const label = callLabel(e.tool, input)
          await update($, radar, state => withFailure(state, key, label, at))
        } else {
          await update($, radar, withoutStreak)
        }
      }

      const fromBash = e.tool === 'Bash' && result !== undefined ? bashChangesOf(result) : { changes: [], missed: 0 }
      const observed: ObservedChange[] =
        e.tool === 'Bash'
          ? fromBash.changes
          : result === undefined
            ? []
            : [changeOf(e.tool, input, result)].filter(one => one !== null)
      // The last edit is a file this call is known to have changed (not a staged or failed one).
      const changedPath = observed.at(-1)?.path ?? null

      // While the main turn runs, the file Claude changed last stays the one
      // it is editing (turn.complete lets go of it); a call that changed
      // nothing lets go of its own file.
      if (editPath !== null || changedPath !== null) {
        await update($, activity, state => ({
          ...state,
          editing:
            state.isWorking && changedPath !== null
              ? changedPath
              : editPath !== null && state.editing === editPath
                ? null
                : state.editing,
          lastEdited: changedPath ?? state.lastEdited,
        }))
      }
      if (e.agentId === undefined && answer.deny === undefined) {
        await update($, activity, state => ({ ...state, hasToolError: answer.isError === true }))
        if (isScare) await update($, cues, state => ({ ...state, startledAt: at }))
      }
      if (result === undefined) return
      // The files Claude read or edited, for RADAR's hotspots (a Bash command's
      // by its diff): the main loop's and its subagents', not those of a loop
      // the engine forks for itself (memory, compaction), which nothing names.
      const path = filePathOf(e.tool, input)
      const used = e.tool === 'Bash' ? fromBash.changes.map(change => change.path) : path === null ? [] : [path]
      const isClaude = isMain || (await read($, agents)).some(row => row.id === e.agentId && row.description !== null)
      if (used.length > 0 && isClaude) await update($, radar, state => withFileUses(state, used, at))
      // A todo tool answered and its plan is shown (a subagent's TodoWrite is
      // not): the session has one, and the PLAN card shows.
      if (TODO_TOOLS.has(e.tool) && (isMain || e.tool !== 'TodoWrite')) {
        await update($, todoTools, state => (state.isUsed ? state : { ...state, isUsed: true }))
      }

      if (observed.length > 0) {
        let evicted = 0
        await update($, changes, list => {
          const all = observed.reduce((files, change) => withChange(files, change, at), list)
          evicted = Math.max(0, all.length - MAX_FILES)
          return all.slice(0, MAX_FILES)
        })
        if (evicted + fromBash.missed > 0) await update($, missedFiles, n => n + evicted + fromBash.missed)
      }

      // A worktree entered or left moves the project folder.
      if (e.tool === 'EnterWorktree' || e.tool === 'ExitWorktree') await refreshRoot($)

      if (e.tool === 'TodoWrite' && e.agentId === undefined) {
        const record = result as Record<string, unknown>
        const steps = planFromTodos(record.newTodos ?? input.todos)
        if (steps !== null) await update($, plan, () => steps)
      } else if (e.tool === 'TaskCreate') {
        await update($, plan, steps => planWithCreated(steps, input, result))
      } else if (e.tool === 'TaskUpdate') {
        await update($, plan, steps => planWithUpdate(steps, input, result))
      } else if (e.tool === 'TaskGet') {
        await update($, plan, steps => planWithTask(steps, result))
      } else if (e.tool === 'TaskList') {
        await update($, plan, steps => planFromTaskList(steps, result) ?? steps)
      }
    })
    return answer
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await quietly(async () => {
      if (spawned.deny !== undefined || spawned.agentId === undefined) return
      const id = spawned.agentId
      const at = await $.clock.now()
      await update($, agents, rows =>
        upsertAgent(rows, id, at, row => ({ ...row, description: maskSecrets(e.description), type: e.subagentType })),
      )
      // A subagent, a workflow's too: its tokens are the Agents pot's, the steps heard before this answer included.
      await update($, agentLedger, ledger => withAgent(ledger, id))
      // The mascot waves the new agent off.
      await update($, cues, state => ({ ...state, wavedAt: at }))
      ensureTicker($)
    })
    return spawned
  })

  // A call the permission check puts to a dialog, kept until its
  // PermissionRequest takes it; one it refuses, noted.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (id !== undefined && verdict?.decision === 'ask') {
      const checked = { id, tool: e.tool, agentId: e.agentId ?? null, input: inputKey(e.input) }
      checkedAsks = [...checkedAsks.filter(ask => ask.id !== id), checked].slice(-20)
    }
    if (id !== undefined && verdict?.decision === 'deny') permissionCalls.add(id)
    return verdict
  })

  // A call a PreToolUse hook refused.
  on('classic.PreToolUse', async ($, e, next) => {
    const decided = await next(e)
    if (decided?.deny !== undefined) permissionCalls.add(e.tool_use_id)
    return decided
  })

  // The dialog shows while the PermissionRequest hooks run, so the mascot
  // asks from the start; it stops when a hook beneath decides, or when the
  // call ends.
  on('classic.PermissionRequest', async ($, e, next) => {
    // Its call: the checked ask of this tool and loop with the same input,
    // else the oldest (an ask the auto-mode check settled opens no dialog).
    const loop = e.agent_id ?? null
    const input = inputKey(e.tool_input)
    const candidates = checkedAsks.filter(ask => ask.tool === e.tool_name && ask.agentId === loop)
    const checked = candidates.find(ask => ask.input === input) ?? candidates[0]
    checkedAsks = checkedAsks.filter(ask => ask !== checked)
    const asked: Ask = { id: checked?.id ?? null, tool: e.tool_name, agentId: loop }
    if (asked.id !== null) permissionCalls.add(asked.id)
    if (loop !== null) agentsAsking.add(loop)
    await quietly(async () => {
      const at = await $.clock.now()
      await update($, cues, state => {
        const opened = withAsking(state, [...state.asking, asked].slice(-20), at)
        return isApproval(asked) ? { ...opened, approvals: opened.approvals + 1 } : opened
      })
      ensureTicker($)
    })
    const answered = await next(e)
    if (answered?.decision !== undefined) {
      const isAsked = (ask: Ask) => ask.id === asked.id && ask.tool === asked.tool && ask.agentId === asked.agentId
      // A hook decided: no approval the person gave.
      await quietly(async () => {
        const at = await $.clock.now()
        await update($, cues, state => {
          const closed = withAsking(state, withoutAsk(state.asking, state.asking.findIndex(isAsked)), at)
          return isApproval(asked) ? { ...closed, approvals: Math.max(0, closed.approvals - 1) } : closed
        })
      })
    }
    return answered
  })

  // A call the auto-mode check refused: not a tool error, and no dialog.
  on('classic.PermissionDenied', async ($, e, next) => {
    const denied = await next(e)
    checkedAsks = checkedAsks.filter(ask => ask.id !== e.tool_use_id)
    permissionCalls.add(e.tool_use_id)
    return denied
  })

  // A call the tool itself failed in, or that was interrupted as it ran, and how long it ran.
  on('classic.PostToolUseFailure', async ($, e, next) => {
    const failed = await next(e)
    failedCalls.set(e.tool_use_id, e.is_interrupt === true ? 'interrupt' : 'error')
    if (typeof e.duration_ms === 'number') ranMs.set(e.tool_use_id, e.duration_ms)
    return failed
  })

  // How long a call's tool ran: the wait for its approval ended that much before the call did.
  on('classic.PostToolUse', async ($, e, next) => {
    const done = await next(e)
    if (typeof e.duration_ms === 'number') ranMs.set(e.tool_use_id, e.duration_ms)
    return done
  })

  // Every model request's tokens, read once its response is whole: the
  // stream passes through unread, and its result goes back as it came, its
  // model and effort never rewritten. A request is counted by its loop (the
  // main chat's without an id); whether a loop is a subagent (a spawn
  // answered it, or $.agent.list() names it) is decided as the pane draws.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    await quietly(async () => {
      const loop = e.agentId ?? null
      await update($, agentLedger, ledger => withLedgerStep(ledger, loop, r.usage, effortText(e.effort)))
      if (loop === null || (await read($, agentLedger)).work.some(one => one.id === loop && one.isAgent)) return
      if ((await $.agent.list()).some(info => info.id === loop)) await update($, agentLedger, ledger => withAgent(ledger, loop))
    })
    return r
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    await quietly(async () => {
      const at = await $.clock.now()
      await update($, now, () => at)
      if (e.agentId === undefined) {
        await update($, activity, state => ({
          ...state,
          isWorking: true,
          hasTurnError: false,
          hasToolError: false,
          answeredAt: null,
        }))
        // A new prompt is a new attempt: neither stage of the last turn's loop goes on.
        await update($, radar, withNewTurn)
      } else {
        const id = e.agentId
        await update($, agents, rows =>
          upsertAgent(rows, id, at, row => ({ ...row, turnStartedAt: at, isTimed: true, endReason: null })),
        )
        // Its first turn's start, for the group's duration and the timeline.
        await update($, agentLedger, ledger => withWork(ledger, id, work => ({ ...work, startedAt: work.startedAt ?? at })))
      }
      ensureTicker($)
    })
    // The model's tools can change between turns (another model, a setting), the project folder (/cd), Reduce motion.
    if (e.agentId === undefined) {
      await quietly(() => refreshTodoTools($))
      await quietly(() => refreshRoot($))
      await quietly(() => readMotion($))
    }
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    await quietly(async () => {
      if (e.agentId === undefined) {
        const hasFailed = e.reason === 'error' || e.reason === 'refusal'
        const at = await $.clock.now()
        // `now` never lags the answer, or the done state could outlast its time.
        await update($, now, () => at)
        await update($, activity, state => ({
          ...state,
          isWorking: false,
          hasTurnError: hasFailed,
          editing: null,
          answeredAt: e.reason === 'answer' ? at : null,
        }))
        // The turn's calls and questions are over; the rest starts, and a failed turn startles.
        await update($, cues, state =>
          withAsking(
            { ...state, running: [], restingSince: at, startledAt: hasFailed ? at : state.startledAt },
            state.asking.filter(ask => ask.agentId !== null),
            at,
          ),
        )
        // One history sample per finished main turn, so growth is per turn.
        await refreshContext($, true)
        const spent = e.usage
        if (spent !== undefined) {
          await update($, usage, track => ({
            ...track,
            cacheRead: track.cacheRead + spent.cache_read_input_tokens,
            inputTotal:
              track.inputTotal + spent.input_tokens + spent.cache_creation_input_tokens + spent.cache_read_input_tokens,
          }))
        }
        return
      }
      const id = e.agentId
      const at = await $.clock.now()
      await update($, agents, rows =>
        upsertAgent(rows, id, at, row => ({
          ...row,
          turnStartedAt: null,
          doneMs: row.doneMs + e.durationMs,
          isTimed: true,
          endReason: e.reason,
        })),
      )
      await update($, agentLedger, ledger => withWork(ledger, id, work => ({ ...work, endedAt: at })))
      // Its turn's dialogs are over; an agent at work keeps the rest from starting.
      agentsAsking.delete(id)
      await update($, cues, state =>
        withAsking(
          { ...state, restingSince: Math.max(state.restingSince, at) },
          state.asking.filter(ask => ask.agentId !== id),
          at,
        ),
      )
      await refreshAgents($)
      // A loop no spawn and no listing named (a compaction or memory fork) is not shown; drop it.
      await update($, agents, rows => rows.filter(row => row.description !== null || row.turnStartedAt !== null))
    })
    return completed
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    await quietly(async () => {
      if (e.changed.includes('rateLimits')) await update($, fiveHour, () => fiveHourOf(e.rateLimits))
      if (e.changed.includes('context')) await refreshContext($, false)
    })
    return measured
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    await quietly(async () => {
      if (e.agentId !== undefined || e.trigger === 'precompute' || compacted.skip !== undefined) return
      await update($, usage, track => ({ ...track, compactions: track.compactions + 1 }))
      // The compacted transcript is installed once this chain has returned: measure it after.
      $.clock.after(500, () => void quietly(() => refreshContext($, false)))
    })
    return compacted
  })

  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      // /clear or /resume puts another conversation in this process: start the pane over.
      await quietly(async () => {
        await update($, plan, () => [])
        await update($, changes, () => [])
        await update($, missedFiles, () => 0)
        await update($, agents, () => [])
        await update($, usage, () => NO_USAGE)
        await update($, activity, () => IDLE)
        await update($, radar, () => NO_RADAR)
        await update($, todoTools, state => ({ ...state, isUsed: false }))
        const at = await $.clock.now()
        await update($, cues, () => ({ ...NO_CUES, restingSince: at }))
        await update($, agentLedger, () => ({ ...NO_LEDGER, since: at }))
        await update($, agentBoard, () => ({ ...NO_BOARD, now: at, ledger: { ...NO_LEDGER, since: at } }))
        await update($, agentFolds, () => NO_FOLDS)
        boardKey = ''
        checkedAsks = []
        permissionCalls.clear()
        failedCalls.clear()
        ranMs.clear()
        agentsAsking.clear()
        await update($, context, () => null)
        $.clock.after(1000, () => void quietly(() => refreshContext($, false)))
      })
    }
    return ended
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Pictures are the terminal's alone; there, in the fein style, the probe
    // and the fine owls once the probe has learned that pictures are drawn.
    const isTerminal = e.surface === 'terminal'
    const image = e.surface === 'terminal' ? $.ui.resolve(e).Image : null
    const ui = uiOf($.ui.resolve(e), e.surface, theme, s, Math.max(20, e.props.bodyColumns - PANE_INSET), image)
    const isFine = noxStyle === 'fein' && isTerminal
    const isPicture = isFine && (await read($, images)) === true
    const probeSource = isFine ? PROBE_SOURCE : null
    if (isTerminal) {
      isProbeDrawn = probeSource !== null
      fineShown = null
    }
    // A tab an older version stored under another name (`plan`) is Live.
    const stored = await read($, tab)
    const shown: Tab = stored === 'changes' || stored === 'agents' ? stored : 'live'
    // The Agents tab opens on a fresh snapshot; while it shows, the tick writes one at most once a second.
    const onTab = (to: Tab) =>
      void (async () => {
        if (to === 'agents') await quietly(async () => flushBoard($, await $.clock.now()))
        await update($, tab, () => to)
      })()

    if (shown === 'changes') {
      return frame(ui, shown, onTab, changesCard(ui, await read($, changes), await read($, missedFiles), await read($, root)), probeSource)
    }
    if (shown === 'agents') {
      // The snapshot alone: the tab redraws at most once a second. The full
      // card where the pane has the rows for it, else the compact view. The
      // agent in the main view is the pane's `view`: a switch draws again.
      const room = e.props.scroll.bodyRows - frameRows(ui)
      const controls = {
        viewed: e.props.view.agentId ?? null,
        folds: await read($, agentFolds),
        onView: (agentId: string | null) => showView($, agentId === null ? {} : { agentId }, s.agents.viewDenied),
        // A workflow's agent has no view: Claude Code answers no agent under that id, so none is asked for.
        onWorkflowAgent: () => void quietly(async () => $.ui.toast(s.agents.workflowAgent)),
        onFold: (prefix: string, view: FoldView) => void quietly(() => update($, agentFolds, folds => withFold(folds, prefix, view))),
        isProcessedOpen: await read($, isProcessedOpen),
        onProcessed: () => void quietly(() => update($, isProcessedOpen, isOpen => !isOpen)),
      }
      return frame(ui, shown, onTab, agentsCard(ui, await read($, agentBoard), room, controls), probeSource)
    }

    // Live: STATUS on top, CONTEXT, then RADAR (PLAN where the session has a todo tool).
    const state = await read($, activity)
    const at = await read($, now)
    const rows = await read($, agents)
    const asked = await read($, cues)
    const found = await read($, radar)
    const mood = moodOf(state, rows, at, waitingFor(state, asked))
    // The owls' poses are read once the drawing knows which one it shows. A
    // fine owl's picture is the tick's latest, which no $.state holds: a
    // change of it is blitted, never drawn again. In another costume than
    // the one worn (a reload under zufall, before session.start), at rest.
    const worn = isPicture ? await wornCostume($) : costume
    const nox = finePose.costume === worn ? finePose : fineStillOf('big', worn)
    const mini = fineMiniPose.costume === worn ? fineMiniPose : fineStillOf('mini', worn)
    const pictures: OwlPictures | null = isPicture ? { nox: noxSource(nox, palette), mini: miniSource(mini, palette) } : null
    const statusView = {
      activity: state,
      fiveHour: await read($, fiveHour),
      mood,
      agentsAtWork: agentsAtWorkOf(rows),
      pose: STILL,
      miniPose: MINI_STILL,
      pictures,
      now: at,
      limitStyle,
      radar: found,
    }
    const todo = await read($, todoTools)
    const steps = todo.isListed || todo.isUsed ? await read($, plan) : null
    const bottom = (maxRows: number | null) =>
      steps === null ? radarCard(ui, { radar: found, cues: asked, now: at }, maxRows) : planCard(ui, steps, maxRows)
    const measured = contextCard(ui, await read($, context), await read($, usage))

    // Too little height: Nox goes first, the mini owl taking its place beside
    // STATUS's lines (none in a pane too narrow for it too), then the bottom
    // card's last rows. Decided at every drawing from the pane's rows and
    // columns as they are, so a resize swaps the owls either way.
    const room = e.props.scroll.bodyRows - frameRows(ui)
    const whole = bottom(null)
    const isNoxShown = statusCard(ui, statusView, 'nox').rows + measured.rows + (whole?.rows ?? 0) <= room
    const owl: Owl = isNoxShown ? 'nox' : e.props.bodyColumns >= MINI_MIN_COLUMNS ? 'mini' : 'none'
    // With animations off the owl stands still and its pose is never read; else only the shown block owl's.
    const isMoving = animations !== 'aus' && pictures === null
    const posed = {
      ...statusView,
      pose: isMoving && owl === 'nox' ? await read($, pose) : STILL,
      miniPose: isMoving && owl === 'mini' ? await read($, miniPose) : MINI_STILL,
    }
    const status = statusCard(ui, posed, owl)
    if (isTerminal && pictures !== null && owl !== 'none') fineShown = { owl, source: pictures[owl] }
    const below = isNoxShown ? whole : bottom(room - status.rows - measured.rows)
    return frame(ui, shown, onTab, [status.element, measured.element, below?.element ?? null], probeSource)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const drawn = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        {drawn}
        {e.props.modes.length > 0 ? <Text dimColor> · </Text> : null}
        <Text color={theme.accent}>{`noxdeck · ${theme.name}`}</Text>
      </Box>
    )
  })
}
