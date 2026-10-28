import type { FinePose, NoxCostume, NoxState } from '../types'
import { WAVE_MS, YAWN_AFTER_MS } from './mascot'
import type { Animations, Scene } from './mascot'
import { NOX_SPRITES } from './sprites'
import type { PaletteName, Sequence } from './sprites'

// The fine Nox (the `fein` style): the sprites of hooks/sprites.ts, picked,
// timed and colored here, in memory: no file, no network. Nox wears one of
// five costumes (`noxCostume`; `ohne`, Nox as it is, unless set), each with
// its own fourteen states and its own times. The scene picks one of the
// fourteen states, each an animation of its own for Nox and for the mini
// owl; the state's frames and times come from the costume's sprites, laid on
// a grid of steps of a sixth of a second, so a picture changes at most six
// times a second and holds at least one step. A state that runs while
// something lasts (rest, work, a question) loops on the clock; one that
// answers an event (the yawn, the turn done, a failure, the loop warning)
// runs once from that moment, and the wave loops for its two seconds.
// While the context is hot the sweat drop of the costume's `schweiss` frames
// is laid over whatever shows, where the frame there looks as the resting
// picture the drop was drawn on; a costume whose drop sits on none of its
// resting pictures has no drop to lay over, and shows its own `schweiss`.

/** One step: at most six pictures a second. */
export const FINE_FRAME_MS = 167

/** The two owls: Nox (`big`) and the mini owl where the pane is short (`mini`), as the sprites name their sizes. */
export type Owl = 'big' | 'mini'

/**
 * Nox's size in pixels and the cells its picture takes, the mini owl's
 * likewise: a cell is about twice as tall as it is wide, so either box is
 * square and so are its pixels.
 */
export const NOX_PIXELS = 32
export const NOX_COLUMNS = 16
export const NOX_ROWS = 8
export const MINI_PIXELS = 16
export const MINI_FINE_COLUMNS = 6
export const MINI_FINE_ROWS = 3

/** The fourteen states, in the sprites' order. */
export const NOX_STATES: readonly NoxState[] = [
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
]

/** The states that answer an event: each runs once from its moment, then the scene goes on. */
const ONCE: ReadonlySet<NoxState> = new Set(['gaehnen', 'fertig', 'fehler', 'loop-warnung'])

/** The tool kinds' states while the main loop works; any other tool (an agent, TodoWrite, a skill, an MCP tool), or none, is denken. */
const WORK: Readonly<Record<string, NoxState>> = { read: 'lesen', edit: 'schreiben', shell: 'shell' }

type Grid = readonly string[]

// ------------------------------------------------------------ the costumes

/** The costumes, in the sprites' order: `ohne` is Nox as it is. */
export const COSTUMES: readonly NoxCostume[] = ['ohne', 'zauberer', 'astronaut', 'detektiv', 'hacker']

/** What `zufall` draws from: every costume but `ohne`. */
export const DRAWN_COSTUMES: readonly NoxCostume[] = ['zauberer', 'astronaut', 'detektiv', 'hacker']

/** The `noxCostume` option: a costume, or `zufall`, one of the four drawn at each session's start. */
export type CostumeOption = NoxCostume | 'zufall'

/** The `noxCostume` option as set; anything else (unset, misspelt, not a string) is `ohne`. */
export function costumeOptionOf(value: unknown): CostumeOption {
  if (value === 'zufall') return 'zufall'
  return COSTUMES.find(costume => costume === value) ?? 'ohne'
}

/** Whether a kept value is a costume `zufall` draws. */
export const isDrawnCostume = (value: unknown): value is NoxCostume => DRAWN_COSTUMES.some(costume => costume === value)

/**
 * The costume `zufall` draws at `at`, the session start's clock in ms: one of
 * the four, by the moment's milliseconds mixed through an integer hash, so
 * the pick follows no single digit of the clock. Nothing but the clock is
 * asked.
 */
export function costumeDrawnAt(at: number): NoxCostume {
  const ms = Math.floor(Math.abs(at))
  let mixed = (ms % 0x1_0000_0000) ^ Math.floor(ms / 0x1_0000_0000)
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d)
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b)
  mixed ^= mixed >>> 16
  return DRAWN_COSTUMES[(mixed >>> 0) % DRAWN_COSTUMES.length] ?? 'zauberer'
}

// ------------------------------------------------------------ timing

/**
 * A state's frames on the step grid: the frame of each step, in order. Each
 * frame ends at the step nearest the sum of the times before it, and takes
 * at least one step: a frame shorter than a step would show for one, and
 * the frames after it give the time back, so the whole run keeps its length
 * to half a step.
 */
export function stepsOf(sequence: Sequence): number[] {
  const steps: number[] = []
  let ms = 0
  for (const [frame, held] of sequence) {
    ms += held
    const count = Math.max(1, Math.round(ms / FINE_FRAME_MS) - steps.length)
    for (let i = 0; i < count; i += 1) steps.push(frame)
  }
  return steps
}

const pupilsOf = (grid: Grid) => grid.reduce((sum, row) => sum + [...row].filter(pixel => pixel === 'K').length, 0)

/** A run's frames by how long it holds each in all, longest first; the first of equals first. */
function byHold(sequence: Sequence, leaving: ReadonlySet<number> = new Set()): number[] {
  const held = new Map<number, number>()
  for (const [frame, ms] of sequence) if (!leaving.has(frame)) held.set(frame, (held.get(frame) ?? 0) + ms)
  return [...held].sort((a, b) => b[1] - a[1]).map(([frame]) => frame)
}

/**
 * The frame a state shows standing still (under `ruhig`): the one it holds
 * longest, the first of equals. A state other than ruhe never stands on a
 * frame ruhe rests or breathes in (`resting`), which would tell nothing of
 * it: ruhe's still frame, and a second pose where a costume breathes a
 * pixel apart (the astronaut). Ruhe's blink it may: a sleeping owl's eyes
 * are shut.
 */
function stillOf(sequence: Sequence, resting: ReadonlySet<number> = new Set()): number {
  return byHold(sequence, resting)[0] ?? sequence[0]?.[0] ?? 0
}

/**
 * A state's blinks: frames with its still frame's outline, fewer pupils,
 * and nothing changed below the eyes (a row under them at most). The eyes
 * end at the still frame's last row of iris, and only pupils down to there
 * count: a costume's screen below them (the hacker's laptop, a shell's
 * terminal), dark as a pupil, is no eye. The rest of a state's movement (a
 * glance, a breath, a yawn, a screen's text) is not a blink.
 */
function blinksOf(frames: readonly Grid[], sequence: Sequence, still: number): Set<number> {
  const base = frames[still] ?? []
  const eyesEnd = base.reduce((last, row, y) => (/Y/.test(row) ? y : last), -1)
  const eyePupils = (grid: Grid) => pupilsOf(grid.slice(0, eyesEnd + 2))
  const blinks = new Set<number>()
  for (const [frame] of sequence) {
    const grid = frames[frame] ?? []
    if (frame === still || eyePupils(grid) >= eyePupils(base)) continue
    const isBlink = base.every((row, y) =>
      [...row].every((pixel, x) => {
        const other = grid[y]?.[x] ?? '.'
        if ((pixel === '.') !== (other === '.')) return false
        return y <= eyesEnd + 1 || pixel === other
      }),
    )
    if (isBlink) blinks.add(frame)
  }
  return blinks
}

type Animation = {
  /** Every frame, a step at a time (`voll`). */
  lively: readonly number[]
  /** The still frame, with the blinks where they fall (`ruhig`). */
  calm: readonly number[]
  still: number
  blinks: ReadonlySet<number>
}

// ------------------------------------------------------------ the drop

type Pixel = readonly [x: number, y: number]

/**
 * Whether `grid` looks as `rest` on and around `pixels` (each pixel and its
 * eight neighbours), the pixels named in `skipping` left out.
 */
function looksAs(grid: Grid, rest: Grid, pixels: readonly Pixel[], skipping: ReadonlySet<string> = new Set()): boolean {
  return pixels.every(([x, y]) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (skipping.has(`${x + dx},${y + dy}`)) continue
        if ((grid[y + dy]?.[x + dx] ?? '.') !== (rest[y + dy]?.[x + dx] ?? '.')) return false
      }
    }
    return true
  })
}

/**
 * The drop's pixels in each `schweiss` frame that has one, by that frame:
 * the sweat drop's color where no frame of ruhe has it (a costume's own
 * light blue, the astronaut's badge, is no sweat).
 */
function dropsOf(frames: readonly Grid[], states: Readonly<Record<NoxState, Sequence>>): Map<number, Pixel[]> {
  const worn = new Set<string>()
  for (const [frame] of states.ruhe) {
    for (const [y, row] of (frames[frame] ?? []).entries()) {
      for (const [x, pixel] of [...row].entries()) if (pixel === 'B') worn.add(`${x},${y}`)
    }
  }
  const drops = new Map<number, Pixel[]>()
  for (const [frame] of states.schweiss) {
    const pixels = (frames[frame] ?? []).flatMap((row, y) =>
      [...row].flatMap((pixel, x): Pixel[] => (pixel === 'B' && !worn.has(`${x},${y}`) ? [[x, y]] : [])),
    )
    if (pixels.length > 0) drops.set(frame, pixels)
  }
  return drops
}

/**
 * The resting picture the drop was drawn on, which a frame must look as
 * under the drop for it to be laid there: ruhe's still frame, else the frame
 * of ruhe held longest that the first frame with a drop looks as around it
 * (a costume breathing in two poses may sweat in the other). null where
 * none: the drop does not suit the costume and is never laid over.
 */
function dropRestOf(frames: readonly Grid[], ruhe: Sequence, restStill: number, drops: ReadonlyMap<number, readonly Pixel[]>): number | null {
  const first = drops.entries().next()
  if (first.done === true) return null
  const [frame, pixels] = first.value
  const drop = new Set(pixels.map(([x, y]) => `${x},${y}`))
  return [restStill, ...byHold(ruhe)].find(rest => looksAs(frames[frame] ?? [], frames[rest] ?? [], pixels, drop)) ?? null
}

// ------------------------------------------------------------ an owl in a costume

/** An owl in one costume: its frames (its size's), its states, and what is worked out from them once. */
export type Look = {
  costume: NoxCostume
  frames: readonly Grid[]
  states: Readonly<Record<NoxState, Sequence>>
  animations: Readonly<Record<NoxState, Animation>>
  /** The drop's pixels in each `schweiss` frame that has one, by that frame. */
  drops: ReadonlyMap<number, readonly Pixel[]>
  /** The resting picture the drop was drawn on (see dropRestOf); null: no drop is laid over. */
  dropRest: number | null
  /** At rest with nothing going on: ruhe's first frame; what `aus` shows. */
  still: FinePose
}

/** Works out an owl's look in a costume from its frames and its states. */
export function lookOf(costume: NoxCostume, frames: readonly Grid[], states: Readonly<Record<NoxState, Sequence>>): Look {
  // ruhe stands on the frame it holds longest that has a blink, so under
  // ruhig the blink stays (the astronaut breathes in two poses a pixel
  // apart and blinks in its lower one); else on the one it holds longest.
  const restStill = byHold(states.ruhe).find(frame => blinksOf(frames, states.ruhe, frame).size > 0) ?? stillOf(states.ruhe)
  const restBlinks = blinksOf(frames, states.ruhe, restStill)
  const resting = new Set(states.ruhe.map(([frame]) => frame).filter(frame => !restBlinks.has(frame)))
  const animations = {} as Record<NoxState, Animation>
  for (const state of NOX_STATES) {
    const sequence = states[state]
    const still = state === 'ruhe' ? restStill : stillOf(sequence, resting)
    const blinks = blinksOf(frames, sequence, still)
    const lively = stepsOf(sequence)
    animations[state] = { lively, calm: lively.map(frame => (blinks.has(frame) ? frame : still)), still, blinks }
  }
  const drops = dropsOf(frames, states)
  const still: FinePose = { costume, state: 'ruhe', frame: states.ruhe[0]?.[0] ?? 0, drop: null }
  return { costume, frames, states, animations, drops, dropRest: dropRestOf(frames, states.ruhe, restStill, drops), still }
}

function looksOf(owl: Owl): Readonly<Record<NoxCostume, Look>> {
  const { frames, costumes } = NOX_SPRITES.sizes[owl]
  const looks = {} as Record<NoxCostume, Look>
  for (const costume of COSTUMES) looks[costume] = lookOf(costume, frames, costumes[costume].states)
  return looks
}

const LOOKS: Readonly<Record<Owl, Readonly<Record<NoxCostume, Look>>>> = { big: looksOf('big'), mini: looksOf('mini') }

/** An owl's look in a costume. */
export const lookFor = (owl: Owl, costume: NoxCostume): Look => LOOKS[owl][costume]

/** A state's animation for an owl in a costume: its frames a step at a time, its still frame and its blinks. */
export const animationOf = (owl: Owl, costume: NoxCostume, state: NoxState): Animation => LOOKS[owl][costume].animations[state]

/** An owl in a costume with nothing going on: ruhe's first frame; what `aus` shows. */
export const fineStillOf = (owl: Owl, costume: NoxCostume): FinePose => LOOKS[owl][costume].still

/** How long a state's animation runs once, in ms. */
const lengthOf = (look: Look, state: NoxState) => look.animations[state].lively.length * FINE_FRAME_MS

const dropFit = new WeakMap<Look, Map<string, boolean>>()

/**
 * Whether the drop of `schweiss` frame `drop` has room on `frame`: the frame
 * looks as the resting picture the drop was drawn on, under the drop and a
 * pixel around it. A raised wing, a mark or a head that moved leaves none.
 */
export function fitsIn(look: Look, frame: number, drop: number): boolean {
  let known = dropFit.get(look)
  if (known === undefined) {
    known = new Map<string, boolean>()
    dropFit.set(look, known)
  }
  const key = `${frame}:${drop}`
  const kept = known.get(key)
  if (kept !== undefined) return kept
  const pixels = look.drops.get(drop)
  const fits = look.dropRest !== null && pixels !== undefined && looksAs(look.frames[frame] ?? [], look.frames[look.dropRest] ?? [], pixels)
  known.set(key, fits)
  return fits
}

/** Whether the drop of `drop` has room on `frame` for an owl in a costume. */
export const dropFits = (owl: Owl, costume: NoxCostume, frame: number, drop: number): boolean => fitsIn(LOOKS[owl][costume], frame, drop)

/**
 * The drop that stands under `ruhig` while `state` shows: the first of
 * schweiss's (its still frame, then its run) with room on the state's still
 * frame and on each of its blinks, so it stands through a blink; else the
 * first with room on the still frame. null where none has room there.
 */
function calmDropOf(look: Look, state: NoxState): number | null {
  const run = look.animations.schweiss
  const { still, blinks } = look.animations[state]
  const order = [run.still, ...run.lively].filter(one => look.drops.has(one))
  return order.find(one => [still, ...blinks].every(frame => fitsIn(look, frame, one))) ?? order.find(one => fitsIn(look, still, one)) ?? null
}

/**
 * The drop laid over `frame` of `state` at `at`: under `voll` the one the
 * `schweiss` run shows on the clock, under `ruhig` the state's standing one;
 * either only where it has room. null where it has none.
 */
function dropOver(look: Look, state: NoxState, frame: number, at: number, isCalm: boolean): number | null {
  const run = look.animations.schweiss
  const shown = isCalm ? calmDropOf(look, state) : (run.lively[step(at, run.lively.length)] ?? run.still)
  return shown !== null && look.drops.has(shown) && fitsIn(look, frame, shown) ? shown : null
}

/** Whether a drop stands on ruhe under `ruhig`: else a hot owl at rest shows its own `schweiss`. */
const restsWithDrop = (look: Look) => calmDropOf(look, 'ruhe') !== null

// ------------------------------------------------------------ what Nox does when

/** The start of the step `at` falls in: a pose is read at step starts only, so it holds a whole step whatever the tick's rhythm. */
const stepOf = (at: number) => Math.floor(at / FINE_FRAME_MS) * FINE_FRAME_MS
/** The step a looping run of `steps` steps is on at `at`, on the clock. */
const step = (at: number, steps: number) => ((Math.floor(at / FINE_FRAME_MS) % steps) + steps) % steps
const since = (at: number, then: number | null) => (then === null ? Number.POSITIVE_INFINITY : at - then)

/** What the scene shows at `at`, and since when a state that answers an event runs (null: on the clock). */
type Shown = { state: NoxState; from: number | null }

/**
 * The state for this scene at `at`: a question first, then a failure (the
 * loop warning where RADAR warns of a loop), a wave, the work by its tool
 * (thinking between tools and while any other runs), the turn done, the yawn and sleep after a long
 * rest, tired, hot, at rest. Under `ruhig` a hot owl at rest is ruhe with
 * the drop standing, so the blink stays; where the costume's drop has no
 * room there, its own `schweiss`.
 */
function shownOf(look: Look, scene: Scene, at: number, isCalm: boolean): Shown {
  if (scene.isAsking) return { state: 'wartet-auf-dich', from: null }
  const fright: NoxState = scene.isLooping ? 'loop-warnung' : 'fehler'
  const startled = since(at, scene.startledAt)
  if (startled >= 0 && startled < lengthOf(look, fright)) return { state: fright, from: scene.startledAt }
  const waved = since(at, scene.wavedAt)
  if (waved >= 0 && waved < WAVE_MS) return { state: 'winken', from: scene.wavedAt }
  if (scene.isWorking) return { state: WORK[scene.tool ?? ''] ?? 'denken', from: null }
  const answered = since(at, scene.answeredAt)
  if (answered >= 0 && answered < lengthOf(look, 'fertig')) return { state: 'fertig', from: scene.answeredAt }
  if (!scene.isBusy) {
    const yawnAt = scene.restingSince + YAWN_AFTER_MS
    if (at >= yawnAt + lengthOf(look, 'gaehnen')) return { state: 'schlaf', from: null }
    if (at >= yawnAt) return { state: 'gaehnen', from: yawnAt }
  }
  if (scene.isTired) return { state: 'muede', from: null }
  if (scene.isHot && (!isCalm || !restsWithDrop(look))) return { state: 'schweiss', from: null }
  return { state: 'ruhe', from: null }
}

/**
 * A look's pose for this scene at `moment` under the `animations` option:
 * voll every frame of the state, ruhig its still frame and its blinks (the
 * drop standing), aus ruhe's first frame whatever goes on.
 */
export function poseIn(look: Look, scene: Scene, moment: number, animations: Animations): FinePose {
  if (animations === 'aus') return look.still
  const at = stepOf(moment)
  const isCalm = animations === 'ruhig'
  const { state, from } = shownOf(look, scene, at, isCalm)
  const animation = look.animations[state]
  const steps = isCalm ? animation.calm : animation.lively
  // On the clock, or from the event: a run that answers one stops on its last frame.
  const elapsed = Math.floor((at - (from ?? 0)) / FINE_FRAME_MS)
  const index = ONCE.has(state) ? Math.min(elapsed, steps.length - 1) : ((elapsed % steps.length) + steps.length) % steps.length
  const frame = steps[index] ?? animation.still
  const drop = scene.isHot && state !== 'schweiss' ? dropOver(look, state, frame, at, isCalm) : null
  return { costume: look.costume, state, frame, drop }
}

/** An owl's pose in a costume for this scene at `moment`. */
export const owlPoseOf = (owl: Owl, costume: NoxCostume, scene: Scene, moment: number, animations: Animations) =>
  poseIn(LOOKS[owl][costume], scene, moment, animations)

export const finePoseOf = (costume: NoxCostume, scene: Scene, moment: number, animations: Animations) => owlPoseOf('big', costume, scene, moment, animations)
export const fineMiniPoseOf = (costume: NoxCostume, scene: Scene, moment: number, animations: Animations) =>
  owlPoseOf('mini', costume, scene, moment, animations)

// ------------------------------------------------------------ pixels

export type Rgb = readonly [number, number, number]

export type Palette = {
  name: PaletteName
  /** Each character's color; '.' has none. */
  colors: Readonly<Record<string, Rgb>>
}

const rgbOf = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

const paletteNamed = (name: PaletteName): Palette => ({
  name,
  colors: Object.fromEntries(Object.entries(NOX_SPRITES.palettes[name]).map(([pixel, hex]) => [pixel, rgbOf(hex)])),
})

/** The sprites' palettes (`noxPalette`): standard, nacht, retro. */
export const PALETTES: Readonly<Record<PaletteName, Palette>> = {
  standard: paletteNamed('standard'),
  nacht: paletteNamed('nacht'),
  retro: paletteNamed('retro'),
}

export function paletteOf(name: unknown): Palette {
  return name === 'nacht' || name === 'retro' ? PALETTES[name] : PALETTES.standard
}

/** The pose as a grid: its frame, with its costume's drop pixels laid over. */
export function gridOf(owl: Owl, pose: FinePose): Grid {
  const { frames, drops } = LOOKS[owl][pose.costume]
  const grid = frames[pose.frame] ?? frames[0] ?? []
  if (pose.drop === null) return grid
  const rows = grid.map(row => [...row])
  for (const [x, y] of drops.get(pose.drop) ?? []) {
    const row = rows[y]
    if (row !== undefined && x < row.length) row[x] = 'B'
  }
  return rows.map(row => row.join(''))
}

/** How many screen pixels each sprite pixel is sent as, across and down: whole blocks, so it stays square and crisp. */
export const SCALE = 2

/**
 * A grid as RGBA bytes, `SCALE` times its size: four bytes a pixel, row by
 * row, each in its palette color as it is, transparent where it is '.'.
 */
export function rgbaOf(grid: Grid, palette: Palette): { bytes: Uint8Array; width: number; height: number } {
  const size = grid.length
  const width = size * SCALE
  const height = size * SCALE
  const bytes = new Uint8Array(width * height * 4)
  for (let y = 0; y < size; y += 1) {
    const line = grid[y] ?? ''
    for (let x = 0; x < size; x += 1) {
      const color = palette.colors[line[x] ?? '.']
      if (color === undefined) continue
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const at = ((y * SCALE + dy) * width + x * SCALE + dx) * 4
          bytes[at] = color[0]
          bytes[at + 1] = color[1]
          bytes[at + 2] = color[2]
          bytes[at + 3] = 255
        }
      }
    }
  }
  return { bytes, width, height }
}

// ------------------------------------------------------------ the cache

/** Bytes as base64, by the runtime's `Uint8Array#toBase64` (the one the Image docs use; TypeScript's es2023 lib does not name it). */
const base64Of = (bytes: Uint8Array): string => (bytes as Uint8Array & { toBase64: () => string }).toBase64()

/**
 * Every picture made, by owl, palette, costume, frame and drop: made once,
 * then only looked up. Two that look alike share one picture, so the same
 * object is the same image and a blit is only ever a change.
 */
const pictures = new Map<string, Picture>()
const picturesByContent = new Map<string, Picture>()
let made = 0

type Picture = { rgba: string; width: number; height: number }

export const poseKey = (pose: FinePose): string => (pose.drop === null ? `${pose.frame}` : `${pose.frame}+drop${pose.drop}`)

function pictureOf(owl: Owl, pose: FinePose, palette: Palette): Picture {
  const key = `${owl}:${palette.name}:${pose.costume}:${poseKey(pose)}`
  const kept = pictures.get(key)
  if (kept !== undefined) return kept
  const { bytes, width, height } = rgbaOf(gridOf(owl, pose), palette)
  const rgba = base64Of(bytes)
  made += 1
  const picture = picturesByContent.get(rgba) ?? { rgba, width, height }
  picturesByContent.set(rgba, picture)
  pictures.set(key, picture)
  return picture
}

/** Nox's picture in this pose: an `Image` source of RGBA bytes, kept once made. */
export const noxSource = (pose: FinePose, palette: Palette) => pictureOf('big', pose, palette)

/** The mini owl's picture in this pose, kept once made. */
export const miniSource = (pose: FinePose, palette: Palette) => pictureOf('mini', pose, palette)

/** What the cache holds: how many distinct pictures, their base64 characters, and how many were ever made. */
export function cacheStats(): { pictures: number; bytes: number; made: number } {
  let bytes = 0
  for (const picture of picturesByContent.values()) bytes += picture.rgba.length
  return { pictures: picturesByContent.size, bytes, made }
}

/**
 * The probe: one transparent pixel in one cell. A blit of it tells whether
 * the terminal draws pictures, and it shows nothing either way.
 */
export const PROBE_SOURCE = { rgba: base64Of(new Uint8Array(4)), width: 1, height: 1 }
