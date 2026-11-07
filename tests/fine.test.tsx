import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { FRAME_MS, STARTLE_MS, WAVE_MS, YAWN_AFTER_MS } from '../hooks/mascot'
import type { Animations, Scene } from '../hooks/mascot'
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
import { NOX_SPRITES } from '../hooks/sprites'
import type { FinePose, NoxCostume, NoxState } from '../types'
import {
  SURFACES,
  test,
  PANE,
  K,
  engine,
  start,
  TODOS,
  captionOf,
  TWO_LINES,
  TALL,
  SHORT,
  poseIn,
  owlOf,
  posesOver,
  framesIn,
  READ_RESULT,
  failedRun,
} from './helpers'
import type { World, Found, Size } from './helpers'

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
    const clock = engine(on, { ...PICTURES, ...TWO_LINES })
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
        return e.tool === 'Bash' ? failedRun(outer, e) : READ_RESULT
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
    on('tool.call', (_, e) => failedRun($, e))
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
