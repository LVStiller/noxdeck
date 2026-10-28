import type { Color } from 'claude-code'

import type { Activity, AgentRow, ContextSnapshot, Cues, MascotFrame, MiniFrame, MiniPose, Pose, Radar, RateWindow, ToolKind } from '../types'
import { isAgentLive, limitLeft, thresholdPercent } from './model'
import { loopOf, NO_RADAR } from './radar'
import type { Theme } from './themes'

// noxdeck's mascot: Nox, a small lavender owl with ear tufts, yellow eyes
// and yellow feet. Each grid row is one pixel row; two pixel rows share a
// terminal cell through the half blocks ▀ ▄ █. Pixels name a role the theme
// colors: B body, D outline and shadow, L shine, E pupils, A the yellow of
// eyes and feet, '.' empty. A frame is a body with marks laid over it (the
// Z of sleep, the thought dots, the question mark, a drop); breathing,
// heavy lids and the sweat drop are laid over whatever frame shows.

/** How much the mascot moves: every animation, blinking only, or none (the `animations` option). */
export type Animations = 'voll' | 'ruhig' | 'aus'

/** What decides the pose, read from the session's state at one moment. */
export type Scene = {
  isWorking: boolean
  /** Agents run while the main loop rests: awake, never asleep. */
  isBusy: boolean
  /** The newest main-loop tool call still running; null between calls. */
  tool: ToolKind | null
  /** A permission dialog is open, or a tool waits on the person: a question, a plan to approve. */
  isAsking: boolean
  startledAt: number | null
  wavedAt: number | null
  answeredAt: number | null
  restingSince: number
  /** The context is more than 80 % of the way to the auto-compact threshold (of the window with auto-compaction off). */
  isHot: boolean
  /** Less than 20 % of the 5h limit is left. */
  isTired: boolean
  /** RADAR warns of a loop: the same call failed three times in a row (its last failure startled the owl). */
  isLooping: boolean
}

type Grid = readonly string[]
type Mark = { sprite: Grid; x: number; y: number }
type Drawing = { body: Grid; marks?: readonly Mark[] }

const EMPTY_ROW = '................'

const IDLE: Grid = [
  '................',
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD.....',
  '..DBBBDBBBD.....',
  '.DBLLLBLLLBD....',
  '.DLAEABAEABD....',
  '.DLAAADAAABD....',
  '.DBDLLDLLDDD....',
  '..DBDLLLDBD.....',
  '...DDLLLDD......',
  '...AA...AA......',
]

const YAWN: Grid = [
  '................',
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD.....',
  '..DBBBDBBBD.....',
  '.DBLLLBLLLBD....',
  '.DLDDDBDDDBD....',
  '.DLLLLDLLLBD....',
  '.DBDLDEDLDDD....',
  '..DBDDEDDBD.....',
  '...DDLDLDD......',
  '...AA...AA......',
]

/** Head sunk, eyes shut. */
const SLEEP: Grid = [
  '................',
  '................',
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD.....',
  '.DBLLLBLLLBD....',
  '.DLBBBBBBBBD....',
  '.DLDDDBDDDBD....',
  '.DBDLLDLLDDD....',
  '..DBDLLLDBD.....',
  '...DDLLLDD......',
  '...AA...AA......',
]

/** A pencil in the right wing, eyes on its tip. */
const WRITE: Grid = [
  '................',
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD.....',
  '..DBBBDBBBD..D..',
  '.DBLLLBLLLBD.AD.',
  '.DLAAABAAABD.AD.',
  '.DLAAEDAAEBD.AD.',
  '.DBDLLDLLDDBBAD.',
  '..DBDLLLDBD..AD.',
  '...DDLLLDD...D..',
  '...AA...AA......',
]

/** The pencil lifted a pixel: the two alternate as it writes. */
const WRITE_LIFTED: Grid = [
  '................',
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD..D..',
  '..DBBBDBBBD..AD.',
  '.DBLLLBLLLBD.AD.',
  '.DLAAABAAABD.AD.',
  '.DLAAEDAAEBD.AD.',
  '.DBDLLDLLDDBBAD.',
  '..DBDLLLDBD..D..',
  '...DDLLLDD......',
  '...AA...AA......',
]

/** Brows drawn together, eyes narrowed. */
const FOCUS: Grid = [
  '................',
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD.....',
  '..DDBBDBBDD.....',
  '.DBBDDBDDBBD....',
  '.DLAEABAEABD....',
  '.DLLLLDLLLBD....',
  '.DBDLLDLLDDD....',
  '..DBDLLLDBD.....',
  '...DDLLLDD......',
  '...AA...AA......',
]

const WAVE_UP: Grid = [
  '................',
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD..B.B',
  '..DBBBDBBBD.DBDB',
  '.DBLLLBLLLBD.BBD',
  '.DLAEABAEABD.BD.',
  '.DLAAADAAABBBD..',
  '.DBDLLDLLLDBD...',
  '..DBDLLLDBD.....',
  '...DDLLLDD......',
  '...AA...AA......',
]

const WAVE_OUT: Grid = [
  '................',
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD.B.B.',
  '..DBBBDBBBD.BDBD',
  '.DBLLLBLLLBDBBBD',
  '.DLAEABAEABD.BD.',
  '.DLAAADAAABBBD..',
  '.DBDLLDLLLDBD...',
  '..DBDLLLDBD.....',
  '...DDLLLDD......',
  '...AA...AA......',
]

/** Eyes turned up, toward the thought dots. */
const THINK: Grid = [
  '................',
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD.....',
  '..DBBBDBBBD.....',
  '.DBAEABAEABD....',
  '.DLAAABAAABD....',
  '.DLAAADAAABD....',
  '.DBDLLDLLDDD....',
  '..DBDLLLDBD.....',
  '...DDLLLDD......',
  '...AA...AA......',
]

/** One brow up, one eye wide. */
const QUESTION: Grid = [
  '................',
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD.....',
  '..DBBBDBBBD.....',
  '.DBDDDBAAABD....',
  '.DLAEABAEABD....',
  '.DLLLLDAAABD....',
  '.DBDLLDLLDDD....',
  '..DBDLLLDBD.....',
  '...DDLLLDD......',
  '...AA...AA......',
]

/** Eyes ^ ^, beak open, a pixel off the ground. */
const HAPPY: Grid = [
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD.....',
  '..DBBBDBBBD.....',
  '.DBLELBLELBD....',
  '.DLELEBELEBD....',
  '.DLAAADAAABD....',
  '.DBDLEEELDDD....',
  '..DBDLELDBD.....',
  '...DDLLLDD......',
  '...AA...AA......',
  '................',
]

/** Eyes wide, beak open, jolted a pixel up. */
const STARTLED: Grid = [
  '................',
  '.DB.......BD....',
  '..DBDDDDDBD.....',
  '..DBBBDBBBD.....',
  '.DBAAABAAABD....',
  '.DLAEABAEABD....',
  '.DLAAADAAABD....',
  '.DBDLLELLDDD....',
  '..DBDLDLDBD.....',
  '...DDLLLDD......',
  '...AA...AA......',
  '................',
]

/** Tufts drooping, lids half down. */
const TIRED: Grid = [
  '................',
  '................',
  '................',
  'DB.........BD...',
  '.DBBDDDDDBBD....',
  '.DBLLLBLLLBD....',
  '.DLDDDBDDDBD....',
  '.DLAEADAEABD....',
  '.DBDLLDLLDDD....',
  '..DBDLLLDBD.....',
  '...DDLLLDD......',
  '...AA...AA......',
]

const Z: Grid = ['BBB', '.B.', 'B..', 'BBB']
const DROP: Grid = ['.B.', 'BLB', 'BBB']
const QUESTION_MARK: Grid = ['BB.', '..B', '.B.', '...', '.B.']

/** Where the sweat drop hangs beside the head: its left column and top row. */
const DROP_AT = { x: 13, y: 4 }

/** A grid with some rows replaced. */
const withRows = (grid: Grid, rows: Readonly<Record<number, string>>): Grid => grid.map((row, i) => rows[i] ?? row)

/** A grid one pixel lower; its last row must be empty. */
const lowered = (grid: Grid): Grid => [EMPTY_ROW, ...grid.slice(0, -1)]

const FRAMES: Readonly<Record<MascotFrame, Drawing>> = {
  idle: { body: IDLE },
  blink: { body: withRows(IDLE, { 6: '.DLDDDBDDDBD....' }) },
  lookLeft: { body: withRows(IDLE, { 6: '.DLEAABEAABD....' }) },
  lookRight: { body: withRows(IDLE, { 6: '.DLAAEBAAEBD....' }) },
  yawn: { body: YAWN },
  sleep: { body: SLEEP, marks: [{ sprite: Z, x: 13, y: 0 }] },
  sleepRising: { body: SLEEP, marks: [{ sprite: Z, x: 13, y: 1 }] },
  sleepStill: { body: SLEEP },
  write: { body: WRITE },
  write2: { body: WRITE_LIFTED },
  focus: { body: FOCUS },
  wave1: { body: WAVE_UP },
  wave2: { body: WAVE_OUT },
  think1: { body: THINK, marks: [{ sprite: ['B'], x: 4, y: 1 }] },
  think2: { body: THINK, marks: [{ sprite: ['B.B'], x: 4, y: 1 }] },
  think3: { body: THINK, marks: [{ sprite: ['B.B.B'], x: 4, y: 1 }] },
  question: { body: QUESTION, marks: [{ sprite: QUESTION_MARK, x: 13, y: 0 }] },
  questionLow: { body: QUESTION, marks: [{ sprite: QUESTION_MARK, x: 13, y: 1 }] },
  happy: { body: HAPPY },
  happyLanded: { body: lowered(HAPPY) },
  startled: { body: STARTLED, marks: [{ sprite: DROP, x: 13, y: 1 }] },
  startledLanded: { body: lowered(STARTLED), marks: [{ sprite: DROP, x: 13, y: 2 }] },
  tired: { body: TIRED },
  tiredBlink: { body: withRows(TIRED, { 6: '.DLBBBBBBBBD....', 7: '.DLDDDBDDDBD....' }) },
}

/** The text rows the mascot takes (its caption not counted). */
export const MASCOT_ROWS = Math.ceil(IDLE.length / 2)

// ------------------------------------------------------------ drawing

/** The belly row that breathing in adds, under the raised chest. */
const BELLY = '.DBDLLLLLDBD....'

/** Breathing in: rows 1–8 rise a pixel, the belly widens, the feet stay; row 0 must be empty. */
const inhaled = (grid: Grid): Grid => [...grid.slice(1, 9), BELLY, ...grid.slice(9)]

/** The two eyes' columns. */
const EYE_COLUMNS = [3, 4, 5, 7, 8, 9]
const isOpenEye = (pixel: string | undefined) => pixel === 'A' || pixel === 'E'

/**
 * Whether heavy lids fit the frame: both eyes open over rows 6 and 7 and
 * nothing open above them (eyes turned up, wide or raised are left alone).
 */
function canDrowse(grid: Grid): boolean {
  return EYE_COLUMNS.every(x => isOpenEye(grid[6]?.[x]) && isOpenEye(grid[7]?.[x]) && !isOpenEye(grid[5]?.[x]))
}

/** Heavy lids: the eyes' upper row turns to lid, the pupils sink a row. */
function drowsed(grid: Grid): Grid {
  const upper = [...(grid[6] ?? EMPTY_ROW)]
  const lower = [...(grid[7] ?? EMPTY_ROW)]
  for (const x of EYE_COLUMNS) {
    if (upper[x] === 'E') lower[x] = 'E'
    upper[x] = 'D'
  }
  return withRows(grid, { 6: upper.join(''), 7: lower.join('') })
}

/** The sprite's pixels laid over the grid at x, y. */
function marked(grid: Grid, { sprite, x, y }: Mark): Grid {
  return grid.map((row, i) => {
    const line = sprite[i - y]
    if (line === undefined) return row
    const pixels = [...row]
    ;[...line].forEach((pixel, j) => {
      if (pixel !== '.' && x + j < pixels.length) pixels[x + j] = pixel
    })
    return pixels.join('')
  })
}

/** Whether the sprite's whole box is empty in the grid at x, y. */
const fits = (grid: Grid, sprite: Grid, x: number, y: number) =>
  sprite.every((line, i) => [...line].every((_, j) => (grid[y + i]?.[x + j] ?? '.') === '.'))

/** The pose as a pixel grid: the frame's body, lids, breath, its marks, then the drop where it fits. */
export function gridOf(pose: Pose): Grid {
  const drawing = FRAMES[pose.frame]
  let grid = drawing.body
  if (pose.isDrowsy && canDrowse(grid)) grid = drowsed(grid)
  if (pose.isInhaling && grid[0] === EMPTY_ROW) grid = inhaled(grid)
  for (const mark of drawing.marks ?? []) grid = marked(grid, mark)
  if (pose.drop !== null && fits(grid, DROP, DROP_AT.x, DROP_AT.y + pose.drop)) {
    grid = marked(grid, { sprite: DROP, x: DROP_AT.x, y: DROP_AT.y + pose.drop })
  }
  return grid
}

export type Run = { text: string; color: Color | null; backgroundColor: Color | null }

/** The mascot in this pose as cell rows of styled runs. */
export function mascotRows(pose: Pose, theme: Theme): Run[][] {
  const palette: Readonly<Record<string, Color>> = {
    B: theme.mascot.body,
    D: theme.mascot.outline,
    L: theme.mascot.shine,
    E: theme.mascot.eyes,
    A: theme.mascot.accent,
  }
  return cellRuns(gridOf(pose), pixel => palette[pixel] ?? null)
}

/**
 * A pixel grid as cell rows of styled runs: two pixel rows share a cell
 * through the half blocks ▀ ▄ █; `colorOf` names each pixel's color, null
 * for an empty one.
 */
function cellRuns(grid: Grid, colorOf: (pixel: string) => Color | null): Run[][] {
  const colorAt = (row: number, column: number): Color | null => colorOf(grid[row]?.[column] ?? '.')

  const rows: Run[][] = []
  const width = Math.max(...grid.map(line => line.length))
  for (let row = 0; row < grid.length; row += 2) {
    const runs: Run[] = []
    for (let column = 0; column < width; column += 1) {
      const top = colorAt(row, column)
      const bottom = colorAt(row + 1, column)
      const cell: Run =
        top === null && bottom === null
          ? { text: ' ', color: null, backgroundColor: null }
          : top === null
            ? { text: '▄', color: bottom, backgroundColor: null }
            : bottom === null
              ? { text: '▀', color: top, backgroundColor: null }
              : top === bottom
                ? { text: '█', color: top, backgroundColor: null }
                : { text: '▀', color: top, backgroundColor: bottom }
      const last = runs.at(-1)
      if (last && last.color === cell.color && last.backgroundColor === cell.backgroundColor) last.text += cell.text
      else runs.push(cell)
    }
    rows.push(runs)
  }
  return rows
}

// ------------------------------------------------------------ choosing

/** The pose with nothing going on: the owl at rest, eyes open. */
export const STILL: Pose = { frame: 'idle', isInhaling: false, isDrowsy: false, drop: null }

/** One animation step: at most four frames a second. */
export const FRAME_MS = 250

/** How long a scare, a wave and the hop after an answer last, and the smile after it. */
export const STARTLE_MS = 2000
export const WAVE_MS = 2000
export const HOP_MS = 2000
export const GLAD_MS = 5000
/** After this long without a main turn the owl yawns; it falls asleep once the yawn is over. */
export const YAWN_AFTER_MS = 120_000
export const SLEEP_AFTER_MS = YAWN_AFTER_MS + 3000

/**
 * Context fill above which the owl sweats (a share of the auto-compact
 * threshold, of the window with auto-compaction off), and 5h limit left
 * below which it is tired.
 */
export const HOT_PERCENT = 80
export const TIRED_PERCENT = 20

/** Blinks fall at these offsets of an 11 s cycle (a double blink among them), one step each. */
const BLINK_CYCLE_MS = 11_000
const BLINKS_AT = [2500, 7000, 7500]
/** At rest it glances left, then right, once each in a 17 s cycle. */
const LOOK_CYCLE_MS = 17_000
const LOOKS: readonly { from: number; frame: MascotFrame }[] = [
  { from: 5000, frame: 'lookLeft' },
  { from: 12_000, frame: 'lookRight' },
]
const LOOK_MS = 1250
/** A breath in and out. */
const BREATH_MS = 4000
const SLEEP_BREATH_MS = 6000

/** Where `at` falls in a cycle of `period` ms. */
const phase = (at: number, period: number) => ((at % period) + period) % period
const since = (at: number, then: number | null) => (then === null ? Number.POSITIVE_INFINITY : at - then)
/** The step `at` falls on in a cycle of `steps` steps, `stepMs` each. */
const step = (at: number, stepMs: number, steps: number) => Math.floor(phase(at, stepMs * steps) / stepMs)

export const isBlinking = (at: number) =>
  BLINKS_AT.some(offset => phase(at, BLINK_CYCLE_MS) >= offset && phase(at, BLINK_CYCLE_MS) < offset + FRAME_MS)

const posed = (frame: MascotFrame, isInhaling = false): Pose => ({ ...STILL, frame, isInhaling })

const SCAN: readonly MascotFrame[] = ['lookLeft', 'idle', 'lookRight', 'idle']
const THOUGHT: readonly MascotFrame[] = ['think1', 'think2', 'think3']
const Z_RISING: readonly MascotFrame[] = ['sleepStill', 'sleepRising', 'sleep']

/** A question, a scare, a wave, the hop after an answer: they come before the work and the rest. */
function eventPose(scene: Scene, at: number): Pose | null {
  if (scene.isAsking) return posed(step(at, 500, 2) === 0 ? 'question' : 'questionLow')
  const startled = since(at, scene.startledAt)
  if (startled >= 0 && startled < STARTLE_MS) return posed(startled < 500 ? 'startled' : 'startledLanded')
  const waved = since(at, scene.wavedAt)
  if (waved >= 0 && waved < WAVE_MS) return posed(step(waved, FRAME_MS, 2) === 0 ? 'wave1' : 'wave2')
  if (scene.isWorking) return null
  const answered = since(at, scene.answeredAt)
  if (answered >= 0 && answered < HOP_MS) return posed(step(answered, FRAME_MS, 2) === 0 ? 'happy' : 'happyLanded')
  if (answered >= 0 && answered < GLAD_MS) return posed('happyLanded')
  return null
}

/** While the main loop works: by the running tool, thought dots between tools. */
function workPose(scene: Scene, at: number): Pose | null {
  if (!scene.isWorking) return null
  if (scene.tool === 'read') return posed(SCAN[step(at, FRAME_MS, SCAN.length)] ?? 'idle')
  if (scene.tool === 'edit') return posed(step(at, FRAME_MS, 2) === 0 ? 'write' : 'write2')
  if (scene.tool === 'shell') return posed('focus', step(at, 500, 2) === 1)
  if (scene.tool === null) return posed(THOUGHT[step(at, 500, THOUGHT.length)] ?? 'think3')
  return posed(isBlinking(at) ? 'blink' : 'idle')
}

/** At rest: breathing, blinking, glancing about; tired when the limit runs low; after a long rest a yawn, then sleep. */
function restPose(scene: Scene, at: number): Pose {
  const rested = at - scene.restingSince
  if (!scene.isBusy && rested >= SLEEP_AFTER_MS) {
    return posed(Z_RISING[step(at, 1000, Z_RISING.length)] ?? 'sleep', phase(at, SLEEP_BREATH_MS) < SLEEP_BREATH_MS / 2)
  }
  if (!scene.isBusy && rested >= YAWN_AFTER_MS) return posed('yawn')
  const isBreathingIn = phase(at, BREATH_MS) < BREATH_MS / 2
  if (scene.isTired) return posed(isBlinking(at) ? 'tiredBlink' : 'tired', isBreathingIn)
  if (isBlinking(at)) return posed('blink', isBreathingIn)
  const look = LOOKS.find(one => phase(at, LOOK_CYCLE_MS) >= one.from && phase(at, LOOK_CYCLE_MS) < one.from + LOOK_MS)
  return posed(look?.frame ?? 'idle', isBreathingIn)
}

/** The sweat drop's height at `at`: a second high, half a second lower, then half a second gone. */
function dropAt(at: number): 0 | 1 | null {
  const t = phase(at, 2000)
  return t < 1000 ? 0 : t < 1500 ? 1 : null
}

/**
 * Each frame's still form: what `ruhig` shows of the state it belongs to.
 * A state's change shows, its movement does not; the blink stays.
 */
const STILL_FRAMES: Readonly<Record<MascotFrame, MascotFrame>> = {
  idle: 'idle',
  blink: 'idle',
  lookLeft: 'idle',
  lookRight: 'idle',
  yawn: 'yawn',
  sleep: 'sleep',
  sleepRising: 'sleep',
  sleepStill: 'sleep',
  write: 'write',
  write2: 'write',
  focus: 'focus',
  wave1: 'wave1',
  wave2: 'wave1',
  think1: 'think3',
  think2: 'think3',
  think3: 'think3',
  question: 'question',
  questionLow: 'question',
  happy: 'happyLanded',
  happyLanded: 'happyLanded',
  startled: 'startledLanded',
  startledLanded: 'startledLanded',
  tired: 'tired',
  tiredBlink: 'tired',
}

/** A still frame with the blink: the owl at rest (or tired) shuts its eyes for a step. */
function calmFrame(frame: MascotFrame, at: number): MascotFrame {
  if (!isBlinking(at)) return frame
  return frame === 'idle' ? 'blink' : frame === 'tired' ? 'tiredBlink' : frame
}

/**
 * The pose for this scene at `at` under the `animations` option: voll
 * every animation, ruhig each state's still frame with the blink (no
 * breath, the drop standing still), aus the still owl.
 */
export function poseOf(scene: Scene, at: number, animations: Animations): Pose {
  if (animations === 'aus') return STILL
  const isCalm = animations === 'ruhig'
  const moving = eventPose(scene, at) ?? workPose(scene, at) ?? restPose(scene, at)
  const pose = isCalm ? posed(calmFrame(STILL_FRAMES[moving.frame], at)) : moving
  const body = FRAMES[pose.frame].body
  const isDrowsy = scene.isTired && canDrowse(body)
  const drop = scene.isHot ? (isCalm ? 0 : dropAt(at)) : null
  // A drop with no room beside this frame (a pencil, a wing, a mark) is left out.
  const placed = drop !== null && fits(gridOf({ ...pose, isDrowsy, drop: null }), DROP, DROP_AT.x, DROP_AT.y + drop)
  return { ...pose, isDrowsy, drop: placed ? drop : null }
}

export const samePose = (a: Pose, b: Pose) =>
  a.frame === b.frame && a.isInhaling === b.isInhaling && a.isDrowsy === b.isDrowsy && a.drop === b.drop

// ------------------------------------------------------------ the mini owl

// Where the pane lacks the height for Nox, a smaller one sits at the top
// right of STATUS, beside its lines: 7 × 6 pixels in a box of 8 × 3 cells,
// in the same roles, plus C for the accent. The box's left column is free:
// the owl steps into it as it walks, the sweat drop runs down it, the z of
// sleep floats in its top cell. It blinks at rest, walks while Claude works,
// turns the accent while the person is waited on, jumps at a scare, hops
// when a turn is done and sleeps after a long rest.

/** The mini owl's box: cells across and rows down. */
export const MINI_COLUMNS = 8
export const MINI_ROWS = 3

const MINI_IDLE: Grid = [
  '.DB...BD',
  '.DBBDBBD',
  '.BAEBEAB',
  '.DAADAAD',
  '..DLLLD.',
  '...A.A..',
]

/** The top of a hop: beak open, feet apart. */
const MINI_HOP: Grid = [
  '.DB...BD',
  '.DBBDBBD',
  '.BAEBEAB',
  '.DAADAAD',
  '..DLELD.',
  '..A...A.',
]

/** Eyes wide, beak open, feet drawn up. */
const MINI_STARTLED: Grid = [
  '.DB...BD',
  '.DBBDBBD',
  '.BAABAAB',
  '.BAEBEAB',
  '.DAAEAAD',
  '..DLLLD.',
]

/** Head sunk a pixel, eyes shut. */
const MINI_SLEEP: Grid = [
  '........',
  '.DB...BD',
  '.DBBDBBD',
  '.BLLDLLB',
  '..DLLLD.',
  '...A.A..',
]

/** A grid one column further left; its first column must be empty. */
const leftOf = (grid: Grid): Grid => grid.map(row => `${row.slice(1)}.`)

/** Crouched: the grid a pixel lower, its last row (the feet) under the body. */
const crouched = (grid: Grid): Grid => ['.'.repeat(grid[0]?.length ?? 0), ...grid.slice(0, -1)]

const MINI_FRAMES: Readonly<Record<MiniFrame, Grid>> = {
  idle: MINI_IDLE,
  blink: withRows(MINI_IDLE, { 2: '.BDDBDDB' }),
  walkLeft: leftOf(withRows(MINI_IDLE, { 2: '.BEABEAB' })),
  walkRight: withRows(MINI_IDLE, { 2: '.BAEBAEB' }),
  lookLeft: withRows(MINI_IDLE, { 2: '.BEABEAB' }),
  hop: MINI_HOP,
  hopLanded: crouched(MINI_HOP),
  startled: MINI_STARTLED,
  sleep: MINI_SLEEP,
  sleepRising: MINI_SLEEP,
}

/** The z of sleep, growing to a Z: a letter in the box's top left cell. */
const MINI_Z: Partial<Record<MiniFrame, string>> = { sleep: 'z', sleepRising: 'Z' }

/** The sweat drop: two pixels in the free column beside the eyes, a pixel lower as it runs. */
const MINI_DROP: Grid = ['B', 'L']
const MINI_DROP_Y = 2

/** The mini owl with nothing going on. */
export const MINI_STILL: MiniPose = { frame: 'idle', isAsking: false, drop: null }

/** The mini pose as a pixel grid: the frame, in the accent while asking, then the drop. */
export function miniGridOf(pose: MiniPose): Grid {
  const frame = MINI_FRAMES[pose.frame]
  // The drop keeps its colors: laid over after the feathers turned.
  const grid = pose.isAsking ? frame.map(row => row.replace(/B/g, 'C')) : frame
  if (pose.drop === null || !fits(grid, MINI_DROP, 0, MINI_DROP_Y + pose.drop)) return grid
  return marked(grid, { sprite: MINI_DROP, x: 0, y: MINI_DROP_Y + pose.drop })
}

/** The mini owl in this pose as cell rows of styled runs, the z of sleep among them. */
export function miniRows(pose: MiniPose, theme: Theme): Run[][] {
  const palette: Readonly<Record<string, Color>> = {
    B: theme.mascot.body,
    D: theme.mascot.outline,
    L: theme.mascot.shine,
    E: theme.mascot.eyes,
    A: theme.mascot.accent,
    C: theme.accent,
  }
  const rows = cellRuns(miniGridOf(pose), pixel => palette[pixel] ?? null)
  const z = MINI_Z[pose.frame]
  const [first, ...rest] = rows
  if (z === undefined || first === undefined) return rows
  // The top left cell is empty in a sleeping frame: its blank gives way to the letter.
  const [blank, ...after] = first
  const tail = blank !== undefined && blank.text.length > 1 ? [{ ...blank, text: blank.text.slice(1) }, ...after] : after
  return [[{ text: z, color: theme.mascot.body, backgroundColor: null }, ...tail], ...rest]
}

/** The mini owl's frame: the same order as Nox's, fewer states. */
function miniFrameOf(scene: Scene, at: number): MiniFrame {
  const resting: MiniFrame = isBlinking(at) ? 'blink' : 'idle'
  if (scene.isAsking) return resting
  const startled = since(at, scene.startledAt)
  if (startled >= 0 && startled < STARTLE_MS) return 'startled'
  if (scene.isWorking) {
    if (step(at, 500, 2) === 1) return 'walkRight'
    // A step aside fills the column the drop runs down: with sweat it only looks aside.
    return scene.isHot ? 'lookLeft' : 'walkLeft'
  }
  const answered = since(at, scene.answeredAt)
  if (answered >= 0 && answered < HOP_MS) return step(answered, FRAME_MS, 2) === 0 ? 'hop' : 'hopLanded'
  if (!scene.isBusy && at - scene.restingSince >= SLEEP_AFTER_MS) return step(at, 1000, 2) === 0 ? 'sleep' : 'sleepRising'
  return resting
}

/** Each mini frame's still form, as `ruhig` shows it. */
const MINI_STILL_FRAMES: Readonly<Record<MiniFrame, MiniFrame>> = {
  idle: 'idle',
  blink: 'idle',
  walkLeft: 'idle',
  walkRight: 'idle',
  lookLeft: 'idle',
  hop: 'hopLanded',
  hopLanded: 'hopLanded',
  startled: 'startled',
  sleep: 'sleep',
  sleepRising: 'sleep',
}

/**
 * The mini pose for this scene at `at` under the `animations` option, by
 * Nox's rules: ruhig each state's still frame with the blink, aus stands
 * still. The drop runs while the owl is hot (Scene's isHot), whatever it
 * does (standing still under ruhig), and stands beside a scare.
 */
export function miniPoseOf(scene: Scene, at: number, animations: Animations): MiniPose {
  if (animations === 'aus') return MINI_STILL
  const isCalm = animations === 'ruhig'
  const moving = miniFrameOf(scene, at)
  const still = MINI_STILL_FRAMES[moving]
  const frame: MiniFrame = isCalm ? (still === 'idle' && isBlinking(at) ? 'blink' : still) : moving
  const drop = scene.isHot ? (isCalm ? 0 : dropAt(at)) : frame === 'startled' ? 0 : null
  return { frame, isAsking: scene.isAsking, drop }
}

export const sameMiniPose = (a: MiniPose, b: MiniPose) => a.frame === b.frame && a.isAsking === b.isAsking && a.drop === b.drop

/**
 * What a main-loop tool call has the mascot do, by the built-in tools this
 * build has (it has no Grep or Glob: searches run through Bash).
 */
const KINDS: Readonly<Record<string, ToolKind>> = {
  Read: 'read',
  WebFetch: 'read',
  WebSearch: 'read',
  Edit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'shell',
  AskUserQuestion: 'ask',
  ExitPlanMode: 'approve',
}

export const toolKindOf = (tool: string): ToolKind => KINDS[tool] ?? 'other'

/** The scene the session's state makes at `at`. */
export function sceneOf(
  activity: Activity,
  cues: Cues,
  agents: readonly AgentRow[],
  context: ContextSnapshot | null,
  fiveHour: RateWindow | null,
  at: number,
  radar: Radar = NO_RADAR,
): Scene {
  const fill = context === null ? null : thresholdPercent(context)
  const left = limitLeft(fiveHour, at)
  return {
    isWorking: activity.isWorking,
    isBusy: agents.some(isAgentLive),
    tool: cues.running.at(-1)?.kind ?? null,
    isAsking: waitingFor(activity, cues) !== null,
    startledAt: cues.startledAt,
    wavedAt: cues.wavedAt,
    answeredAt: activity.answeredAt,
    restingSince: cues.restingSince,
    isHot: fill !== null && fill > HOT_PERCENT,
    isTired: left !== null && left < TIRED_PERCENT,
    isLooping: loopOf(radar) !== null,
  }
}

/** What the person is waited on for: a permission or a plan to approve, a question to answer. */
export type Waiting = 'approval' | 'question'

/**
 * What the session waits on the person for: an open permission dialog (an
 * approval, or a question when it asks AskUserQuestion's), else a main-loop
 * call that waits on their answer; null for nothing.
 */
export function waitingFor(activity: Activity, cues: Cues): Waiting | null {
  if (cues.asking.some(ask => ask.tool !== 'AskUserQuestion')) return 'approval'
  if (cues.asking.length > 0) return 'question'
  if (!activity.isWorking) return null
  if (cues.running.some(call => call.kind === 'approve')) return 'approval'
  if (cues.running.some(call => call.kind === 'ask')) return 'question'
  return null
}

/**
 * The caption's state under the mascot: `ready` and `agents` while the main
 * loop waits for a prompt, `approval` and `question` while it waits on the
 * person.
 */
export type Mood = 'working' | 'agents' | 'ready' | 'approval' | 'question' | 'error' | 'done'
