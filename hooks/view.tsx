import type { Color, Elements, ImageSource, RenderChildren, RenderElement } from 'claude-code'

import type {
  Activity,
  AgentBoard,
  AgentFolds,
  AgentLedger,
  AgentRow,
  AgentRun,
  AgentWork,
  CallLabel,
  ContextSnapshot,
  Cues,
  EndCounts,
  FailStreak,
  FileChange,
  MiniPose,
  PlanStep,
  Pose,
  Radar,
  RateWindow,
  RunPast,
  Tab,
  UsageTrack,
} from '../types'
import { MINI_FINE_COLUMNS, MINI_FINE_ROWS, NOX_COLUMNS, NOX_ROWS } from './fine'
import { HOP_MS, mascotRows, MINI_COLUMNS, MINI_ROWS, miniRows } from './mascot'
import type { Mood, Run, Waiting } from './mascot'
import {
  agentCounts,
  agentElapsed,
  agentStatus,
  barCells,
  baseName,
  brailleRows,
  cellsFull,
  commonType,
  DONE_FOLD,
  duration,
  earliest,
  flowParts,
  formatTokens,
  freshOf,
  groupsOf,
  growthOf,
  isAgentLive,
  isGroupOpen,
  isEndedStatus,
  latest,
  legendLine,
  legendLines,
  limitLeft,
  LIVE_FOLD,
  modelShort,
  NO_FOLDS,
  NO_TALLY,
  orderedPlan,
  potsOf,
  prefixOf,
  processedOf,
  projectPath,
  RUN_FOLD,
  share,
  wholeTally,
} from './model'
import type { AgentGroup, FoldView, LegendItem } from './model'
import { hotspotsOf, loopOf, repeatedOf, resetClockOf, resetDayOf, waitedOf } from './radar'
import { maskSecrets } from './secrets'
import type { AgentTally, Strings } from './strings'
import type { SourceKey, Theme } from './themes'

type Table = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
type ImageElement = Elements['terminal']['Image']

/**
 * What every card draws with: the surface's elements (`Image` on the
 * terminal alone, null elsewhere), the theme, the texts, and the card's width.
 */
export type Ui = Table & { Image: ImageElement | null; surface: string; theme: Theme; s: Strings; width: number }

/** The surface's elements, every Text in the monospaced face so columns line up off the terminal too. */
export function uiOf(table: Table, surface: string, theme: Theme, s: Strings, width: number, image: ImageElement | null = null): Ui {
  const Text: Table['Text'] = props => table.Text({ mono: true, ...props })
  return { Box: table.Box, Text, Button: table.Button, Image: image, surface, theme, s, width }
}

const styled = (color: Color | null, backgroundColor: Color | null) => ({
  ...(color === null ? {} : { color }),
  ...(backgroundColor === null ? {} : { backgroundColor }),
})

/** Pane frame (2) and padding (2) around the cards. */
export const PANE_INSET = 4
/** A card's frame (2) and padding (2) around its rows. */
const CARD_INSET = 4

const inner = (ui: Ui) => Math.max(8, ui.width - CARD_INSET)

const tokens = (ui: Ui, n: number) => formatTokens(n, ui.s.decimal)

/** A drawn card and how many rows it takes, so the pane can tell what fits its height. */
export type Drawn = { element: RenderElement; rows: number }

/** Rows a card's frame takes around its body: the border lines, and the title row off the terminal. */
const cardFrameRows = (ui: Ui) => 2 + (ui.surface === 'terminal' ? 0 : 1)

/** Rows the pane's frame takes around the cards: its border lines, the tabs and the empty line under them. */
export function frameRows(ui: Ui): number {
  const tabsWidth = [ui.s.tabs.changes, ui.s.tabs.agents, ui.s.tabs.live].reduce((sum, label) => sum + label.length + 3, -1)
  const tabRows = tabsWidth <= ui.width ? 1 : 2
  return 2 + (ui.surface === 'terminal' ? 0 : 1) + tabRows + 1
}

/**
 * Rows a text takes when wrapped at word boundaries in `width` cells, as the
 * renderer wraps it (a word longer than the row breaks where it must); never
 * fewer than drawn, so a card's height is counted whole.
 */
export function wrappedRows(text: string, width: number): number {
  const room = Math.max(1, width)
  let rows = 1
  let used = 0
  for (const word of text.split(' ')) {
    let size = [...word].length
    if (used > 0 && used + 1 + size <= room) {
      used += 1 + size
      continue
    }
    if (used > 0) {
      rows += 1
      used = 0
    }
    while (size > room) {
      rows += 1
      size -= room
    }
    used = size
  }
  return rows
}

// ---------------------------------------------------------------- frames

const tabsOf = (s: Strings): readonly { id: Tab; label: string }[] => [
  { id: 'changes', label: s.tabs.changes },
  { id: 'agents', label: s.tabs.agents },
  { id: 'live', label: s.tabs.live },
]

/** A tab, pressed to show it: on the accent while it shows. */
function tabButton(ui: Ui, one: { id: Tab; label: string }, tab: Tab, onTab: (tab: Tab) => void): RenderElement {
  const { Button, Text, theme } = ui
  return (
    <Button key={`tab-${one.id}`} label={one.label} plain onPress={() => onTab(one.id)}>
      {one.id === tab ? (
        <Text bold color={theme.onAccent} backgroundColor={theme.accent}>{` ${one.label} `}</Text>
      ) : (
        <Text dimColor>{` ${one.label} `}</Text>
      )}
    </Button>
  )
}

/**
 * The whole pane: a rounded frame with `noxdeck` in its top line, the tabs,
 * an empty line, then the cards stacked border to border. `ui.width` is the
 * cards' width. A probe (`probe`), where given, sits in the empty line's
 * first cell: a picture of one transparent pixel, its alt a blank, so the
 * line looks empty whether or not the terminal draws pictures.
 */
export function frame(ui: Ui, tab: Tab, onTab: (tab: Tab) => void, body: RenderChildren, probe: ImageSource | null = null): RenderElement {
  const { Box, Text, theme, s } = ui
  const width = ui.width + PANE_INSET
  const isTerminal = ui.surface === 'terminal'
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="column" borderStyle="round" borderColor={theme.frame} paddingX={1} width={width}>
        {isTerminal ? null : (
          <Text bold color={theme.accent}>
            noxdeck
          </Text>
        )}
        <Box flexWrap="wrap" columnGap={1}>
          {tabsOf(s).map(one => tabButton(ui, one, tab, onTab))}
        </Box>
        {probe !== null && ui.Image !== null ? (
          <Box height={1}>
            <ui.Image key="probe" source={probe} columns={1} rows={1} alt=" " />
          </Box>
        ) : null}
        <Box flexDirection="column" marginTop={probe !== null && ui.Image !== null ? 0 : 1}>
          {body}
        </Box>
      </Box>
      {isTerminal ? (
        <Box position="absolute" top={0} left={2}>
          <Text bold color={theme.accent}>
            {' noxdeck '}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * A rounded card with no inner spacing. On the terminal its title and
 * counter sit in the top border, boxes placed absolutely over that row and
 * drawn after the bordered box. A counter that would not fit beside the
 * title there (or in the heading row elsewhere) moves into the body,
 * right-aligned, broken only between its parts.
 */
/** Whether a card's counter fits beside its title (in the border on the terminal). */
function isCounterBesideOf(ui: Ui, title: string, counter: readonly string[] | null): boolean {
  const joined = counter === null ? null : counter.join(' · ')
  return joined !== null && (ui.surface === 'terminal' ? title.length + joined.length + 10 <= ui.width : title.length + 1 + joined.length <= inner(ui))
}

/** Rows a card takes besides its body: its frame, and a counter moved into the body. */
function cardOverhead(ui: Ui, title: string, counter: readonly string[] | null): number {
  const moved = counter !== null && !isCounterBesideOf(ui, title, counter) ? flowParts(counter, inner(ui)).length : 0
  return cardFrameRows(ui) + moved
}

/** Words after a card's title, beside it in the border on the terminal: the state STATUS names beside the mini owl. */
type TitleNote = { text: string; color: Color | null }

/** Cells a card's title may take with what follows it: in the border, a dash kept before the corner; else the heading row. */
const titleRoom = (ui: Ui) => (ui.surface === 'terminal' ? ui.width - 6 : inner(ui))

function card(
  ui: Ui,
  title: string,
  counter: readonly string[] | null,
  body: RenderChildren,
  bodyRows: number,
  note: TitleNote | null = null,
): Drawn {
  const { Box, Text, theme } = ui
  const isInBorder = ui.surface === 'terminal'
  const joined = counter === null ? null : counter.join(' · ')
  const noteText = (text: string) =>
    note === null ? null : (
      <Text {...styled(note.color, null)} dimColor={note.color === null}>
        {text}
      </Text>
    )
  const isCounterBeside = isCounterBesideOf(ui, title, counter)
  const counterRows =
    counter !== null && !isCounterBeside
      ? flowParts(counter, inner(ui)).map(line => (
          <Box justifyContent="flex-end">
            <Text dimColor>{line}</Text>
          </Box>
        ))
      : []
  const rows = cardFrameRows(ui) + counterRows.length + bodyRows
  const element = (
    <Box flexDirection="column" width={ui.width}>
      <Box flexDirection="column" borderStyle="round" borderColor={theme.frame} paddingX={1} width={ui.width}>
        {isInBorder ? null : (
          <Box justifyContent="space-between">
            {note === null ? (
              <Text bold>{title}</Text>
            ) : (
              <Box>
                <Text bold>{title}</Text>
                {noteText(` · ${note.text}`)}
              </Box>
            )}
            {isCounterBeside ? (
              <Box flexShrink={0} marginLeft={1}>
                <Text dimColor>{joined}</Text>
              </Box>
            ) : null}
          </Box>
        )}
        {counterRows}
        {body}
      </Box>
      {isInBorder ? (
        <Box position="absolute" top={0} left={2}>
          <Text bold>{` ${title} `}</Text>
          {noteText(`· ${note?.text ?? ''} `)}
        </Box>
      ) : null}
      {isInBorder && isCounterBeside ? (
        <Box position="absolute" top={0} right={2}>
          <Text dimColor>{` ${joined} `}</Text>
        </Box>
      ) : null}
    </Box>
  )
  return { element, rows }
}

/** A row with text on the left, cut to fit, and a value on the right that never wraps. */
function spread(ui: Ui, left: RenderChildren, right: RenderChildren): RenderElement {
  const { Box } = ui
  return (
    <Box>
      <Box flexGrow={1} flexShrink={1}>
        {left}
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        {right}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- plan

/** A card's one line when it has nothing to show: its title and a word, no frame. */
function oneLine(ui: Ui, title: string, text: string): Drawn {
  const { Box, Text } = ui
  return {
    element: (
      <Box paddingX={1}>
        <Text wrap="truncate">
          <Text bold>{title}</Text>
          <Text dimColor>{` · ${text}`}</Text>
        </Text>
      </Box>
    ),
    rows: 1,
  }
}

/** A step's words: Claude's own; masked all the same, as RADAR's are. */
const stepLabel = (step: PlanStep) => maskSecrets(step.status === 'in_progress' ? (step.activeText ?? step.text) : step.text)

/** How a step is drawn: its glyph and that glyph's color, its words dim or bold. */
function stepLook(ui: Ui, step: PlanStep): { glyph: string; glyphColor: Color | null; isDim: boolean; isBold: boolean } {
  const { theme } = ui
  if (step.status === 'in_progress') return { glyph: '◉', glyphColor: theme.accent, isDim: false, isBold: true }
  if (step.status === 'pending') return { glyph: '○', glyphColor: null, isDim: false, isBold: false }
  return { glyph: '✓', glyphColor: theme.done, isDim: true, isBold: false }
}

/**
 * The PLAN card, at the bottom of the Live tab. `maxRows` is the most rows
 * it may take, its frame included (null: what it needs): the steps that do
 * not fit are cut from the bottom (the plan is ordered running, open, done)
 * and counted in a last line. Null when not even that line fits.
 */
export function planCard(ui: Ui, plan: readonly PlanStep[], maxRows: number | null = null): Drawn | null {
  const { Box, Text, theme, s } = ui
  // No plan: one line, no frame, so CONTEXT gets the room.
  if (plan.length === 0) return maxRows !== null && maxRows < 1 ? null : oneLine(ui, s.titles.plan, s.plan.empty)
  const done = plan.filter(step => step.status === 'completed').length
  const steps = orderedPlan(plan)
  const counter = [`${done}/${plan.length}`]

  const row = (step: PlanStep) => {
    const { glyph, glyphColor, isDim, isBold } = stepLook(ui, step)
    return (
      <Box>
        <Text {...styled(glyphColor, null)} dimColor={glyphColor === null || isDim}>
          {`${glyph} `}
        </Text>
        <Box flexShrink={1}>
          <Text bold={isBold} dimColor={isDim}>
            {stepLabel(step)}
          </Text>
        </Box>
      </Box>
    )
  }
  const stepRows = steps.map(step => wrappedRows(stepLabel(step), inner(ui) - 2))
  const all = stepRows.reduce((sum, n) => sum + n, 0)
  const room = maxRows === null ? Number.POSITIVE_INFINITY : maxRows - cardOverhead(ui, s.titles.plan, counter)
  if (all <= room) return card(ui, s.titles.plan, counter, steps.map(row), all)
  if (room < 1) return null
  // Room for the steps that fit and a line that counts the rest.
  let used = 0
  let kept = 0
  while (kept < steps.length && used + (stepRows[kept] ?? 1) <= room - 1) {
    used += stepRows[kept] ?? 1
    kept += 1
  }
  const more = (
    <Text dimColor wrap="truncate-end">
      {s.plan.more(steps.length - kept)}
    </Text>
  )
  return card(ui, s.titles.plan, counter, [...steps.slice(0, kept).map(row), more], used + 1)
}

// ---------------------------------------------------------------- radar

/** Live subagents by the Agents card's split: running, and waiting (pending, held, idle in a turn). */
export type AgentsAtWork = { running: number; waiting: number }

/** A row the Agents card shows: spawned or listed; the engine's own forks (a compaction, memory) are not. */
const isShownAgent = (row: AgentRow): boolean => row.description !== null

/** A subagent at work that the Agents card shows: what Nox counts. */
const isShownAtWork = (row: AgentRow): boolean => isShownAgent(row) && isAgentLive(row)

export const agentsAtWorkOf = (agents: readonly AgentRow[]): AgentsAtWork => {
  const { running, waiting, ended } = agentCounts(agents.filter(isShownAtWork))
  // A live agent the list calls ended (a turn still open) is at work.
  return { running: running + ended, waiting }
}

/** A call as RADAR names it: `Bash · Run the tests`, `Bash-Befehl`, `Read · auth.ts`, `WebFetch · example.com`. */
const labelText = (s: Strings, label: CallLabel) =>
  label.detail === null ? (label.tool === 'Bash' ? s.radar.bashCommand : label.tool) : `${label.tool} · ${label.detail}`

/**
 * The loop warning's lines: `⚠ dreht sich im Kreis: Bash · Run the tests (3×)`
 * in one, else broken after the colon, the call's name cut so the count shows.
 */
function loopLines(ui: Ui, streak: FailStreak): string[] {
  const width = inner(ui)
  const label = labelText(ui.s, streak)
  const count = ` (${streak.count}×)`
  const whole = `${ui.s.radar.loop} ${label}${count}`
  if (whole.length <= width) return [whole]
  const room = Math.max(1, width - count.length)
  return [ui.s.radar.loop, `${label.length <= room ? label : `${label.slice(0, room - 1)}…`}${count}`]
}

/** The loop warning, bold in the accent: at the top of STATUS and of RADAR. */
function loopRows(ui: Ui, streak: FailStreak): RenderElement[] {
  const { Text, theme } = ui
  return loopLines(ui, streak).map(line => (
    <Text bold color={theme.accent} wrap="truncate-end">
      {line}
    </Text>
  ))
}

/** A call that failed again and again, by its command where it is a Bash call's. */
const failedLabel = (s: Strings, failed: ReturnType<typeof repeatedOf>[number]) =>
  failed.tool === 'Bash' && failed.detail !== null ? failed.detail : labelText(s, failed)

/** What RADAR reads: failures and their run, the files most used, the time approval dialogs stood open. */
export type RadarView = { radar: Radar; cues: Cues; now: number }

/**
 * The RADAR card, at the bottom of the Live tab while the session has no
 * todo tool. Only rows with something to tell: a call failing three times in
 * a row (in the accent) or four times in this turn (dim), the failures since
 * load, the hotspots, the wait for approvals. `maxRows` (its frame included; null: what it needs) cuts rows
 * from the bottom; null when not one fits. Names only: no command, no path.
 */
export function radarCard(ui: Ui, view: RadarView, maxRows: number | null = null): Drawn | null {
  const { Text, s } = ui
  const width = inner(ui)
  const { radar, cues, now } = view
  const rows: RenderElement[] = []

  const loop = loopOf(radar)
  if (loop !== null) rows.push(...loopRows(ui, loop))
  // The loose stage, dim and in RADAR only: a call that failed four times in this turn, whatever came between.
  for (const failed of repeatedOf(radar)) {
    rows.push(
      <Text dimColor wrap="truncate-end">
        {s.radar.failedTimes(failed.count, failedLabel(s, failed))}
      </Text>,
    )
  }
  if (radar.errors > 0 && radar.lastError !== null) {
    rows.push(
      <Text color="text" wrap="truncate-end">
        {s.radar.errors(radar.errors, radar.lastError.tool, s.radar.ago(Math.max(0, now - radar.lastError.at)))}
      </Text>,
    )
  }
  const hotspots = hotspotsOf(radar)
  if (hotspots.length > 0) {
    const label = `${s.radar.hotspots} `
    const room = Math.max(8, width - label.length)
    // A name too long for its row is cut, never its count.
    const item = (name: string, count: number) => {
      const times = ` ${count}×`
      const fits = Math.max(1, room - times.length)
      return `${name.length <= fits ? name : `${name.slice(0, fits - 1)}…`}${times}`
    }
    const lines = flowParts(
      hotspots.map(one => item(one.name, one.count)),
      room,
    )
    lines.forEach((line, i) =>
      rows.push(
        <Text wrap="truncate-end">
          <Text dimColor>{i === 0 ? label : ' '.repeat(label.length)}</Text>
          <Text color="text">{line}</Text>
        </Text>,
      ),
    )
  }
  const waited = waitedOf(cues, now)
  if (cues.approvals > 0 || waited > 0) {
    rows.push(
      <Text color="text" wrap="truncate-end">
        {s.radar.waited(duration(waited), cues.isWaitApprox, cues.approvals)}
      </Text>,
    )
  }

  if (rows.length === 0) return maxRows !== null && maxRows < 1 ? null : oneLine(ui, s.titles.radar, s.radar.empty)
  const room = maxRows === null ? rows.length : maxRows - cardFrameRows(ui)
  if (room < 1) return null
  const kept = rows.slice(0, room)
  return card(ui, s.titles.radar, null, kept, kept.length)
}

// ---------------------------------------------------------------- context

type Cell = { char: string; color: Color; backgroundColor: Color | null }

function runsOf(cells: readonly Cell[]): Cell[] {
  const runs: Cell[] = []
  for (const cell of cells) {
    const last = runs.at(-1)
    if (last && last.color === cell.color && last.backgroundColor === cell.backgroundColor) last.char += cell.char
    else runs.push({ ...cell })
  }
  return runs
}

const sourceColor = (theme: Theme, key: string, fallback: string): Color => theme.sources[key as SourceKey] ?? fallback

const LABEL_WIDTH = 6

/** The window's fill as the card's header writes it: measured figures plainly, the breakdown's estimates with ≈. */
function contextCounter(ui: Ui, context: ContextSnapshot): readonly string[] {
  const { s } = ui
  const max = context.window
  const exact = context.exact
  return exact
    ? [s.percent(Math.round(exact.percent)), `${tokens(ui, exact.tokens)} / ${tokens(ui, exact.window)}`]
    : [`≈${s.percent(Math.round((context.totalTokens / max) * 100))}`, `≈${tokens(ui, context.totalTokens)} / ${tokens(ui, max)}`]
}

/**
 * The bar, `width` cells: full cells, one run per source (each at least one
 * cell), the free window a quiet dark grey, and a fine mark at the
 * auto-compact threshold.
 */
function contextBar(ui: Ui, context: ContextSnapshot, width: number): RenderElement {
  const { Text, theme } = ui
  const max = context.window
  const counts = barCells(
    context.sources.map(source => source.tokens),
    max,
    width,
  )
  const cells: Cell[] = []
  context.sources.forEach((source, i) => {
    const color = sourceColor(theme, source.key, source.color)
    for (let n = 0; n < (counts[i] ?? 0); n += 1) cells.push({ char: theme.bar.cell, color, backgroundColor: null })
  })
  while (cells.length < width) cells.push({ char: theme.bar.cell, color: theme.free, backgroundColor: null })
  if (context.threshold !== null && max > 0) {
    // The mark draws over the cell it falls on, on that cell's own color, so
    // a source with a single cell still shows and the free run stays whole.
    const at = Math.max(0, Math.min(width - 1, Math.floor((context.threshold / max) * width)))
    cells[at] = { char: theme.bar.marker, color: theme.marker, backgroundColor: cells[at]?.color ?? null }
  }
  return (
    <Text wrap="truncate">
      {runsOf(cells).map(run => (
        <Text {...styled(run.color, run.backgroundColor)}>{run.char}</Text>
      ))}
    </Text>
  )
}

/** The legend's items, in bar order. Every share is the breakdown's estimate: ≈ on each. */
function legendItemsOf(ui: Ui, context: ContextSnapshot): LegendItem[] {
  const { s } = ui
  const max = context.window
  return context.sources.map(source => ({
    key: source.key,
    label: s.sources[source.key as SourceKey] ?? source.key,
    short: s.sourcesShort[source.key as SourceKey] ?? source.key,
    value: `≈${share(source.tokens, max, s.percent, s.decimal, s.na)}`,
    compact: `≈${share(source.tokens, max, s.percentTight, s.decimal, s.na)}`,
  }))
}

/** The tokens the window holds now: the measured figure, else the breakdown's. */
const contextTokens = (context: ContextSnapshot) => context.exact?.tokens ?? context.totalTokens

/** The growth per turn and how far auto-compaction is, in words and shorter. */
function growthWords(ui: Ui, context: ContextSnapshot, usage: UsageTrack): { perTurn: string; compactIn: string; short: string } {
  const { s } = ui
  const current = contextTokens(context)
  const growth = growthOf(usage.history, current, context.threshold)
  const signed = growth.perTurn === null ? null : `${growth.perTurn < 0 ? '−' : '+'}${tokens(ui, Math.abs(growth.perTurn))}`
  const perTurn = signed === null ? s.context.perTurnNA : s.context.perTurn(signed)
  const perTurnShort = signed === null ? s.context.perTurnNA : s.context.perTurnShort(signed)
  const { compactShort } = s.context
  const [compactIn, shortly] =
    context.threshold === null
      ? [s.context.compactOff, compactShort.off]
      : current >= context.threshold
        ? [s.context.compactDue, compactShort.due]
        : growth.turnsLeft === null
          ? [s.context.compactNA, compactShort.na]
          : [s.context.compactIn(growth.turnsLeft), compactShort.in(growth.turnsLeft)]
  return { perTurn, compactIn, short: `${perTurnShort} · ${shortly}` }
}

export function contextCard(ui: Ui, context: ContextSnapshot | null, usage: UsageTrack): Drawn {
  const { Box, Text, theme, s } = ui
  if (context === null) return card(ui, s.titles.context, [s.na], <Text dimColor>{s.context.notMeasured}</Text>, 1)

  const width = inner(ui)
  // One window for the whole card: header, bar, legend, mark and history agree.
  const max = context.window
  const counter = contextCounter(ui, context)

  const items = legendItemsOf(ui, context)
  const legend = legendLines(items, width)
  const legendRow = (line: readonly number[], row: number) => (
    <Text wrap="truncate">
      {line.map((index, n) => {
        const item = items[index]
        if (item === undefined) return null
        const source = context.sources[index]
        return (
          <Text>
            {n === 0 ? '' : ' '.repeat(legend.gap)}
            <Text color={sourceColor(theme, item.key, source?.color ?? theme.track)}>● </Text>
            <Text dimColor>{`${legend.isShort ? item.short : item.label} ${legend.isCompact ? item.compact : item.value}`}</Text>
          </Text>
        )
      })}
      {row === legend.lines.length - 1 && legend.cut > 0 ? <Text dimColor>{`${' '.repeat(legend.gap)}+${legend.cut}`}</Text> : null}
    </Text>
  )

  // The history: braille bars in the accent, two turns a column, straight
  // under the dotted threshold line and scaled to it (the whole window with
  // auto-compaction off). Measured fills, so no ≈; dot columns no turn has
  // reached yet are faint. A sample that is not a measured fill draws nothing.
  const top = context.threshold !== null && max > 0 ? (context.threshold / max) * 100 : 100
  const chars = Math.max(4, width - LABEL_WIDTH)
  const values = usage.history.map(sample =>
    Number.isFinite(sample.tokens) && Number.isFinite(sample.window) && sample.window > 0
      ? (sample.tokens / sample.window) * 100
      : 0,
  )
  const chart = brailleRows(values, top, chars)
  const current = contextTokens(context)
  const { perTurn, compactIn } = growthWords(ui, context, usage)

  // The breakdown: a table, label grey, name bright, value right-aligned.
  const labelWidth = Math.max(s.rows.mcp.length, s.rows.memory.length, s.rows.skills.length) + 1
  const row = (label: string, name: string, detail: string, value: string) =>
    spread(
      ui,
      <Text wrap="truncate-end">
        <Text dimColor>{label.padEnd(labelWidth)}</Text>
        <Text color="text">{name}</Text>
        <Text dimColor>{detail === '' ? '' : ` ${detail}`}</Text>
      </Text>,
      <Text dimColor={value === s.context.deferred}>{value}</Text>,
    )
  const estimate = (n: number) => `≈${tokens(ui, n)}`
  // MCP in one line: servers and tools, the schemas in the window, or
  // deferred while every tool loads on demand.
  const mcpTools = context.mcp.reduce((sum, server) => sum + server.tools, 0)
  const mcpDeferred = context.mcp.reduce((sum, server) => sum + server.deferred, 0)
  const mcpTokens = context.mcp.reduce((sum, server) => sum + server.tokens, 0)
  const mcpRow =
    context.mcp.length === 0
      ? row(s.rows.mcp, s.context.none, '', '')
      : row(
          s.rows.mcp,
          s.context.servers(context.mcp.length),
          `· ${s.context.tools(mcpTools)}`,
          mcpDeferred === mcpTools ? s.context.deferred : estimate(mcpTokens),
        )
  const memoryRows =
    context.memory.length === 0
      ? [row(s.rows.memory, s.context.none, '', '')]
      : context.memory
          .slice(0, 3)
          .map((file, i) =>
            row(i === 0 ? s.rows.memory : '', baseName(file.path), file.kind.toLowerCase(), estimate(file.tokens)),
          )
  const more = (count: number, text: (count: number) => string) =>
    count > 0 ? <Text dimColor>{`${''.padEnd(labelWidth)}${text(count)}`}</Text> : null

  const hit = usage.inputTotal > 0 ? s.percent(Math.round((usage.cacheRead / usage.inputTotal) * 100)) : s.na
  // What is left until auto-compaction runs, rounded (~0 at or past the
  // threshold); left out with auto-compaction off.
  const untilCompact = context.threshold === null ? null : tokens(ui, Math.max(0, context.threshold - current))
  const stats = flowParts(s.context.stats(hit, untilCompact, usage.compactions), width)
  const growthLines = flowParts([perTurn, compactIn], width)
  const tableRows = 1 + memoryRows.length + (context.memory.length > 3 ? 1 : 0) + 1
  // Growth and stats lines wrap where a part is wider than the card: counted as drawn.
  const lineRows = (lines: readonly string[]) => lines.reduce((sum, line) => sum + wrappedRows(line, width), 0)
  const rows = 1 + legend.lines.length + 1 + chart.length + lineRows(growthLines) + tableRows + lineRows(stats)

  return card(
    ui,
    s.titles.context,
    counter,
    [
    contextBar(ui, context, width),
    ...legend.lines.map((line, row) => legendRow(line, row)),
    <Box>
      <Text color={theme.accent}>{theme.bar.threshold.repeat(chars)}</Text>
      <Text dimColor>{s.percent(Math.round(top)).padStart(LABEL_WIDTH)}</Text>
    </Box>,
    ...chart.map(line => (
      <Text wrap="truncate">
        {[...line.data].map((char, i) =>
          char !== ' ' ? (
            <Text color={theme.accent}>{char}</Text>
          ) : (line.placeholder[i] ?? ' ') !== ' ' ? (
            <Text color={theme.track}>{line.placeholder[i]}</Text>
          ) : (
            ' '
          ),
        )}
      </Text>
    )),
    ...growthLines.map(line => <Text dimColor>{line}</Text>),
    mcpRow,
    ...memoryRows,
    more(context.memory.length - 3, s.context.moreFiles),
    context.skills === null
      ? row(s.rows.skills, s.context.none, '', '')
      : row(
          s.rows.skills,
          s.context.listed(context.skills.listed),
          context.skills.listed < context.skills.total ? s.context.of(context.skills.total) : '',
          estimate(context.skills.tokens),
        ),
    ...stats.map(line => <Text dimColor>{line}</Text>),
    ],
    rows,
  )
}

// ---------------------------------------------------------------- status

/** How long the mascot stays `done` after a turn answered, before it waits again. */
export const DONE_MS = 30_000

export function moodOf(activity: Activity, agents: readonly AgentRow[], now: number, waiting: Waiting | null): Mood {
  if (waiting !== null) return waiting
  if (activity.hasTurnError || (activity.isWorking && activity.hasToolError)) return 'error'
  if (activity.isWorking) return 'working'
  if (agents.some(isShownAtWork)) return 'agents'
  if (activity.answeredAt !== null && now - activity.answeredAt < DONE_MS) return 'done'
  return 'ready'
}

/** How the limit is drawn: five hearts, or the ten-cell bar (the `limitStyle` option). */
export type LimitStyle = 'hearts' | 'bar'

/**
 * What STATUS shows: the file edited, the limit (the 5h window, else the
 * week's) and its reset, the loop warning, Nox (or the mini owl) and its state.
 */
export type StatusView = {
  activity: Activity
  limit: RateWindow | null
  mood: Mood
  agentsAtWork: AgentsAtWork
  pose: Pose
  miniPose: MiniPose
  /** The fine owls' pictures (the `fein` style, where the terminal draws pictures); null: the block owls. */
  pictures: OwlPictures | null
  now: number
  limitStyle: LimitStyle
  radar: Radar
}

/** The pictures of fine Nox and the fine mini owl as they are now. */
export type OwlPictures = { nox: ImageSource; mini: ImageSource }

/**
 * Which owl STATUS shows: Nox under its lines, the mini owl beside them, or
 * none (the pane too narrow for the mini owl too). Never both.
 */
export type Owl = 'nox' | 'mini' | 'none'

/** The pane width (its body's columns) from which the mini owl shows; below it STATUS's lines keep the card's width. */
export const MINI_MIN_COLUMNS = 40

const isWaitedOn = (mood: Mood) => mood === 'approval' || mood === 'question'

/**
 * The state in words: the caption's, or the title's beside the mini owl;
 * where they do not fit `room`, shorter ones (`Freigabe!`, `2 Agents`).
 */
function moodWords(ui: Ui, mood: Mood, agentsAtWork: AgentsAtWork, room: number, isTitle: boolean): string {
  const { status } = ui.s
  const { running, waiting } = agentsAtWork
  const words = mood === 'agents' ? status.agentsAtWork(running, waiting) : (isTitle ? status.moodTitle : status.mood)[mood]
  if (words.length <= room) return words
  if (mood === 'agents') return status.moodShort.agents(running + waiting)
  return isWaitedOn(mood) ? status.moodShort[mood] : words
}

/** One row of an owl's cells. */
function owlRow(ui: Ui, runs: readonly Run[]): RenderElement {
  const { Text } = ui
  return (
    <Text wrap="truncate">
      {runs.map(run => (
        <Text {...styled(run.color, run.backgroundColor)}>{run.text}</Text>
      ))}
    </Text>
  )
}

/** The file in hand, else the last one edited, as STATUS says it. */
function editPart(ui: Ui, activity: Activity): Part {
  const { theme, s } = ui
  if (activity.editing !== null) return { text: s.status.editing(maskSecrets(baseName(activity.editing))), bold: true, color: theme.accent }
  return { text: activity.lastEdited !== null ? s.status.lastEdit(maskSecrets(baseName(activity.lastEdited))) : s.status.noEdits, dimColor: true }
}

/**
 * What the limit says: the share left (null once the window's reset time has
 * passed: the reading is the last response's and no longer stands), the
 * sentence around it, and when the window resets, only while its reading
 * stands; the week's with its weekday, as it may be days away.
 */
function limitReading(ui: Ui, view: Pick<StatusView, 'limit' | 'now'>) {
  const { s } = ui
  const { limit, now } = view
  const left = limitLeft(limit, now)
  const kind = limit?.kind ?? 'five_hour'
  const leftText = left !== null && left > 0 && left < 0.5 ? `<${s.percent(1)}` : s.percent(Math.round(left ?? 0))
  const clockTime = left === null ? null : resetClockOf(limit?.resetsAt ?? null)
  const day = kind === 'seven_day' ? resetDayOf(limit?.resetsAt ?? null) : null
  const weekday = day === null ? undefined : s.status.weekdays[day]
  const resetTime = clockTime === null || weekday === undefined ? clockTime : `${weekday} ${clockTime}`
  return { left, kind, leftText, sentence: s.status.limit[kind](leftText), reset: resetTime === null ? null : s.status.resetAt(resetTime) }
}

/** The cells the limit's hearts or bar take. */
const limitCells = (ui: Ui, style: LimitStyle) => (style === 'hearts' ? 10 : ui.theme.limitBar.cells)

/**
 * The limit's line: its hearts or bar, then `words`. Where its reading no
 * longer stands it says so instead; without a window (off a subscription,
 * nothing measured yet) no line.
 */
function limitLineOf(ui: Ui, view: Pick<StatusView, 'limit' | 'limitStyle'>, reading: ReturnType<typeof limitReading>, words: string): RenderElement | null {
  const { Text, theme, s } = ui
  const { left, kind } = reading
  const hearts = theme.limitHearts
  const cells = view.limitStyle === 'hearts' ? 5 : theme.limitBar.cells
  const full = left === null ? 0 : cellsFull(left, cells)
  return view.limit === null ? null : left === null ? (
    <Text dimColor wrap="truncate-end">
      {s.status.limitReset[kind]}
    </Text>
  ) : view.limitStyle === 'hearts' ? (
    // A space after every heart, so a glyph drawn wider than its cell spills
    // into it; two between the last heart and the text.
    <Text wrap="truncate">
      <Text color={theme.heart}>{`${hearts.full} `.repeat(full)}</Text>
      <Text color={hearts.emptyColor}>{`${hearts.empty} `.repeat(cells - full)}</Text>
      <Text dimColor>{words}</Text>
    </Text>
  ) : (
    <Text wrap="truncate">
      <Text color={theme.heart}>{theme.limitBar.cell.repeat(full)}</Text>
      <Text color={theme.track}>{theme.limitBar.cell.repeat(cells - full)}</Text>
      <Text dimColor>{words}</Text>
    </Text>
  )
}

/** The state beside the mini owl: `fertig` while it hops, then `bereit`: the caption's 30 s are Nox's. */
function besideOwl(view: Pick<StatusView, 'activity' | 'mood' | 'now'>): Mood {
  const { activity, mood, now } = view
  const answered = activity.answeredAt === null ? Number.POSITIVE_INFINITY : now - activity.answeredAt
  return mood === 'done' && answered >= HOP_MS ? 'ready' : mood
}

/**
 * The STATUS card, at the top of the Live tab. While a call fails again and
 * again its warning comes first, so it never leaves the visible rows; then
 * the file edited, the limit and its reset: the 5h window and the time of
 * day, else the week's for all models and its weekday and time, else no
 * line for either. With Nox (`owl` nox)
 * or none, the state follows as a caption under them, in the accent while
 * the person is waited on; the mini owl sits beside them instead, cutting
 * them sooner, and the state moves into the title. Where the view brings
 * pictures and the surface draws them, either owl is one keyed `Image`
 * (Nox 16 × 8 cells, the mini owl 6 × 3) that the tick swaps; else the
 * block characters.
 */
export function statusCard(ui: Ui, view: StatusView, owl: Owl): Drawn {
  const { Box, Text, theme, s } = ui
  const { activity, limit, mood, agentsAtWork, pose, miniPose, now, limitStyle } = view
  const Picture = ui.Image
  const pictures = Picture === null ? null : view.pictures
  const miniColumns = pictures === null ? MINI_COLUMNS : MINI_FINE_COLUMNS
  /** The cells the lines beside the owl have. */
  const room = owl === 'mini' ? inner(ui) - miniColumns - 1 : inner(ui)

  const loop = loopOf(view.radar)
  const warning = loop === null ? [] : loopRows(ui, loop)

  const edit = editPart(ui, activity)
  const editing = (
    <Text {...plainLook(edit)} wrap="truncate-end">
      {edit.text}
    </Text>
  )

  const reading = limitReading(ui, view)
  // The share left is never cut: where the sentence does not fit, the number alone follows the cells.
  const sentence = ` ${reading.sentence}`
  const words = limitCells(ui, limitStyle) + sentence.length <= room ? sentence : ` ${reading.leftText}`
  const limitLine = limitLineOf(ui, view, reading, words)
  const reset =
    reading.reset === null ? null : (
      <Text dimColor wrap="truncate-end">
        {reading.reset}
      </Text>
    )

  const lines = [editing, limitLine, reset].filter(line => line !== null)

  if (owl === 'mini') {
    const state = besideOwl(view)
    const note = {
      text: moodWords(ui, state, agentsAtWork, titleRoom(ui) - s.titles.status.length - 3, true),
      color: isWaitedOn(state) ? theme.accent : null,
    }
    // The warning keeps the card's width; the owl stands beside the lines under it, which are cut sooner.
    const body = [
      ...warning,
      <Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {lines}
        </Box>
        <Box flexDirection="column" flexShrink={0} marginLeft={1} width={miniColumns}>
          {Picture !== null && pictures !== null ? (
            <Picture key="mini" source={pictures.mini} columns={MINI_FINE_COLUMNS} rows={MINI_FINE_ROWS} alt={s.status.noxAlt} />
          ) : (
            miniRows(miniPose, theme).map(runs => owlRow(ui, runs))
          )}
        </Box>
      </Box>,
    ]
    const owlRows = pictures === null ? MINI_ROWS : MINI_FINE_ROWS
    return card(ui, s.titles.status, null, body, warning.length + Math.max(owlRows, lines.length), note)
  }

  const mascot =
    owl !== 'nox'
      ? []
      : Picture !== null && pictures !== null
        ? [<Picture key="nox" source={pictures.nox} columns={NOX_COLUMNS} rows={NOX_ROWS} alt={s.status.noxAlt} />]
        : mascotRows(pose, theme).map(runs => owlRow(ui, runs))
  const mascotRowCount = owl !== 'nox' ? 0 : pictures !== null ? NOX_ROWS : mascot.length
  const caption = moodWords(ui, mood, agentsAtWork, inner(ui), false)
  // Every row is one line: the warning, the edit line, the limit, the reset, the caption.
  const rows = warning.length + lines.length + 1 + mascotRowCount

  return card(
    ui,
    s.titles.status,
    null,
    [
      ...warning,
      ...lines,
      <Box flexDirection="column" alignItems="center">
        {mascot}
        {isWaitedOn(mood) ? (
          <Text color={theme.accent} wrap="truncate-end">
            {caption}
          </Text>
        ) : (
          <Text dimColor wrap="truncate-end">
            {caption}
          </Text>
        )}
      </Box>,
    ],
    rows,
  )
}

// ---------------------------------------------------------------- changes

const MAX_ROWS = 80

/** The files changed and their lines, as the card's header says them; null for none. */
function changesCounter(ui: Ui, changes: readonly FileChange[], missed: number): readonly string[] | null {
  const known = changes.filter(change => change.added !== null && change.removed !== null)
  const added = known.reduce((total, change) => total + (change.added ?? 0), 0)
  const removed = known.reduce((total, change) => total + (change.removed ?? 0), 0)
  const files = changes.length + missed
  const isPartial = known.length < changes.length || missed > 0
  return files === 0 ? null : ui.s.changes.counter(files, added, removed, isPartial)
}

/** A file's row: its path, cut at the start, and its lines. */
function changeRow(ui: Ui, change: FileChange, root: string): RenderElement {
  const { Text, theme, s } = ui
  return spread(
    ui,
    <Text color="text" wrap="truncate-start">
      {projectPath(change.path, root)}
    </Text>,
    <Text>
      {change.isNew ? <Text color={theme.accent}>{`${s.changes.isNew} `}</Text> : null}
      {change.isDeleted ? <Text color={theme.bad}>{`${s.changes.deleted} `}</Text> : null}
      {change.added === null || change.removed === null ? (
        <Text dimColor>{s.na}</Text>
      ) : (
        <Text>
          <Text color={theme.done}>{`+${change.added}`}</Text>
          <Text color={theme.bad}>{` −${change.removed}`}</Text>
        </Text>
      )}
    </Text>,
  )
}

export function changesCard(ui: Ui, changes: readonly FileChange[], missed: number, cacheFiles: number, root: string): RenderElement {
  const { Text, s } = ui
  const counter = changesCounter(ui, changes, missed)
  const row = (change: FileChange) => changeRow(ui, change, root)

  // Rows left out for room keep their counts in the counter; files a diff
  // named no lines for are n/a; a Bash command's cache files are only counted.
  const hidden = Math.max(0, changes.length - MAX_ROWS)
  return card(
    ui,
    s.titles.changes,
    counter,
    [
      changes.length === 0 && missed === 0 ? <Text dimColor>{s.changes.empty}</Text> : changes.slice(0, MAX_ROWS).map(row),
      hidden > 0 ? <Text dimColor>{s.changes.moreRows(hidden)}</Text> : null,
      missed > 0 ? <Text dimColor>{s.changes.missed(missed)}</Text> : null,
      cacheFiles > 0 ? <Text dimColor>{s.changes.cacheFiles(cacheFiles)}</Text> : null,
      <Text dimColor>{s.changes.note}</Text>,
    ],
    0,
  ).element
}

// ---------------------------------------------------------------- agents

/** A figure noxdeck did not see: an agent from before load, or tokens of a loop no list names. */
const NA = '–'

const GLYPH: Readonly<Record<string, string>> = {
  running: '◉',
  pending: '○',
  waiting: '◌',
  idle: '◌',
  completed: '✓',
  failed: '✗',
  killed: '■',
}

/** A failed or killed agent: drawn in the accent, with its tool errors. */
const isBroken = (status: string) => status === 'failed' || status === 'killed'

/** An agent as the Agents card draws it: its row, what noxdeck saw it do, its status. */
type ShownAgent = { row: AgentRow; work: AgentWork | null; status: string; isEnded: boolean }

function shownAgents(board: AgentBoard): ShownAgent[] {
  const work = new Map(board.ledger.work.map(one => [one.id, one]))
  return board.rows.filter(isShownAgent).map(row => {
    const status = agentStatus(row)
    return { row, work: work.get(row.id) ?? null, status, isEnded: isEndedStatus(status) }
  })
}

function agentTallyOf(agents: readonly ShownAgent[]): AgentTally {
  const counts: AgentTally = { running: 0, waiting: 0, done: 0, failed: 0, killed: 0 }
  for (const { status, isEnded } of agents) {
    if (status === 'running') counts.running += 1
    else if (!isEnded) counts.waiting += 1
    else if (status === 'failed') counts.failed += 1
    else if (status === 'killed') counts.killed += 1
    else counts.done += 1
  }
  return counts
}

/** Every agent since load: those in the list as `counts` has them, and those that left it as they ended. */
const withGoneOf = (counts: AgentTally, gone: EndCounts): AgentTally => ({
  ...counts,
  done: counts.done + gone.completed + gone.ended,
  failed: counts.failed + gone.failed,
  killed: counts.killed + gone.killed,
})

/** What some of a run's agents processed (every request, seen whole or not), and from their first start to their last end. */
type RunSum = { tokens: number; isWhole: boolean; span: { from: number; to: number } | null }

/**
 * A workflow run as the Agents tab draws it (version 1.1): a line with how
 * many agents it named, what they processed and how long it ran, whatever
 * left the list; its agents still in the list under it.
 */
type RunView = {
  run: AgentRun
  /** The agents it named since load: its count. */
  agents: number
  /** Its running and waiting agents, in start order: each always shows. */
  live: ShownAgent[]
  /** Its finished agents still in the list, in start order. */
  ended: ShownAgent[]
  isLive: boolean
  /** Its line's glyph: ◉ while one runs, else its finished agents'. */
  status: string
  /** Its finished agents' glyph: ✗ where one failed, ■ where one was stopped, ✓ when all are done. */
  endedStatus: string
  /** Its agents that failed or were stopped, those that left the list included. */
  failed: number
  killed: number
  /** What all its agents processed and how long, and its finished agents' alone (their line under a running run's agents). */
  whole: RunSum
  done: RunSum
}

/** The sum of some of a run's agents' work and its past; one still running (`live`) ends now. */
function runSumOf(works: readonly AgentWork[], past: RunPast, live: ReadonlySet<string>, now: number): RunSum {
  let tokens = processedOf(past.tally)
  let isWhole = past.isWhole
  let from = past.from
  let to = past.to
  for (const work of works) {
    tokens += processedOf(work.tally ?? NO_TALLY)
    isWhole = isWhole && work.isWhole
    from = earliest(from, work.startedAt)
    to = latest(to, live.has(work.id) ? now : work.endedAt)
  }
  return { tokens, isWhole, span: from === null || to === null ? null : { from, to } }
}

/**
 * The runs the tab draws, the newest first: each kept run that named an
 * agent, with its agents still in the list, its glyphs and its sums.
 */
function runViewsOf(ledger: AgentLedger, agents: readonly ShownAgent[], now: number): RunView[] {
  return ledger.runs
    .map(run => {
      const members = agents.filter(one => one.row.run === run.id).sort(inRunOrder)
      const live = members.filter(one => !one.isEnded)
      const ended = members.filter(one => one.isEnded)
      const liveIds = new Set(live.map(one => one.row.id))
      const works = ledger.work.filter(one => one.run === run.id)
      const endings = run.past.ended
      const failed = endings.failed + ended.filter(one => one.status === 'failed').length
      const killed = endings.killed + ended.filter(one => one.status === 'killed').length
      const isAllDone = endings.ended === 0 && ended.every(one => one.status === 'completed')
      const endedStatus = failed > 0 ? 'failed' : killed > 0 ? 'killed' : isAllDone ? 'completed' : 'ended'
      return {
        run,
        agents: Math.max(run.agents, members.length),
        live,
        ended,
        isLive: live.length > 0,
        status: live.length > 0 ? liveStatus(live) : endedStatus,
        endedStatus,
        failed,
        killed,
        whole: runSumOf(works, run.past, liveIds, now),
        done: runSumOf(
          works.filter(one => !liveIds.has(one.id)),
          run.past,
          liveIds,
          now,
        ),
      }
    })
    .filter(one => one.agents > 0)
    .reverse()
}

/** A run's name: its script's, else its id. */
const runName = (ui: Ui, run: AgentRun) => run.name ?? ui.s.agents.runUnnamed(run.id)

/** A run's figures: what its agents processed (– where noxdeck did not see one's all), and from its first start to its last end. */
const runFigures = (ui: Ui, sum: RunSum) => ({
  processed: sum.isWhole ? tokens(ui, sum.tokens) : NA,
  time: sum.span === null ? NA : duration(sum.span.to - sum.span.from),
})

/** A finished run's failed and stopped agents after its count, in glyphs (` · 1 ✗`); nothing where none. */
const brokenNote = (one: RunView) =>
  `${one.failed > 0 ? ` · ${one.failed} ${GLYPH.failed}` : ''}${one.killed > 0 ? ` · ${one.killed} ${GLYPH.killed}` : ''}`

/** A run's line's fold, and a running run's finished agents': by the run's id. */
const runFold = (run: AgentRun) => `${RUN_FOLD}${run.id}`
const doneFold = (run: AgentRun) => `${DONE_FOLD}${run.id}`

const glyphColor = (ui: Ui, status: string): Color =>
  status === 'completed' ? ui.theme.done : status === 'running' || isBroken(status) ? ui.theme.accent : 'inactive'

/** What an agent's requests went through, or – where noxdeck did not see them all. */
const processedText = (ui: Ui, work: AgentWork | null) => {
  const tally = wholeTally(work)
  return tally === null ? NA : tokens(ui, processedOf(tally))
}

const elapsedText = (row: AgentRow, now: number) => {
  const elapsed = agentElapsed(row, now)
  return elapsed === null ? NA : duration(elapsed)
}

/**
 * The last call as the card names it, after → (▸ and ▾ fold, nothing else):
 * the tool and the file's name, never a command, prompt or pattern.
 */
const callText = (work: AgentWork | null) =>
  work?.lastCall ? `→ ${work.lastCall.tool}${work.lastCall.file === null ? '' : ` ${maskSecrets(work.lastCall.file)}`}` : null

/**
 * What the person does on the Agents tab and what of it shows: the agent
 * whose transcript the main view shows, the groups they folded, and what a
 * press on a row or a group's head does.
 */
export type AgentsControls = {
  /** The agent in the main view (the pane's `view`); null while the main chat is. */
  viewed: string | null
  folds: AgentFolds
  /** Puts an agent's transcript in the main view; null, the main chat's. */
  onView: (agentId: string | null) => void
  /** A press on a workflow's agent, which has no view: says where to see it instead. */
  onWorkflowAgent: () => void
  /** Opens or closes a group, running or finished, in one of the two views. */
  onFold: (prefix: string, view: FoldView) => void
  /** Whether the head of what the pots processed is open, the table in place of the pots' line (the full card only). */
  isProcessedOpen: boolean
  /** Opens or closes it. */
  onProcessed: () => void
}

/** A group head's Button key: an agent's row is keyed by the agent's id. */
const groupKey = (prefix: string) => `group-${prefix}`

/** The Button back to the main chat. */
const MAIN_CHAT_KEY = 'main-chat'

/** A workflow's agent: Claude Code has no view for one (`$.ui.view` answers no agent under that id); /workflows shows it. */
const WORKFLOW_TYPE = 'workflow-subagent'

/** What a press on an agent's row does: show its transcript, or, for a workflow's agent, say where to see it. */
const pressOf = (row: AgentRow, controls: AgentsControls) => () =>
  row.type === WORKFLOW_TYPE ? controls.onWorkflowAgent() : controls.onView(row.id)

/** The head of what the pots processed, which opens and closes their table. */
const PROCESSED_KEY = 'processed'

/**
 * A run of a row's text and how it is drawn. `keep` keeps its own color (and
 * dim) on a marked row: the bar's cells, which cover the accent behind them.
 */
type Part = { text: string; color?: Color; backgroundColor?: Color; dimColor?: true; bold?: true; keep?: true }

/** How a part is drawn, its text aside. */
type Look = Omit<Part, 'text'>

/** A code point the terminal draws two cells wide: East Asian wide and fullwidth forms, an emoji drawn as one. */
const WIDE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]|\p{Emoji_Presentation}/u
/** A code point drawn in no cell of its own: a combining mark, a joiner, a variation selector. */
const ZERO_WIDTH = /\p{M}|[\u200b-\u200d\ufe00-\ufe0f]/u

const charCells = (char: string) => (ZERO_WIDTH.test(char) ? 0 : WIDE.test(char) ? 2 : 1)

/**
 * The cells a text takes on the terminal, as near as its characters tell:
 * a wide one two, a mark none. A pressable row is laid out by hand, so it
 * measures what the renderer would; an agent's description may hold any.
 */
export function cellsOf(text: string): number {
  let cells = 0
  for (const char of text) cells += charCells(char)
  return cells
}

/** A text cut to `room` cells, whole characters only, an ellipsis marking the cut. */
function cutCells(text: string, room: number): string {
  if (cellsOf(text) <= room) return text
  let kept = ''
  let used = 0
  for (const char of text) {
    const cells = charCells(char)
    if (used + cells > room - 1) break
    kept += char
    used += cells
  }
  return room < 1 ? '' : `${kept}…`
}

const widthOf = (parts: readonly Part[]) => parts.reduce((sum, part) => sum + cellsOf(part.text), 0)

const gap = (cells: number): Part => ({ text: ' '.repeat(Math.max(0, cells)) })

/** Parts cut to `room` cells in all, an ellipsis where the cut falls, the parts after it left out. */
function fitted(parts: readonly Part[], room: number): Part[] {
  const kept: Part[] = []
  let left = Math.max(0, room)
  for (const part of parts) {
    const cells = cellsOf(part.text)
    if (cells <= left) {
      kept.push(part)
      left -= cells
      continue
    }
    if (left > 0) kept.push({ ...part, text: cutCells(part.text, left) })
    break
  }
  return kept
}

/** A lead narrowed by up to `cells` from its spaces, the last first: in the narrowest pane the indent gives way, not the figures. */
function narrowed(lead: readonly Part[], cells: number): Part[] {
  let over = cells
  return [...lead]
    .reverse()
    .map(part => {
      if (over <= 0 || part.text.trim() !== '') return part
      const kept = Math.max(0, part.text.length - over)
      over -= part.text.length - kept
      return { ...part, text: part.text.slice(0, kept) }
    })
    .reverse()
}

/** A part as it is drawn on no mark: its colors, dim or bold. */
const plainLook = (part: Part) => ({
  ...styled(part.color ?? null, part.backgroundColor ?? null),
  ...(part.dimColor ? { dimColor: true } : {}),
  ...(part.bold ? { bold: true } : {}),
})

/**
 * A row the person presses: one Button (keyed by the agent's id, or the
 * group's) holding the row's parts as Text, since a Button holds nothing
 * else; so the row is laid out by hand, `width` cells. The agent in the main
 * view is marked across the whole line: its text on the accent.
 */
function pressRow(ui: Ui, key: string, parts: readonly Part[], width: number, isMarked: boolean, onPress: () => void): RenderElement {
  const { Button, Text, theme } = ui
  const shown = fitted(parts, width)
  const line = [...shown, gap(width - widthOf(shown))].filter(part => part.text !== '')
  const look = (part: Part) =>
    isMarked
      ? {
          color: part.keep ? (part.color ?? theme.onAccent) : theme.onAccent,
          backgroundColor: theme.accent,
          ...(part.keep && part.dimColor ? { dimColor: true } : {}),
          ...(part.bold ? { bold: true } : {}),
        }
      : plainLook(part)
  return (
    <Button key={key} plain onPress={onPress}>
      <Text wrap="truncate-end">
        {line.map(part => (
          <Text {...look(part)}>{part.text}</Text>
        ))}
      </Text>
    </Button>
  )
}

/** A row of parts no press acts on, cut to `width` cells: one Text, its parts drawn as an unmarked pressRow's. */
function partsRow(ui: Ui, parts: readonly Part[], width: number): RenderElement {
  const { Text } = ui
  return (
    <Text wrap="truncate-end">
      {fitted(parts, width)
        .filter(part => part.text !== '')
        .map(part => (
          <Text {...plainLook(part)}>{part.text}</Text>
        ))}
    </Text>
  )
}

/**
 * A text broken at its spaces into rows of at most `width` cells, a word
 * longer than a row cut with an ellipsis: each row drawn as a Text of its
 * own, none reaches past the card's frame, and the rows are counted whole.
 */
function wrappedLines(text: string, width: number): string[] {
  const room = Math.max(1, width)
  const lines: string[] = []
  for (const word of text.split(' ')) {
    const last = lines.at(-1)
    if (last !== undefined && cellsOf(last) + 1 + cellsOf(word) <= room) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(cutCells(word, room))
  }
  return lines
}

/**
 * A text's rows, each one dim Text: as many as wrappedLines needs at
 * `width`, broken as evenly as they go (`Jeder Schritt liest` over `den
 * ganzen Block neu:`, not a word left alone in the last row).
 */
function dimLines(ui: Ui, text: string, width: number): RenderElement[] {
  const { Text } = ui
  let lines = wrappedLines(text, width)
  for (let room = width - 1; room >= 1; room -= 1) {
    const narrower = wrappedLines(text, room)
    if (narrower.length > lines.length || narrower.join(' ') !== text) break
    lines = narrower
  }
  return lines.map(line => (
    <Text dimColor wrap="truncate-end">
      {line}
    </Text>
  ))
}

/** Every agent's row's columns, running or finished, shared so they line up: the bar's cells, the figures' widths. */
type Columns = { bar: number; processed: number; time: number }

/** A finished row's figures, one run in the text color: what it processed and how long it ran, each right-aligned in its column. */
const endedFigures = (cols: Columns, processed: string, time: string): Part[] => [
  { text: `${processed.padStart(cols.processed)} ${time.padStart(cols.time)}`, color: 'text' },
]

/** A running row's figures in the same columns: what it processed white and bold, its time in `timeColor` (the accent while it runs). */
const liveFigures = (cols: Columns, processed: string, time: string, timeColor: Color): Part[] => [
  gap(cols.processed - processed.length),
  { text: processed, color: 'text', bold: true },
  gap(1 + cols.time - time.length),
  { text: time, color: timeColor },
]

/**
 * A row's parts across `width`: its lead (a glyph, a group's fold mark, or
 * the indent under a group), its label laid out in the room left and cut to
 * it, a slot of `bar` cells (the bar, or a failed agent's errors; none where
 * `bar` is 0), and its figures, right-aligned.
 */
function workParts(lead: readonly Part[], label: (room: number) => readonly Part[], slot: readonly Part[], bar: number, figures: readonly Part[], width: number): Part[] {
  const fixed = (bar > 0 ? bar + 1 : 0) + 1 + widthOf(figures)
  const shownLead = narrowed(lead, widthOf(lead) + fixed - width)
  const room = width - widthOf(shownLead) - fixed
  const shown = fitted(label(room), room)
  const slotParts = bar > 0 ? [gap(1), ...slot, gap(bar - widthOf(slot))] : []
  return [...shownLead, ...shown, gap(room - widthOf(shown)), ...slotParts, gap(1), ...figures]
}

/** A type said shorter: up to its first `-` (`general-purpose` → `general`, `workflow-subagent` → `workflow`). */
const shortType = (type: string) => type.split('-')[0] || type

/**
 * A row's label in `room` cells: its name, then (dim) the agent's type where
 * it differs from most, then what follows (a failed agent's errors). The
 * type whole where the room has it, else said shorter, else left out; never
 * cut, so it never takes the name's room.
 */
function labelOf(name: Part, type: string | null, after: readonly Part[], room: number): Part[] {
  const free = room - cellsOf(name.text) - widthOf(after)
  const note = type === null ? undefined : [type, shortType(type)].find(text => 1 + cellsOf(text) <= free)
  return [name, ...(note === undefined ? [] : [{ text: ` ${note}`, dimColor: true } as const]), ...after]
}

/** A dim line across `width` cells: ┄ between running agents, ─ between them and the finished, and over the pots' sum. */
function ruleRow(ui: Ui, char: string, width: number): RenderElement {
  const { Text } = ui
  return (
    <Text dimColor wrap="truncate">
      {char.repeat(Math.max(0, width))}
    </Text>
  )
}

/** Where every agent's figures came from, and what the card says it all means. */
type AgentsView = {
  /** Every agent still in the list, running or finished, a run's included, as the list keeps them. */
  agents: ShownAgent[]
  /** Those that stand alone or in a group of their words, no run's (version 1.1), in the same order. */
  loose: ShownAgent[]
  /** Running and waiting agents of no run, grouped as the finished are, in both views. */
  liveGroups: AgentGroup<ShownAgent>[]
  /** Finished agents of no run, grouped. */
  groups: AgentGroup<ShownAgent>[]
  /** The workflow runs, the newest first: a line each. */
  runs: RunView[]
  /** Every agent since load: those in the list as their rows say, those that left it as they ended. */
  counts: AgentTally
  /** The type most agents have; an agent of another shows its own. */
  common: string | null
  /** What has no line before any is left out for room: the runs past the 30 kept, the agents of no run that left the list. */
  older: { runs: number; agents: number }
  /** What the Agents pot processed since load: the older line shows what no line above it does. */
  pot: number
}

const inStartOrder = (a: ShownAgent, b: ShownAgent) => a.row.firstSeen - b.row.firstSeen

/** A run's agents in the order its script called `agent()` (ok:8 before ok:9, whichever loop started first), then as first seen. */
const inRunOrder = (a: ShownAgent, b: ShownAgent) => (a.row.index ?? 0) - (b.row.index ?? 0) || inStartOrder(a, b)

function agentsViewOf(board: AgentBoard): AgentsView {
  const { ledger, now } = board
  const agents = shownAgents(board)
  // An agent of no run stands alone or in its group, as before; so does a
  // running one of a run no longer kept. A finished one of such a run is
  // the older runs'.
  const kept = new Set(ledger.runs.map(run => run.id))
  const loose = agents.filter(one => one.row.run === null || (!kept.has(one.row.run) && !one.isEnded))
  // Running and waiting agents and the finished, each grouped by their description's prefix,
  // the newest group first, its agents in start order.
  const byPrefix = (list: readonly ShownAgent[]) => groupsOf([...list].sort(inStartOrder), one => one.row.description ?? '').reverse()
  return {
    agents,
    loose,
    liveGroups: byPrefix(loose.filter(one => !one.isEnded)),
    groups: byPrefix(loose.filter(one => one.isEnded)),
    runs: runViewsOf(ledger, agents, now),
    counts: withGoneOf(agentTallyOf(agents), ledger.gone),
    common: commonType(agents.map(one => one.row.type)),
    older: { runs: ledger.runsOlder.runs, agents: ledger.goneLoose },
    pot: processedOf(potsOf(ledger).agents),
  }
}

/** A line of the running or the finished: a workflow run, or a group (or an agent) of no run. */
type Entry = { run: RunView; group: null } | { run: null; group: AgentGroup<ShownAgent> }

/** When an entry started: a run when noxdeck first heard of it, a group with its first agent. */
const entryAt = (entry: Entry) => (entry.run !== null ? entry.run.run.firstSeen : (entry.group.members[0]?.row.firstSeen ?? 0))

/** Runs and groups, each the newest first, in one list the newest first; the sort keeps equals in place, so each list's own order. */
const entriesOf = (runs: readonly RunView[], groups: readonly AgentGroup<ShownAgent>[]): Entry[] =>
  [...runs.map((run): Entry => ({ run, group: null })), ...groups.map((group): Entry => ({ run: null, group }))].sort(
    (a, b) => entryAt(b) - entryAt(a),
  )

/** What some agents processed, every request summed, seen whole or not. */
const tokensOf = (agents: readonly ShownAgent[]) => agents.reduce((sum, one) => sum + processedOf(one.work?.tally ?? NO_TALLY), 0)

/** The odd type an agent shows: its own where it differs from the type most agents have; a run's agent none, its run says it. */
const oddType = (view: AgentsView, row: AgentRow) => (row.run === null && row.type !== null && row.type !== view.common ? row.type : null)

/** A group's glyph: ✓ when all its agents are done, ✗ when one failed, ■ when one was stopped. */
const groupStatus = (members: readonly ShownAgent[]) =>
  members.some(one => one.status === 'failed')
    ? 'failed'
    : members.some(one => one.status === 'killed')
      ? 'killed'
      : members.every(one => one.status === 'completed')
        ? 'completed'
        : 'ended'

/** A running group's glyph: ◉ while one of its agents runs, else its first one's (it waits). */
const liveStatus = (members: readonly ShownAgent[]) =>
  members.some(one => one.status === 'running') ? 'running' : (members[0]?.status ?? 'running')

/** A live agent seen from its spawn that has not started its first turn yet, or whose first step has not come back: its figures are none so far, not unknown. */
const isWholeLive = ({ work, isEnded }: ShownAgent) => !isEnded && work?.isWhole === true

/**
 * From a group's first start to its last end (now while one runs); null
 * where one of them is not known. A live agent that has not started yet
 * has no part in it; the others' starts tell the span.
 */
function spanOf(members: readonly ShownAgent[], now: number): { from: number; to: number } | null {
  let from = Number.POSITIVE_INFINITY
  let to = 0
  let counted = 0
  for (const one of members) {
    const { work, isEnded } = one
    if (isWholeLive(one) && work?.startedAt === null) continue
    if (work === null || work.startedAt === null) return null
    const end = isEnded ? work.endedAt : now
    if (end === null) return null
    from = Math.min(from, work.startedAt)
    to = Math.max(to, end)
    counted += 1
  }
  return counted === 0 ? null : { from, to }
}

/**
 * The tokens a group's agents processed, summed; – where noxdeck did not
 * see one agent's all. A live agent's first step not back yet adds none.
 */
function groupProcessed(ui: Ui, members: readonly ShownAgent[]): string {
  const tallies = members.map(one => (isWholeLive(one) ? (one.work?.tally ?? NO_TALLY) : wholeTally(one.work)))
  if (tallies.some(tally => tally === null)) return NA
  return tokens(ui, tallies.reduce((sum, tally) => sum + (tally === null ? 0 : processedOf(tally)), 0))
}

/** A group's figures: what its agents processed, summed, and its time from the first start to the last end (to now while one runs). */
function groupFigures(ui: Ui, members: readonly ShownAgent[], now: number): { processed: string; time: string } {
  const span = spanOf(members, now)
  return { processed: groupProcessed(ui, members), time: span === null ? NA : duration(span.to - span.from) }
}

/**
 * The columns every agent's row shares, running or finished: what was
 * processed and how long, each as wide as its widest figure, a group's and
 * a run's included; a bar of 10 or 6 cells where the rows have the room for it.
 */
function columnsOf(ui: Ui, view: AgentsView, now: number): Columns {
  const figures = [
    ...view.agents.map(one => ({ processed: processedText(ui, one.work), time: elapsedText(one.row, now) })),
    ...[...view.liveGroups, ...view.groups].filter(group => group.prefix !== null).map(group => groupFigures(ui, group.members, now)),
    ...view.runs.flatMap(one => [runFigures(ui, one.whole), ...(one.isLive ? [runFigures(ui, one.done)] : [])]),
  ]
  const processed = Math.max(1, ...figures.map(one => one.processed.length))
  const time = Math.max(1, ...figures.map(one => one.time.length))
  const free = inner(ui) - 2 - (processed + 1 + time) - 1
  return { bar: free >= 26 ? 10 : free >= 18 ? 6 : 0, processed, time }
}

/** The most any agent processed, running ones included: every bar is measured against it. */
const largestOf = (view: AgentsView) => Math.max(1, ...view.agents.map(one => processedOf(wholeTally(one.work) ?? NO_TALLY)))

/** Whether the agent in the main view is one of a group's: its head is marked while the group is closed. */
const holdsViewed = (members: readonly ShownAgent[], controls: AgentsControls) => members.some(one => one.row.id === controls.viewed)

/** A glyph as a part: in the agent's status color. */
const glyphPart = (ui: Ui, status: string): Part => ({ text: GLYPH[status] ?? '·', color: glyphColor(ui, status) })

/** A group head's lead: its glyph and whether it is open (▾) or closed (▸). */
const foldLead = (ui: Ui, status: string, isOpen: boolean): Part[] => [glyphPart(ui, status), gap(1), { text: isOpen ? '▾' : '▸' }, gap(1)]

/**
 * A running group's fold, apart from a finished group's of the same words:
 * a prefix holds no `:`, so neither is taken for the other.
 */
const liveFold = (prefix: string) => `${LIVE_FOLD}${prefix}`

/**
 * A running (or waiting) agent in up to four lines: its row, pressed to see
 * its transcript (its glyph and name; what it processed, white and bold,
 * and its time in its glyph's color, in the finished rows' columns); under
 * its name its model, its figures and its last call.
 */
function liveBlock(ui: Ui, one: ShownAgent, name: string, isMember: boolean, view: AgentsView, cols: Columns, now: number, controls: AgentsControls): RenderElement[] {
  const { Text, s } = ui
  const width = inner(ui)
  const { row, work, status } = one
  // A group's agents stand under its name, their lines under theirs.
  const lead = [...(isMember ? [gap(2)] : []), glyphPart(ui, status), gap(1)]
  const indent = ' '.repeat(isMember ? 4 : 2)
  const label = (room: number) => labelOf({ text: name, color: 'text' }, oddType(view, row), [], room)
  const figures = liveFigures(cols, processedText(ui, work), elapsedText(row, now), glyphColor(ui, status))
  const head = workParts(lead, label, [], 0, figures, width)
  const lines: RenderElement[] = [pressRow(ui, row.id, head, width, controls.viewed === row.id, pressOf(row, controls))]
  const tally = wholeTally(work)
  if (tally === null) {
    lines.push(<Text dimColor wrap="truncate-end">{`${indent}${s.agents.processedNA}`}</Text>)
  } else {
    const model = [tally.model === null ? null : modelShort(tally.model), tally.effort, s.agents.steps(tally.steps)]
    lines.push(
      <Text dimColor wrap="truncate-end">
        {`${indent}${model.filter(part => part !== null).join(' · ')}`}
      </Text>,
    )
    const numbers = [tally.context === null ? NA : tokens(ui, tally.context), tokens(ui, processedOf(tally)), tokens(ui, freshOf(tally))] as const
    const roomy = s.agents.figures(...numbers)
    lines.push(
      <Text color="text" wrap="truncate-end">
        {`${indent}${roomy.length <= width - indent.length ? roomy : s.agents.figuresTight(...numbers)}`}
      </Text>,
    )
  }
  const call = callText(work)
  if (call !== null && work?.lastCall) {
    lines.push(
      <Text dimColor wrap="truncate-end">
        {`${indent}${call} · ${s.agents.ago(now - work.lastCall.at)}`}
      </Text>,
    )
  }
  return lines
}

/**
 * A running (or waiting) agent in one line, pressed to see its transcript:
 * its glyph and name, its time and what it processed, its last call (`◉
 * review diff 1:23 · 1,1M → Read model.ts`; a group's agent under its head,
 * by the rest of its name, a run's by its whole). The call gives way first,
 * then the name; in the narrowest pane the indent, then the time, never
 * what it processed. A call with no room beside the name stands in a second
 * line under it, with how long ago it started: a running agent always shows
 * what it does (version 1.1). The compact view's lines, and the full card's
 * where it is shortened to fit.
 */
function runningRows(ui: Ui, one: ShownAgent, name: string, isMember: boolean, width: number, now: number, controls: AgentsControls): RenderElement[] {
  const { Text, s } = ui
  const glyph: Part = { text: `${GLYPH[one.status] ?? '·'} `, color: glyphColor(ui, one.status) }
  const timed = `${elapsedText(one.row, now)} · ${processedText(ui, one.work)}`
  const figures = cellsOf(glyph.text) + cellsOf(timed) <= width ? timed : processedText(ui, one.work)
  const whole = callText(one.work)
  const full: Part[] = [...(isMember ? [gap(2)] : []), glyph]
  const lead = narrowed(full, widthOf(full) + 2 + cellsOf(figures) - width)
  // The name's room beside the figures and, where there is one, the call.
  const roomFor = (call: string | null) => width - widthOf(lead) - 1 - cellsOf(figures) - (call === null ? 0 : cellsOf(call) + 1)
  const call = whole !== null && roomFor(whole) >= 8 ? whole : null
  const shown = cutCells(name, Math.max(0, roomFor(call)))
  const parts: Part[] = [
    ...lead,
    { text: shown, color: 'text' },
    { text: `${shown === '' ? '' : ' '}${figures}` },
    ...(call === null ? [] : [{ text: ` ${call}`, dimColor: true } as const]),
  ]
  const row = pressRow(ui, one.row.id, parts, width, controls.viewed === one.row.id, pressOf(one.row, controls))
  const last = one.work?.lastCall ?? null
  if (whole === null || call !== null || last === null) return [row]
  return [
    row,
    <Text dimColor wrap="truncate-end">
      {cutCells(`${' '.repeat(isMember ? 4 : 2)}${whole} · ${s.agents.ago(now - last.at)}`, width)}
    </Text>,
  ]
}

/**
 * The running agents, grouped as the finished are: a group's head (`◉ ▾
 * verify ×5` on the accent, ▸ while closed; what its agents processed, white
 * and bold, and the time since its first start in the accent) the person
 * presses to close or open it, its agents under it while open, each by the
 * rest of its name; an agent without a group alone, by its whole name; a
 * running workflow run as runLiveBlocks draws it, among them by when it
 * started. Each agent in up to four lines, a dim ┄ between them;
 * `isOneLine` (the card shortened to fit the pane) in one line each (two
 * where its call has no room beside it), no ┄.
 */
function liveRows(ui: Ui, view: AgentsView, cols: Columns, now: number, controls: AgentsControls, isOneLine: boolean): RenderElement[] {
  const { theme } = ui
  const width = inner(ui)
  const agentRows = (one: ShownAgent, name: string, isMember: boolean) =>
    isOneLine ? runningRows(ui, one, name, isMember, width, now, controls) : liveBlock(ui, one, name, isMember, view, cols, now, controls)
  const blocks = entriesOf(
    view.runs.filter(one => one.isLive),
    view.liveGroups,
  ).flatMap((entry): RenderElement[][] => {
    if (entry.run !== null) return runLiveBlocks(ui, view, entry.run, cols, now, controls, agentRows)
    const { group } = entry
    const prefix = group.prefix
    if (prefix === null) return group.members.map(one => agentRows(one, one.row.description ?? '', false))
    const fold = liveFold(prefix)
    const isOpen = isGroupOpen(controls.folds, fold, 'large')
    const status = liveStatus(group.members)
    // One run on the accent: its words cut to the room, left out where none is left, never its glyph, fold mark or count.
    const marks = `${GLYPH[status] ?? '◉'} ${isOpen ? '▾' : '▸'} `
    const count = `×${group.members.length}`
    const name = (room: number): Part[] => {
      const words = room - cellsOf(marks) - 1 - cellsOf(count)
      const text = words >= 1 ? `${marks}${cutCells(prefix, words)} ${count}` : `${marks}${count}`
      return [{ text, color: theme.onAccent, backgroundColor: theme.accent, bold: true }]
    }
    const figures = groupFigures(ui, group.members, now)
    const parts = workParts([], name, [], 0, liveFigures(cols, figures.processed, figures.time, glyphColor(ui, status)), width)
    const head = pressRow(ui, groupKey(fold), parts, width, !isOpen && holdsViewed(group.members, controls), () => controls.onFold(fold, 'large'))
    if (!isOpen) return [[head]]
    const [first = [], ...rest] = group.members.map(one => agentRows(one, prefixOf(one.row.description ?? '')?.rest ?? '', true))
    return [[head, ...first], ...rest]
  })
  return blocks.flatMap((block, i) => (i === 0 || isOneLine ? block : [ruleRow(ui, '┄', width), ...block]))
}

/**
 * A running workflow run: its head on the accent (`◉ review-changes ×7`, no
 * fold mark: its running agents always show) with what all its agents
 * processed, white and bold, and its time since its first start in the
 * accent; each running agent under it by its whole name; its finished
 * agents in a line under them (doneRows).
 */
function runLiveBlocks(
  ui: Ui,
  view: AgentsView,
  one: RunView,
  cols: Columns,
  now: number,
  controls: AgentsControls,
  agentRows: (agent: ShownAgent, name: string, isMember: boolean) => RenderElement[],
): RenderElement[][] {
  const { theme } = ui
  const width = inner(ui)
  const name = runName(ui, one.run)
  const marks = `${GLYPH[one.status] ?? '◉'} `
  const count = `×${one.agents}`
  const label = (room: number): Part[] => {
    const words = room - cellsOf(marks) - 1 - cellsOf(count)
    const text = words >= 1 ? `${marks}${cutCells(name, words)} ${count}` : `${marks}${count}`
    return [{ text, color: theme.onAccent, backgroundColor: theme.accent, bold: true }]
  }
  const figures = runFigures(ui, one.whole)
  const head = partsRow(ui, workParts([], label, [], 0, liveFigures(cols, figures.processed, figures.time, glyphColor(ui, one.status)), width), width)
  const [first = [], ...rest] = one.live.map(agent => agentRows(agent, agent.row.description ?? '', true))
  const done = doneRows(ui, view, one, cols, now, controls)
  return [[head, ...first], ...rest, ...(done.length > 0 ? [done] : [])]
}

/**
 * A running run's finished agents in a line under its running ones (`✓ ▸ 4
 * fertig`, what they processed, from their first start to their last end),
 * closed until the person opens it: their rows then, and how many are no
 * longer in the list.
 */
function doneRows(ui: Ui, view: AgentsView, one: RunView, cols: Columns, now: number, controls: AgentsControls): RenderElement[] {
  const { theme } = ui
  const width = inner(ui)
  const finished = one.agents - one.live.length
  if (finished <= 0) return []
  const fold = doneFold(one.run)
  const isOpen = isGroupOpen(controls.folds, fold, 'large')
  const color = isBroken(one.endedStatus) ? theme.accent : 'text'
  // Its glyph, fold mark and count kept: the words give way to the count alone (`×8`) where the row has no room for them.
  const marks = foldLead(ui, one.endedStatus, isOpen)
  const label = (room: number): Part[] => {
    const words = ui.s.agents.runDone(finished)
    return [...marks, { text: widthOf(marks) + cellsOf(words) <= room ? words : `×${finished}`, color }]
  }
  const figures = runFigures(ui, one.done)
  const parts = workParts([gap(2)], label, [], 0, endedFigures(cols, figures.processed, figures.time), width)
  const head = pressRow(ui, groupKey(fold), parts, width, !isOpen && holdsViewed(one.ended, controls), () => controls.onFold(fold, 'large'))
  if (!isOpen) return [head]
  const largest = largestOf(view)
  return [
    head,
    ...one.ended.map(agent => endedAgentRow(ui, view, agent, agent.row.description ?? '', 6, cols, now, controls, largest)),
    ...goneRows(ui, finished - one.ended.length, 6, width),
  ]
}

/** Under an opened run: how many of its agents are no longer in the list, dim, at its agents' indent; nothing where none. */
function goneRows(ui: Ui, count: number, indent: number, width: number): RenderElement[] {
  const { Text, s } = ui
  if (count <= 0) return []
  return [
    <Text dimColor wrap="truncate-end">
      {cutCells(`${' '.repeat(indent)}${s.agents.runGone(count)}`, width)}
    </Text>,
  ]
}

/** The older line: the runs and the agents of no run with no line above it, and what they processed (`+4 ältere Läufe und 2 Agents · 35M`); nothing where none. */
function olderRows(ui: Ui, runs: number, agents: number, processed: number, width: number): RenderElement[] {
  const { Text, s } = ui
  if (runs + agents === 0) return []
  return [
    <Text dimColor wrap="truncate-end">
      {cutCells(s.agents.older(runs, agents, tokens(ui, Math.max(0, processed))), width)}
    </Text>,
  ]
}

/**
 * A finished agent's row, pressed to see its transcript: its glyph, or the
 * indent under its head (`indent` cells); its name, the bar of what it
 * processed against `largest`, or a failed or stopped one's errors in the
 * accent (beside its name where the slot is too small); its figures.
 */
function endedAgentRow(
  ui: Ui,
  view: AgentsView,
  one: ShownAgent,
  name: string,
  indent: number | null,
  cols: Columns,
  now: number,
  controls: AgentsControls,
  largest: number,
): RenderElement {
  const { theme, s } = ui
  const width = inner(ui)
  const isMember = indent !== null

  /** The bar, or a failed or stopped agent's errors in the accent; beside the name where the slot is too small. */
  const slotOf = (): { slot: Part[]; beside: string | null } => {
    if (isBroken(one.status)) {
      const errors = `${isMember ? `${GLYPH[one.status]} ` : ''}${s.agents.errors(one.work?.errors ?? 0)}`
      return errors.length <= cols.bar ? { slot: [{ text: errors, color: theme.accent }], beside: null } : { slot: [], beside: errors }
    }
    const tally = wholeTally(one.work)
    if (tally === null) return { slot: [{ text: NA, dimColor: true }], beside: null }
    // Whole cells only: the share rounded, at least one.
    const full = Math.max(1, Math.round((processedOf(tally) / largest) * cols.bar))
    const slot: Part[] = [
      { text: theme.agentBar.cell.repeat(full), color: theme.done, keep: true },
      { text: theme.agentBar.cell.repeat(Math.max(0, cols.bar - full)), dimColor: true, keep: true },
    ]
    return { slot, beside: null }
  }

  const { slot, beside } = slotOf()
  // A group's agents stand under its name, past the glyph and the fold mark.
  const lead = indent === null ? [glyphPart(ui, one.status), gap(1)] : [gap(indent)]
  const after: Part[] = beside === null ? [] : [{ text: ` · ${beside}`, color: theme.accent }]
  const label = (room: number) => labelOf({ text: name, color: isBroken(one.status) ? theme.accent : 'text' }, oddType(view, one.row), after, room)
  const parts = workParts(lead, label, slot, cols.bar, endedFigures(cols, processedText(ui, one.work), elapsedText(one.row, now)), width)
  return pressRow(ui, one.row.id, parts, width, controls.viewed === one.row.id, pressOf(one.row, controls))
}

/**
 * The finished agents: a head per group (✓ ▾ prüfen ×4) the person presses
 * to close or open it, its agents under it while open; an agent without a
 * group alone; a finished workflow run in a line (runEndedRows) among them
 * by when it started. Every agent's row is pressed to see its transcript.
 * `isFolded` (the card shortened to fit the pane): the groups closed as in
 * the compact view, those the person opened there open, a press turning
 * them there. `trim`: the oldest finished runs left to the older line, where
 * the pane has no rows for them. Last the older line: the runs and the
 * agents of no run with no line, and what no line shows of the Agents pot.
 */
function endedRows(ui: Ui, view: AgentsView, cols: Columns, now: number, controls: AgentsControls, isFolded: boolean, trim: number): RenderElement[] {
  const { theme } = ui
  const width = inner(ui)
  const finished = view.runs.filter(one => !one.isLive)
  const runs = finished.slice(0, Math.max(0, finished.length - trim))
  const largest = largestOf(view)
  const foldView: FoldView = isFolded ? 'compact' : 'large'

  const rows = entriesOf(runs, view.groups).flatMap(entry => {
    if (entry.run !== null) return runEndedRows(ui, view, entry.run, cols, now, controls, foldView, largest)
    const { group } = entry
    const prefix = group.prefix
    if (prefix === null) return group.members.map(one => endedAgentRow(ui, view, one, one.row.description ?? '', null, cols, now, controls, largest))
    const status = groupStatus(group.members)
    const isOpen = isGroupOpen(controls.folds, prefix, foldView)
    const name: Part = { text: `${prefix} ×${group.members.length}`, bold: true, color: isBroken(status) ? theme.accent : 'text' }
    const figures = groupFigures(ui, group.members, now)
    const parts = workParts(foldLead(ui, status, isOpen), () => [name], [], cols.bar, endedFigures(cols, figures.processed, figures.time), width)
    const head = pressRow(ui, groupKey(prefix), parts, width, !isOpen && holdsViewed(group.members, controls), () => controls.onFold(prefix, foldView))
    if (!isOpen) return [head]
    return [
      head,
      ...group.members.map(one => endedAgentRow(ui, view, one, prefixOf(one.row.description ?? '')?.rest ?? '', 4, cols, now, controls, largest)),
    ]
  })
  // Every line above shows its agents' tokens: the running runs', the finished runs' kept, every agent of no run.
  const shown = [...view.runs.filter(one => one.isLive), ...runs].reduce((sum, one) => sum + one.whole.tokens, 0) + tokensOf(view.loose)
  return [...rows, ...olderRows(ui, view.older.runs + finished.length - runs.length, view.older.agents, view.pot - shown, width)]
}

/**
 * A finished workflow run in a line (`✓ ▸ review-changes ×9 · 1 ✗`, bold,
 * in the accent where one failed or was stopped; what its agents processed
 * and from its first start to its last end), closed until the person opens
 * it: its agents still in the list then, each by its whole name, and how
 * many are no longer in the list.
 */
function runEndedRows(
  ui: Ui,
  view: AgentsView,
  one: RunView,
  cols: Columns,
  now: number,
  controls: AgentsControls,
  foldView: FoldView,
  largest: number,
): RenderElement[] {
  const { theme } = ui
  const width = inner(ui)
  const fold = runFold(one.run)
  const isOpen = isGroupOpen(controls.folds, fold, foldView)
  const color = isBroken(one.status) ? theme.accent : 'text'
  // The count and the broken ones' glyphs kept; the name cut to the room left.
  const label = (room: number): Part[] => {
    const count = ` ×${one.agents}${brokenNote(one)}`
    return [{ text: `${cutCells(runName(ui, one.run), Math.max(1, room - cellsOf(count)))}${count}`, bold: true, color }]
  }
  const figures = runFigures(ui, one.whole)
  const parts = workParts(foldLead(ui, one.status, isOpen), label, [], 0, endedFigures(cols, figures.processed, figures.time), width)
  const head = pressRow(ui, groupKey(fold), parts, width, !isOpen && holdsViewed(one.ended, controls), () => controls.onFold(fold, foldView))
  if (!isOpen) return [head]
  return [
    head,
    ...one.ended.map(agent => endedAgentRow(ui, view, agent, agent.row.description ?? '', 4, cols, now, controls, largest)),
    ...goneRows(ui, one.agents - one.ended.length, 4, width),
  ]
}

/**
 * The timeline: a bar per group (or agent without one) across the time since
 * load, from its first start to its last end in whole cells of ▆, ▶ where
 * one still runs; one whose start noxdeck did not hear (from before load) is
 * left out. Its head says it shorter where the row has no room for its
 * words, so it never breaks.
 */
function timelineRows(ui: Ui, view: AgentsView, since: number, now: number): RenderElement[] {
  const { Text, theme, s } = ui
  const width = inner(ui)
  if (since <= 0 || now <= since) return []
  // A bar per group of agents of no run, as they first came, and one per workflow run, by when each started.
  const chronological = [...view.loose].sort(inStartOrder)
  const groupBars = groupsOf(chronological, one => one.row.description ?? '').flatMap(group => {
    const span = spanOf(group.members, now)
    if (span === null) return []
    const label = group.prefix ?? group.members[0]?.row.description ?? ''
    return [{ label, span, isLive: group.members.some(one => !one.isEnded), status: groupStatus(group.members), at: group.members[0]?.row.firstSeen ?? 0 }]
  })
  const runBars = view.runs.flatMap(one =>
    one.whole.span === null ? [] : [{ label: runName(ui, one.run), span: one.whole.span, isLive: one.isLive, status: one.status, at: one.run.firstSeen }],
  )
  const bars = [...groupBars, ...runBars].sort((a, b) => a.at - b.at)
  if (bars.length === 0) return []

  // The labels measured in cells, as the rows are: a wide character takes two.
  const labelWidth = Math.min(Math.max(...bars.map(bar => cellsOf(bar.label))), Math.max(6, Math.floor(width / 4)))
  const cells = Math.max(4, width - labelWidth - 1)
  const span = now - since
  const cellOf = (at: number) => Math.max(0, Math.min(cells - 1, Math.floor(((at - since) / span) * cells)))
  const rows = bars.map(bar => {
    const from = cellOf(bar.span.from)
    const to = Math.max(from, bar.isLive ? cells - 1 : cellOf(bar.span.to))
    const color = bar.isLive || isBroken(bar.status) ? theme.accent : theme.done
    const run = to - from + 1
    const label = cutCells(bar.label, labelWidth)
    return (
      <Text wrap="truncate">
        <Text color="text">{`${label}${' '.repeat(Math.max(0, labelWidth - cellsOf(label)))}`}</Text>
        <Text color={theme.track}>{` ${theme.bar.threshold.repeat(from)}`}</Text>
        <Text color={color}>{bar.isLive ? `${theme.agentBar.cell.repeat(run - 1)}▶` : theme.agentBar.cell.repeat(run)}</Text>
        <Text color={theme.track}>{theme.bar.threshold.repeat(cells - to - 1)}</Text>
      </Text>
    )
  })
  const total = duration(span)
  const head = cellsOf(s.agents.timeline) + 1 + total.length <= width ? s.agents.timeline : s.agents.timelineShort
  return [
    spread(
      ui,
      <Text dimColor wrap="truncate-end">
        {head}
      </Text>,
      <Text dimColor>{total}</Text>,
    ),
    ...rows,
  ]
}

/** A row of the pots' table: the pot's name and who works in it, the block each step reads, what it processed. */
type PotRow = readonly [name: string, who: string, block: string, processed: string]

/** The pots' table laid out: its head and rows as parts, every one at most the width it was laid out for. */
type PotTable = { head: Part[]; rows: Part[][] }

/**
 * The pots' table across at most `width` cells: the names and who left, the
 * block and what was processed right-aligned under their heads. Where the
 * row has no room, the gaps between the figures narrow first, then the last
 * head says it shorter (its gaps wide again where that is enough), then who
 * gives way (cut, then left out), then the names; the figures never.
 */
function potTable(columns: readonly [string, string, string], tight: readonly [string, string, string], rows: readonly PotRow[], width: number): PotTable {
  const widest = (texts: readonly string[]) => Math.max(0, ...texts.map(cellsOf))
  const names = widest(rows.map(row => row[0]))
  const who = widest(rows.map(row => row[1]))
  // Who stands two cells after the names; the figures' gaps and heads are what the tries change.
  const tries = [
    { heads: columns, gap: 2 },
    { heads: columns, gap: 1 },
    { heads: tight, gap: 2 },
    { heads: tight, gap: 1 },
  ].map(one => ({
    ...one,
    block: widest([one.heads[1], ...rows.map(row => row[2])]),
    processed: widest([one.heads[2], ...rows.map(row => row[3])]),
  }))
  const figuresOf = (one: (typeof tries)[number]) => one.gap + one.block + one.gap + one.processed
  const chosen = tries.find(one => names + 2 + who + figuresOf(one) <= width) ?? tries[tries.length - 1]
  if (chosen === undefined) return { head: [], rows: [] }
  const figures = figuresOf(chosen)
  // Who cut where five of its cells and the ellipsis fit, else left out.
  const whoRoom = width - figures - names - 2
  const whoWidth = whoRoom >= Math.min(who, 6) ? Math.min(who, whoRoom) : 0
  const nameWidth = Math.max(1, Math.min(names, width - figures - (whoWidth > 0 ? 2 + whoWidth : 0)))
  const left = (text: string, cells: number, look: Look): Part[] => {
    const shown = cutCells(text, cells)
    return [{ text: shown, ...look }, gap(cells - cellsOf(shown))]
  }
  const right = (text: string, cells: number, look: Look): Part[] => [gap(cells - cellsOf(text)), { text, ...look }]
  const figureParts = (block: string, processed: string, look: Look): Part[] => [
    gap(chosen.gap),
    ...right(block, chosen.block, look),
    gap(chosen.gap),
    ...right(processed, chosen.processed, look),
  ]
  const dim = { dimColor: true } as const
  const text = { color: 'text' } as const
  const head = [...left(chosen.heads[0], nameWidth + (whoWidth > 0 ? 2 + whoWidth : 0), dim), ...figureParts(chosen.heads[1], chosen.heads[2], dim)]
  const body = rows.map(([name, by, block, processed]) => [
    ...left(name, nameWidth, text),
    ...(whoWidth > 0 ? [gap(2), ...left(by, whoWidth, text)] : []),
    ...figureParts(block, processed, text),
  ])
  return { head, rows: body }
}

/**
 * What the pots processed since load, under a head the person presses (a
 * Button of its own): closed (▸) the pots after it, broken between them, as
 * before; open (▾) the head alone, the pots' table under it, its last row
 * the three summed under a thin rule, and, dim, how the main chat's figure
 * comes about: its steps, each reading its whole block again. Only the
 * tallies' sums and step counts, never a message.
 */
function processedRows(ui: Ui, ledger: AgentLedger, controls: AgentsControls): RenderElement[] {
  const { Text, s } = ui
  const width = inner(ui)
  // The pots are decided here: a loop a spawn or the list named is the Agents pot's, any other Sonstiges.
  const pots = potsOf(ledger)
  const main = processedOf(pots.main)
  const head = (text: string) => pressRow(ui, PROCESSED_KEY, [{ text, color: 'text' }], width, false, controls.onProcessed)
  if (!controls.isProcessedOpen) {
    const parts = [`▸ ${s.agents.processed}`, ...s.agents.totals(tokens(ui, main), tokens(ui, processedOf(pots.agents)), tokens(ui, processedOf(pots.other)))]
    const [first = '', ...rest] = flowParts(parts, width)
    return [
      head(first),
      ...rest.map(line => (
        <Text color="text" wrap="truncate-end">
          {cutCells(line, width)}
        </Text>
      )),
    ]
  }

  // The main chat's block: what its last step read (input, cache read, cache creation); – before one reported it.
  const { table } = s.agents
  const steps = pots.main.steps
  const block = steps === 0 || pots.main.context === null ? NA : tokens(ui, pots.main.context)
  const agents = processedOf(pots.agents)
  const other = processedOf(pots.other)
  const laid = potTable(
    table.columns,
    table.columnsTight,
    [
      [...table.main, block, tokens(ui, main)],
      [...table.agents, table.ownBlock, tokens(ui, agents)],
      [...table.other, NA, tokens(ui, other)],
      // The three pots summed, no one's and no block.
      [table.total, '', '', tokens(ui, main + agents + other)],
    ],
    width,
  )
  const rows = laid.rows.map(row => partsRow(ui, row, width))
  const sum = steps === 0 ? [] : dimLines(ui, table.sum(steps, tokens(ui, main / steps), tokens(ui, main)), width)
  return [
    head(`▾ ${s.agents.processed}`),
    partsRow(ui, laid.head, width),
    ...rows.slice(0, -1),
    ruleRow(ui, '─', Math.min(width, widthOf(laid.head))),
    ...rows.slice(-1),
    ...dimLines(ui, table.rereads, width),
    ...sum,
  ]
}

/**
 * How far the full card is shortened where the pane has not the rows for
 * it, each step on top of the ones before: 1 the running agents in a line
 * each, 2 the finished groups closed (those the person opened there open),
 * 3 no timeline. Then the oldest finished runs go to the older line one by
 * one (`trim`), the newest kept; where even that does not fit, the compact
 * view.
 */
export type Shortening = 0 | 1 | 2 | 3

const SHORTENINGS: readonly Shortening[] = [0, 1, 2, 3]

/**
 * The Agents card at its full size: the head, what each pot processed since
 * load (or their table), the running agents in up to four lines each and
 * the finished ones, both by group and by workflow run, their figures in
 * the same columns, a rule between them; the older line, the timeline, and
 * what `verarbeitet` means. Shortened as `shortening` says, its `trim`
 * oldest finished runs in the older line.
 */
export function agentsLarge(ui: Ui, board: AgentBoard, controls: AgentsControls, shortening: Shortening = 0, trim = 0): Drawn {
  const { s } = ui
  const width = inner(ui)
  const { now, ledger } = board
  const view = agentsViewOf(board)
  const cols = columnsOf(ui, view, now)

  const processed = processedRows(ui, ledger, controls)
  const empty = view.agents.length === 0 ? dimLines(ui, s.agents.empty, width) : []
  const live = liveRows(ui, view, cols, now, controls, shortening >= 1)
  const ended = endedRows(ui, view, cols, now, controls, shortening >= 2, trim)
  const between = live.length > 0 && ended.length > 0 ? [ruleRow(ui, '─', width)] : []
  const timeline = shortening >= 3 ? [] : timelineRows(ui, view, ledger.since, now)
  // The footer broken into rows of its own: in a narrow pane it wraps, never past the frame.
  const body = [...processed, ...empty, ...live, ...between, ...ended, ...timeline, ...dimLines(ui, s.agents.note, width)]
  return card(ui, s.titles.agents, view.agents.length === 0 ? null : s.agents.counter(view.counts), body, body.length)
}

/**
 * A line of the compact view: a group's or a run's head, an agent without a
 * group, or an agent under an open head (`at` its place there); its rows,
 * two for a running agent whose call stands under it; how many agents it
 * stands for in its count line (a closed group's all, an open one's head
 * none, a run's lines none: a run's line counts as a run); what its agents
 * processed, for the older line (a head its group's or its run's, an agent
 * under it none); its group's fold, and whether it is the agent in the main
 * view. An open head holding that agent keeps itself drawn marked, for when
 * the agent's line is left out. An opened run's head, and a running run's
 * opened line of its finished agents, carries the `tail` under its agents.
 */
type CompactLine = {
  element: RenderElement
  rows: number
  kind: 'head' | 'agent' | 'member'
  /** A running or waiting agent's: it gives way only after every finished line. */
  isRunning: boolean
  agents: number
  /** A finished run's line: left out, it is an older run. */
  isRun: boolean
  tokens: number
  /** A head the person opened: it stays longer than a closed one, so a press shows what it opened. */
  isOpen: boolean
  group: string | null
  at: number
  isViewed: boolean
  marked?: RenderElement
  tail?: Tail
}

/**
 * The line under an opened run's agents while some are not drawn (version
 * 1.1): `+38 weitere` where the rows left some out, else `+5 nicht mehr in
 * der Liste`; `gone` how many left the list, `draw` the line for a count. In
 * two columns an opened group of no run has one too.
 */
type Tail = { gone: number; draw: (count: number, isCut: boolean) => RenderElement }

/** The compact view's width from which the finished stand in two columns (version 1.1): a pane of about 100 columns. */
const TWO_COLUMNS_MIN = 94

/** A finished line with the lines under it while it is open: in two columns they never part. */
type Block = CompactLine[]

/** The finished lines by block: a head with its group's lines under it, any other line alone. */
function blocksOf(lines: readonly CompactLine[]): Block[] {
  const blocks: Block[] = []
  for (const line of lines) {
    const last = blocks.at(-1)
    if (last !== undefined && line.group !== null && last[0]?.group === line.group) last.push(line)
    else blocks.push([line])
  }
  return blocks
}

/** A block in a column, in `rows` rows (an opened one's agents cut to them); null for the count line. */
type Placed = { block: Block | null; rows: number }

/**
 * The running and the finished lines in `room` rows: all where they fit;
 * else lines left out until they do, the rest each in its place. The
 * finished give way first, all of them, so every running agent shows while
 * the rows hold it: the agents under open heads but their first (evenly,
 * each group's last first), the agents without a group, each open group's
 * first, the agent in the main view, then the heads, the lowest first (a
 * closed one before one the person opened). A line after them counts what
 * has no line: `+5 ✓`, which gives way before the heads, as before; or,
 * with a run among the finished, the older line (`+4 ältere Läufe und 2
 * Agents · 35M`), which stays while the heads give way. Then a running
 * run's finished agents (the agent in the main view among them last) and
 * their line, the finished's count line, the
 * running agents (counted, `+3 ◉`), the agent in the main view among them
 * last, the running's count line, the heads last. So an opened group shows
 * its first agent while the rows hold one more, and an open head whose
 * agent in the main view was left out is marked in its place. An opened
 * run's agents that are not drawn are counted in its tail; one left out
 * where the tail took the row it freed comes back. With `cell`, the
 * finished stand in two columns of that many cells (columnsIn) while the
 * running leave them a row.
 */
function cutLines(
  ui: Ui,
  view: AgentsView,
  live: readonly CompactLine[],
  ended: readonly CompactLine[],
  room: number,
  cell: number | null,
  liveTokens: number,
  width: number,
): RenderElement[] {
  const { Box, Text, s } = ui
  const left = new Set<CompactLine>()
  /** Heads whose tail gave way: none of their agents is drawn, and their own count says them. */
  const untailed = new Set<CompactLine>()
  const isCounted = { live: true, ended: true }
  const leftOf = (lines: readonly CompactLine[]) => lines.filter(line => left.has(line))
  const keptOf = (lines: readonly CompactLine[]) => lines.filter(line => !left.has(line))
  const liveHidden = () => leftOf(live).reduce((sum, line) => sum + line.agents, 0)
  /** Whether a line left out is counted in its head's tail, not in the finished's count line: an agent under a kept head that has one. */
  const isTailed = (line: CompactLine, lines: readonly CompactLine[]) =>
    line.kind === 'member' && lines.some(head => head.tail !== undefined && head.group === line.group && !left.has(head))
  /** The agents under a head with a tail that are not drawn: those left out, those no longer in the list. */
  const hiddenOf = (head: CompactLine, lines: readonly CompactLine[]) =>
    (head.tail?.gone ?? 0) + lines.filter(line => line.kind === 'member' && line.group === head.group && left.has(line)).length
  /** The finished's count line as it reads with what is left out now: `+5 ✓`, or the older line with a run among it; null with nothing to count. */
  const endedCount = (): { text: string; isOlder: boolean } | null => {
    if (!isCounted.ended) return null
    const gone = leftOf(ended).filter(line => !isTailed(line, ended))
    const runs = view.older.runs + gone.filter(line => line.isRun).length
    const agents = view.older.agents + gone.reduce((sum, line) => sum + line.agents, 0)
    if (runs === 0) return agents > 0 ? { text: `${s.agents.more(agents)} ✓`, isOlder: false } : null
    const shown = liveTokens + keptOf(ended).reduce((sum, line) => sum + line.tokens, 0)
    return { text: s.agents.older(runs, agents, tokens(ui, Math.max(0, view.pot - shown))), isOlder: true }
  }
  const countElement = (count: { text: string; isOlder: boolean }) =>
    count.isOlder ? (
      <Text dimColor wrap="truncate-end">
        {cutCells(count.text, cell ?? width)}
      </Text>
    ) : (
      <Text dimColor>{count.text}</Text>
    )
  const hasTail = (head: CompactLine, lines: readonly CompactLine[]) => head.tail !== undefined && !untailed.has(head) && hiddenOf(head, lines) > 0
  const tailRows = (lines: readonly CompactLine[]) => keptOf(lines).filter(line => hasTail(line, lines)).length
  const liveRows = () => keptOf(live).reduce((sum, line) => sum + line.rows, 0) + tailRows(live) + (isCounted.live && liveHidden() > 0 ? 1 : 0)
  const rows = () => liveRows() + keptOf(ended).length + tailRows(ended) + (endedCount() === null ? 0 : 1)
  const unseenOf = () => new Set([...live, ...ended].filter(line => line.isViewed && left.has(line)).map(line => line.group))
  const elementOf = (unseen: ReadonlySet<string | null>) => (line: CompactLine) => (line.marked !== undefined && unseen.has(line.group) ? line.marked : line.element)
  /** The kept lines, each head's tail after the last line of its group. */
  const drawnOf = (lines: readonly CompactLine[], unseen: ReadonlySet<string | null>) =>
    keptOf(lines).flatMap((line, i, kept) => {
      const drawn = [{ element: elementOf(unseen)(line), rows: line.rows }]
      if (line.group === null || kept[i + 1]?.group === line.group) return drawn
      const head = kept.find(one => one.tail !== undefined && one.group === line.group)
      if (head?.tail === undefined || !hasTail(head, lines)) return drawn
      const hidden = hiddenOf(head, lines)
      return [...drawn, { element: head.tail.draw(hidden, hidden > head.tail.gone), rows: 1 }]
    })

  /**
   * The finished in two columns of `cell` cells, `height` rows at most,
   * filled down the first, then down the second, the newest first; a block
   * whole in one column. An opened one stays in the column it begins in
   * where it has the rows for its head, one agent and its tail at least,
   * its agents cut to the rows (the agent in the main view kept); else it
   * begins atop the second. What has no place counts in the count line,
   * last; for it the last block gives way, an opened one an agent. Before
   * an opened block or the agent in the main view has no place, the lines
   * before it give way, the lowest first. As few rows as hold every line
   * whole, else `height`.
   */
  const columnsIn = (height: number): Placed[][] => {
    const blocks = blocksOf(ended)
    const layout = (rows: number, dropped: ReadonlySet<Block>): Placed[][] => {
      left.clear()
      const columns: Placed[][] = [[]]
      let used = 0
      let isFull = false
      const leave = (block: Block) => block.forEach(line => left.add(line))
      for (const block of blocks) {
        if (isFull || dropped.has(block)) {
          leave(block)
          continue
        }
        const isOpen = block[0]?.tail !== undefined
        const whole = block.length + ((block[0]?.tail?.gone ?? 0) > 0 ? 1 : 0)
        // Atop a column it stays: the second has no more rows.
        if (!(rows - used >= whole || (isOpen && (rows - used >= 3 || used === 0))) && columns.length < 2) {
          columns.push([])
          used = 0
        }
        const rest = rows - used
        const taken = rest >= whole ? whole : isOpen && rest >= 2 ? rest : 0
        if (taken === 0) {
          isFull = true
          leave(block)
          continue
        }
        columns.at(-1)?.push({ block, rows: taken })
        used += taken
      }
      for (let count = endedCount(); count !== null; count = endedCount()) {
        if (rows - used >= 1) {
          columns.at(-1)?.push({ block: null, rows: 1 })
          break
        }
        if (columns.length < 2) {
          columns.push([])
          used = 0
          continue
        }
        const last = columns.at(-1)?.pop()
        if (last === undefined || last.block === null) break
        if (last.block[0]?.tail !== undefined && last.rows > 2) {
          columns.at(-1)?.push({ ...last, rows: last.rows - 1 })
          used -= 1
          continue
        }
        leave(last.block)
        used -= last.rows
      }
      // An opened block's agents past its rows: its first ones drawn, the agent in the main view among them.
      for (const placed of columns.flat()) {
        if (placed.block === null) continue
        const [head, ...members] = placed.block
        if (head === undefined || placed.rows >= placed.block.length + ((head.tail?.gone ?? 0) > 0 ? 1 : 0)) continue
        const room = Math.max(0, placed.rows - 2)
        const viewed = members.find(line => line.isViewed)
        const first = members.slice(0, room)
        const shown = viewed === undefined || room === 0 || first.includes(viewed) ? first : [...members.slice(0, room - 1), viewed]
        members.filter(line => !shown.includes(line)).forEach(line => left.add(line))
      }
      return columns
    }
    for (let rows = 1; rows < height; rows += 1) {
      const columns = layout(rows, new Set())
      if (left.size === 0) return columns
    }
    const isGuarded = (block: Block) => block[0]?.tail !== undefined || block.some(line => line.isViewed)
    let dropped = new Set<Block>()
    for (;;) {
      const columns = layout(height, dropped)
      const guarded = blocks.find(block => isGuarded(block) && !dropped.has(block) && block[0] !== undefined && left.has(block[0]))
      const before = guarded === undefined ? [] : blocks.slice(0, blocks.indexOf(guarded)).filter(block => !isGuarded(block) && !dropped.has(block))
      const lowest = before.at(-1)
      if (lowest === undefined) return columns
      dropped = new Set([...dropped, lowest])
    }
  }

  if (cell !== null && room - liveRows() >= 1) {
    const columns = columnsIn(room - liveRows())
    const unseen = unseenOf()
    const count = endedCount()
    const cellsOfPlaced = (placed: Placed): RenderElement[] => {
      if (placed.block === null) return count === null ? [] : [countElement(count)]
      const [head, ...members] = placed.block
      if (head === undefined) return []
      const hidden = head.tail === undefined ? 0 : hiddenOf(head, ended)
      return [
        elementOf(unseen)(head),
        ...keptOf(members).map(elementOf(unseen)),
        ...(head.tail === undefined || hidden === 0 ? [] : [head.tail.draw(hidden, hidden > head.tail.gone)]),
      ]
    }
    const [first = [], second = []] = columns.map(column => column.flatMap(cellsOfPlaced))
    const blank = <Text>{' '.repeat(cell)}</Text>
    const pairs = Array.from({ length: Math.max(first.length, second.length) }, (_, row) => (
      <Box flexDirection="row">
        <Box width={cell}>{first[row] ?? blank}</Box>
        {second.length === 0 ? null : <Text dimColor>{' │ '}</Text>}
        {second.length === 0 ? null : <Box width={cell}>{second[row] ?? null}</Box>}
      </Box>
    ))
    return [...drawnOf(live, unseen).map(line => line.element), ...pairs]
  }

  const lowestFirst = (lines: readonly CompactLine[], keep: (line: CompactLine) => boolean) => lines.filter(keep).reverse()
  const isMember = (line: CompactLine) => line.kind === 'member' && !line.isViewed
  const leave = (line: CompactLine) => () => void left.add(line)
  // A tail gives way once its head's agents have: the head's count says them, and no agent stands over no tail.
  const untail = (line: CompactLine) => () => void untailed.add(line)
  // Where a run is among the finished, the older line stands for the heads that give way; else, as before, the count goes first.
  const hasRuns = view.older.runs > 0 || ended.some(line => line.isRun)
  const steps = [
    ...lowestFirst(ended, line => isMember(line) && line.at > 0)
      .sort((a, b) => b.at - a.at)
      .map(leave),
    ...lowestFirst(ended, line => line.kind === 'agent' && !line.isViewed).map(leave),
    ...lowestFirst(ended, line => isMember(line) && line.at === 0).map(leave),
    ...lowestFirst(ended, line => line.kind !== 'head' && line.isViewed).map(leave),
    ...lowestFirst(ended, line => line.tail !== undefined).map(untail),
    ...(hasRuns ? [] : [() => void (isCounted.ended = false)]),
    ...lowestFirst(ended, line => line.kind === 'head' && !line.isOpen).map(leave),
    ...lowestFirst(ended, line => line.kind === 'head' && line.isOpen).map(leave),
    ...lowestFirst(live, line => !line.isRunning && line.kind === 'member' && !line.isViewed)
      .sort((a, b) => b.at - a.at)
      .map(leave),
    ...lowestFirst(live, line => !line.isRunning && line.kind === 'member' && line.isViewed).map(leave),
    ...lowestFirst(live, line => line.tail !== undefined).map(untail),
    ...lowestFirst(live, line => !line.isRunning && line.kind === 'agent').map(leave),
    () => void (isCounted.ended = false),
    ...lowestFirst(live, line => line.isRunning && !line.isViewed).map(leave),
    ...lowestFirst(live, line => line.isRunning && line.isViewed).map(leave),
    () => void (isCounted.live = false),
    ...lowestFirst(live, line => line.kind === 'head').map(leave),
  ]
  for (const step of steps) {
    if (rows() <= room) break
    step()
  }
  // A run's agent left out where its tail took the row that freed comes back, the first first.
  for (const lines of [live, ended]) {
    for (const line of lines) {
      if (!left.has(line) || !isTailed(line, lines) || lines.some(head => untailed.has(head) && head.group === line.group)) continue
      const before = rows()
      left.delete(line)
      if (rows() > before) left.add(line)
    }
  }
  const unseen = unseenOf()
  const hidden = liveHidden()
  const liveDrawn = [
    ...drawnOf(live, unseen),
    ...(isCounted.live && hidden > 0 ? [{ element: <Text dimColor>{`${s.agents.more(hidden)} ◉`}</Text>, rows: 1 }] : []),
  ]
  const count = endedCount()
  const endedDrawn = [...drawnOf(ended, unseen), ...(count === null ? [] : [{ element: countElement(count), rows: 1 }])]
  // In a pane with no row even for the counts, the lines that fit.
  const shown: RenderElement[] = []
  let used = 0
  for (const line of [...liveDrawn, ...endedDrawn]) {
    used += line.rows
    if (used > Math.max(0, room)) break
    shown.push(line.element)
  }
  return shown
}

/**
 * The Agents card where the pane is short, with no frame: the head in one
 * line, the running agents, then the finished in the rows left: a line per
 * group and per workflow run, closed until the person opens it, and per
 * agent without one; a running agent's line its own (`◉ review diff 1:23 ·
 * 1,1M → Read model.ts`, its call under it where the line has no room for
 * it), a running group's `◉ ▾ verify ×5 0:40 · 2,1M` over its agents, a
 * running run's `◉ review-changes ×7 2:14 · 3,4M` over its running agents
 * and its finished ones' line; an opened run's agents in the order its
 * script started them, a tail under them counting those not drawn. What does
 * not fit is counted in a line, the running and the finished apart. From
 * about 100 columns the finished stand in two columns, filled one after the
 * other, their figures right-aligned.
 */
export function agentsCompact(ui: Ui, board: AgentBoard, room: number, controls: AgentsControls): RenderElement {
  const { Box, Text, theme, s } = ui
  const width = Math.max(8, ui.width - 2)
  const { now } = board
  const view = agentsViewOf(board)
  const cell = width >= TWO_COLUMNS_MIN ? Math.floor((width - 3) / 2) : null
  const isCell = cell !== null
  const endedWidth = cell ?? width
  const endedRuns = view.runs.filter(one => !one.isLive)

  const head =
    view.agents.length === 0 ? (
      <Text wrap="truncate-end">
        <Text bold>{s.titles.agents}</Text>
        <Text dimColor>{` · ${s.agents.empty}`}</Text>
      </Text>
    ) : (
      <Text wrap="truncate-end">
        <Text bold>{s.titles.agents}</Text>
        <Text dimColor>{` ${s.agents.compactCounter(view.counts, tokens(ui, view.pot)).join(' · ')}`}</Text>
      </Text>
    )

  /** What an agent processed and how long it ran. */
  const agentFigures = (one: ShownAgent) => ({ processed: processedText(ui, one.work), time: elapsedText(one.row, now) })
  // In two columns each finished line's figures stand right-aligned, each in a column as wide as its widest (version 1.1).
  const figures = isCell
    ? [
        ...endedRuns.flatMap(one => [runFigures(ui, one.whole), ...one.ended.map(agentFigures)]),
        ...view.groups.flatMap(group => [...(group.prefix === null ? [] : [groupFigures(ui, group.members, now)]), ...group.members.map(agentFigures)]),
      ]
    : []
  const figureCols: Columns = {
    bar: 0,
    processed: Math.max(0, ...figures.map(one => one.processed.length)),
    time: Math.max(0, ...figures.map(one => one.time.length)),
  }

  /**
   * A head's parts in one column: its words, then the first of `rests` (its
   * count and figures, longest first) the row has room for with a few cells
   * of the words; the words cut to the room left, never the count or what
   * was processed.
   */
  const restParts =
    (words: string, rests: readonly string[], color: Color, lineWidth: number) =>
    (lead: readonly Part[]): Part[] => {
      // A rest is kept where a few cells of the words fit beside it, else the next.
      const least = Math.min(cellsOf(words), 4)
      const rest = rests.find(one => widthOf(lead) + least + cellsOf(one) <= lineWidth) ?? rests.at(-1) ?? ''
      const shown = cutCells(words, Math.max(1, lineWidth - widthOf(lead) - cellsOf(rest)))
      return [...lead, { text: `${shown}${rest}`, color }]
    }
  /** A finished line's parts in one of two columns: its words cut to the room beside what follows them (a count), its figures right-aligned. */
  const cellParts =
    (words: string, after: string, color: Color, shown: { processed: string; time: string }) =>
    (lead: readonly Part[]): Part[] =>
      workParts(
        lead,
        room => [{ text: `${cutCells(words, Math.max(1, room - cellsOf(after)))}${after}`, color }],
        [],
        0,
        endedFigures(figureCols, shown.processed, shown.time),
        endedWidth,
      )

  /**
   * A group's or a finished run's head, pressed to open or close it: its
   * glyph and fold mark, then what `partsOf` lays out after them. Marked
   * while closed holding the agent in the main view.
   */
  const groupHead = (
    members: readonly ShownAgent[],
    fold: string,
    status: string,
    partsOf: (lead: readonly Part[]) => Part[],
    lineWidth: number,
    counted: Pick<CompactLine, 'agents' | 'isRun' | 'tokens'>,
  ): CompactLine => {
    const isOpen = isGroupOpen(controls.folds, fold, 'compact')
    const parts = partsOf(foldLead(ui, status, isOpen))
    const drawn = (isMarked: boolean) => pressRow(ui, groupKey(fold), parts, lineWidth, isMarked, () => controls.onFold(fold, 'compact'))
    const isHolding = holdsViewed(members, controls)
    return {
      element: drawn(!isOpen && isHolding),
      rows: 1,
      kind: 'head',
      isRunning: false,
      isOpen,
      ...counted,
      group: fold,
      at: 0,
      isViewed: false,
      ...(isOpen && isHolding ? { marked: drawn(true) } : {}),
    }
  }
  const lineOf = (element: RenderElement, one: ShownAgent, group: string | null, at: number, counted: Partial<CompactLine> = {}): CompactLine => ({
    element,
    rows: 1,
    kind: group === null ? 'agent' : 'member',
    isRunning: false,
    agents: 1,
    isRun: false,
    tokens: 0,
    isOpen: false,
    group,
    at,
    isViewed: controls.viewed === one.row.id,
    ...counted,
  })
  /** A running agent's line, its call under it where the line has no room for it. */
  const runningLine = (one: ShownAgent, name: string, isMember: boolean, group: string | null, at: number): CompactLine => {
    const [first, ...more] = runningRows(ui, one, name, isMember, width, now, controls)
    const element = more.length === 0 && first !== undefined ? first : <Box flexDirection="column">{[first, ...more]}</Box>
    return lineOf(element, one, group, at, { rows: 1 + more.length, isRunning: true })
  }
  // `✓ ▸ prüfen ×4 4,6M`, its agents under it once opened; `✓ review diff 1,2M` for an agent without a group;
  // in one of two columns `✓ review diff   1,2M  0:48`, the figures right-aligned.
  const agentLine = (one: ShownAgent, lead: readonly Part[], name: string, lineWidth: number, isInCell = false) => {
    const color = isBroken(one.status) ? theme.accent : 'text'
    const isMarked = controls.viewed === one.row.id
    if (isInCell) return pressRow(ui, one.row.id, cellParts(name, '', color, agentFigures(one))(lead), lineWidth, isMarked, pressOf(one.row, controls))
    // The name cut to the room beside what it processed, never the figure.
    const processed = processedText(ui, one.work)
    const shown = cutCells(name, Math.max(0, lineWidth - widthOf(lead) - 1 - cellsOf(processed)))
    const parts: Part[] = [...lead, { text: `${shown}${shown === '' ? '' : ' '}${processed}`, color }]
    return pressRow(ui, one.row.id, parts, lineWidth, isMarked, pressOf(one.row, controls))
  }
  /** An agent's lead under its head: the indent, and a failed or stopped one's glyph in the accent. */
  const memberLead = (one: ShownAgent, indent: number): Part[] =>
    isBroken(one.status) ? [gap(indent), { text: `${GLYPH[one.status]} `, color: theme.accent }] : [gap(indent)]
  /** The tail under an opened run's agents, `indent` cells in: `+38 weitere`, or `+5 nicht mehr in der Liste` where the rows left none out. */
  const tailOf = (gone: number, indent: number, lineWidth: number): Tail => ({
    gone,
    draw: (count, isCut) => (
      <Text dimColor wrap="truncate-end">
        {cutCells(`${' '.repeat(indent)}${isCut ? s.agents.runMore(count) : s.agents.runGone(count)}`, lineWidth)}
      </Text>
    ),
  })

  /** A running run's finished agents in a line (`✓ ▸ 4 fertig 1,0M`), closed until opened: their lines then, and the tail under them. */
  const doneLines = (one: RunView): CompactLine[] => {
    const finished = one.agents - one.live.length
    if (finished <= 0) return []
    const fold = doneFold(one.run)
    const isOpen = isGroupOpen(controls.folds, fold, 'compact')
    const figures = runFigures(ui, one.done)
    const color = isBroken(one.endedStatus) ? theme.accent : 'text'
    const parts = [gap(2), ...foldLead(ui, one.endedStatus, isOpen), { text: `${s.agents.runDone(finished)} ${figures.processed}`, color }]
    // Marked as a group's head is: closed holding the agent in the main view, or open where that agent's line was left out.
    const isHolding = holdsViewed(one.ended, controls)
    const drawn = (isMarked: boolean) => pressRow(ui, groupKey(fold), parts, width, isMarked, () => controls.onFold(fold, 'compact'))
    const line: CompactLine = {
      element: drawn(!isOpen && isHolding),
      ...(isOpen && isHolding ? { marked: drawn(true) } : {}),
      ...(isOpen ? { tail: tailOf(finished - one.ended.length, 6, width) } : {}),
      rows: 1,
      kind: 'agent',
      isRunning: false,
      agents: 0,
      isRun: false,
      tokens: 0,
      isOpen,
      group: fold,
      at: -1,
      isViewed: false,
    }
    if (!isOpen) return [line]
    const members = one.ended.map((agent, at) => lineOf(agentLine(agent, memberLead(agent, 6), agent.row.description ?? '', width), agent, fold, at, { agents: 0 }))
    return [line, ...members]
  }

  /** A running run: its head (no fold: its running agents always show), each running agent by its whole name, its finished ones' line. */
  const runLines = (one: RunView): CompactLine[] => {
    const figures = runFigures(ui, one.whole)
    const count = ` ×${one.agents}`
    const lead = [glyphPart(ui, one.status), gap(1)]
    const words = runName(ui, one.run)
    const rests = [`${count} ${figures.time} · ${figures.processed}`, `${count} ${figures.processed}`]
    const rest = rests.find(one => widthOf(lead) + Math.min(cellsOf(words), 4) + cellsOf(one) <= width) ?? rests.at(-1) ?? ''
    const shown = cutCells(words, Math.max(1, width - widthOf(lead) - cellsOf(rest)))
    const headLine: CompactLine = {
      element: partsRow(ui, [...lead, { text: `${shown}${rest}`, color: 'text' }], width),
      rows: 1,
      kind: 'head',
      isRunning: false,
      agents: 0,
      isRun: false,
      tokens: 0,
      isOpen: true,
      group: null,
      at: 0,
      isViewed: false,
    }
    const fold = runFold(one.run)
    return [headLine, ...one.live.map((agent, at) => runningLine(agent, agent.row.description ?? '', true, fold, at)), ...doneLines(one)]
  }

  // `◉ ▾ verify ×5 0:40 · 2,1M` (its time and what its agents processed, as an agent's line says them),
  // its agents under it while open, each in its own line; an agent without a group alone; a running run.
  // Each line counts the agents it stands for, so a cut can say how many are left out.
  const liveRuns = view.runs.filter(one => one.isLive)
  const liveTokens = liveRuns.reduce((sum, one) => sum + one.whole.tokens, 0) + tokensOf(view.liveGroups.flatMap(group => group.members))
  const liveLines = entriesOf(liveRuns, view.liveGroups).flatMap((entry): CompactLine[] => {
    if (entry.run !== null) return runLines(entry.run)
    const { group } = entry
    const prefix = group.prefix
    if (prefix === null) return group.members.map(one => runningLine(one, one.row.description ?? '', false, null, 0))
    const fold = liveFold(prefix)
    const figures = groupFigures(ui, group.members, now)
    const isOpen = isGroupOpen(controls.folds, fold, 'compact')
    // Where the row has no room for its time, what its agents processed alone.
    const count = ` ×${group.members.length}`
    const headLine = groupHead(
      group.members,
      fold,
      liveStatus(group.members),
      restParts(prefix, [`${count} ${figures.time} · ${figures.processed}`, `${count} ${figures.processed}`], 'text', width),
      width,
      { agents: isOpen ? 0 : group.members.length, isRun: false, tokens: 0 },
    )
    if (!isOpen) return [headLine]
    return [headLine, ...group.members.map((one, at) => runningLine(one, prefixOf(one.row.description ?? '')?.rest ?? '', true, fold, at))]
  })

  // `✓ ▸ review-changes ×9 6:12 · 14M` for a finished run, its agents under it once opened, in the order its script started them.
  const endedLines = entriesOf(endedRuns, view.groups).flatMap((entry): CompactLine[] => {
    if (entry.run !== null) {
      const one = entry.run
      const fold = runFold(one.run)
      const figures = runFigures(ui, one.whole)
      const count = ` ×${one.agents}${brokenNote(one)}`
      const color = isBroken(one.status) ? theme.accent : 'text'
      const words = runName(ui, one.run)
      const partsOf = isCell
        ? cellParts(words, count, color, figures)
        : restParts(words, [`${count} ${figures.time} · ${figures.processed}`, `${count} ${figures.processed}`], color, endedWidth)
      const headLine = groupHead(one.ended, fold, one.status, partsOf, endedWidth, { agents: 0, isRun: true, tokens: one.whole.tokens })
      if (!headLine.isOpen) return [headLine]
      const members = one.ended.map((agent, at) =>
        lineOf(agentLine(agent, memberLead(agent, 4), agent.row.description ?? '', endedWidth, isCell), agent, fold, at, { agents: 0 }),
      )
      return [{ ...headLine, tail: tailOf(one.agents - one.ended.length, 4, endedWidth) }, ...members]
    }
    const { group } = entry
    const prefix = group.prefix
    if (prefix === null) {
      return group.members.map(one =>
        lineOf(agentLine(one, [glyphPart(ui, one.status), gap(1)], one.row.description ?? '', endedWidth, isCell), one, null, 0, { tokens: tokensOf([one]) }),
      )
    }
    const status = groupStatus(group.members)
    const color = isBroken(status) ? theme.accent : 'text'
    const isOpen = isGroupOpen(controls.folds, prefix, 'compact')
    const count = ` ×${group.members.length}`
    const partsOf = isCell
      ? cellParts(prefix, count, color, groupFigures(ui, group.members, now))
      : restParts(prefix, [`${count} ${groupProcessed(ui, group.members)}`], color, endedWidth)
    const headLine = groupHead(group.members, prefix, status, partsOf, endedWidth, {
      agents: isOpen ? 0 : group.members.length,
      isRun: false,
      tokens: tokensOf(group.members),
    })
    if (!isOpen) return [headLine]
    const members = group.members.map((one, at) =>
      lineOf(agentLine(one, memberLead(one, 4), prefixOf(one.row.description ?? '')?.rest ?? '', endedWidth, isCell), one, prefix, at),
    )
    // In two columns an opened group's agents that the rows do not hold are counted under them too.
    return [isCell ? { ...headLine, tail: tailOf(0, 4, endedWidth) } : headLine, ...members]
  })

  // The head always; then the running agents and the finished in the rows left.
  return (
    <Box flexDirection="column" paddingX={1}>
      {head}
      {cutLines(ui, view, liveLines, endedLines, Math.max(0, room - 1), cell, liveTokens, width)}
    </Box>
  )
}

/**
 * While an agent's transcript is in the main view: on top, the Button back
 * to the main chat in the accent, naming the agent, and under it, dim, that
 * the prompt's Enter goes to that agent now.
 */
function viewingRows(ui: Ui, board: AgentBoard, controls: AgentsControls): Drawn | null {
  const { Box, Button, Text, theme, s } = ui
  if (controls.viewed === null) return null
  const width = Math.max(8, ui.width - 2)
  const name = board.rows.find(row => row.id === controls.viewed)?.description ?? s.agents.someAgent
  // The name gives way first; in a pane too narrow for a word of it, the sentence.
  const nameRoom = width - cellsOf(s.agents.back(''))
  const label = nameRoom >= 6 ? s.agents.back(cutCells(name, nameRoom)) : cutCells(s.agents.back(name), width)
  return {
    element: (
      <Box flexDirection="column" paddingX={1}>
        <Button key={MAIN_CHAT_KEY} plain onPress={() => controls.onView(null)}>
          <Text color={theme.accent} wrap="truncate-end">
            {label}
          </Text>
        </Button>
        <Text dimColor>{s.agents.backNote}</Text>
      </Box>
    ),
    rows: 1 + wrappedRows(s.agents.backNote, width),
  }
}

/**
 * The least the full card is shortened to fit `left` rows: the four steps,
 * then the oldest finished runs into the older line one by one, the newest
 * kept; undefined where even that leaves it too tall, and the compact view,
 * which has more lines in the rows, shows the runs instead.
 */
function fittingOf(ui: Ui, board: AgentBoard, controls: AgentsControls, left: number): { shortening: Shortening; trim: number } | undefined {
  const fits = (shortening: Shortening, trim: number) => agentsLarge(ui, board, controls, shortening, trim).rows <= left
  const step = SHORTENINGS.find(shortening => fits(shortening, 0))
  if (step !== undefined) return { shortening: step, trim: 0 }
  const finished = agentsViewOf(board).runs.filter(one => !one.isLive).length
  for (let trim = 1; trim < finished; trim += 1) if (fits(3, trim)) return { shortening: 3, trim }
  return undefined
}

/**
 * The Agents tab: while an agent is in the main view the way back on top;
 * then the full card where the pane's `room` has the rows for it, else the
 * full card shortened as little as fits (Shortening), else the compact view.
 */
export function agentsCard(ui: Ui, board: AgentBoard, room: number | null, controls: AgentsControls): RenderElement {
  const { Box } = ui
  const viewing = viewingRows(ui, board, controls)
  const left = room === null ? null : room - (viewing?.rows ?? 0)
  // Whether a card fits is judged with its table closed and every group as the views show it at first:
  // opening the table or a press on a head never shortens the card or swaps in the compact view (a press
  // then shows what it opened), and the pane scrolls a card that runs past its rows.
  const judged = { ...controls, isProcessedOpen: false, folds: NO_FOLDS }
  const fitting = left === null ? { shortening: 0 as const, trim: 0 } : fittingOf(ui, board, judged, left)
  const shown = fitting === undefined ? agentsCompact(ui, board, left ?? 0, controls) : agentsLarge(ui, board, controls, fitting.shortening, fitting.trim).element
  if (viewing === null) return shown
  return (
    <Box flexDirection="column">
      {viewing.element}
      {shown}
    </Box>
  )
}

// ---------------------------------------------------------------- inline

/**
 * The body rows the pane asks for inline. The engine's frame fits the tree
 * there, so Live stays at the rows it needs; Changes and Agents may use them.
 */
export const INLINE_ROWS = 12

/** STATUS's cells beside CONTEXT: the limit's whole sentence. */
const INLINE_STATUS_COLUMNS = 34
/** Between the two columns. */
const INLINE_GAP = 2
/** The mini owl and the cell before it. */
const INLINE_OWL_COLUMNS = MINI_FINE_COLUMNS + 1
/** The cells CONTEXT keeps beside the owl. */
const INLINE_CONTEXT_MIN = 33
/**
 * The body's columns from which STATUS and CONTEXT stand side by side, 80
 * of the terminal's (the engine's frame takes 4). CONTEXT keeps its cells
 * beside the owl from here on, so wherever the two stand side by side the
 * owl has the width.
 */
export const INLINE_WIDE_MIN = INLINE_STATUS_COLUMNS + INLINE_OWL_COLUMNS + INLINE_GAP + INLINE_CONTEXT_MIN
/** The rows of the side-by-side block the owl needs: its own, and the titles' over them. */
const INLINE_OWL_BLOCK = MINI_FINE_ROWS + 1
/** Below these cells beside it the narrow view's bar takes the tokens' place, the share staying. */
const INLINE_BAR_MIN = 12
/** Below these cells for its words a plan step's count of the rest loses its word. */
const INLINE_STEP_MIN = 12
/** The row of cells the count of hidden rows keeps: a space and `+9`. */
const INLINE_NOTE_CELLS = 3

const DIM = { dimColor: true } as const
const BOLD = { bold: true } as const
const DOTS: Part = { text: ' · ', ...DIM }

/** What an inline tab draws under the title row, and how many of its rows found no room. */
export type InlineBody = { rows: RenderChildren; hidden: number }

/** The cell after the title: the probe's where it is drawn. */
const INLINE_SLOT = 1
const tabCells = (s: Strings) => tabsOf(s).reduce((sum, one) => sum + one.label.length + 2, 0)

/**
 * Rows the title row takes: one, until the tabs and the count of hidden rows
 * no longer fit (a terminal under 31 columns), so the count always has a place.
 */
export function titleRowsOf(ui: Ui): number {
  let rows = 1
  let used = INLINE_SLOT
  for (const cells of [...tabsOf(ui.s).map(one => one.label.length + 2), INLINE_NOTE_CELLS]) {
    if (used + cells > ui.width) {
      rows += 1
      used = 0
    }
    used += cells
  }
  return rows
}

/**
 * The pane seated inline above the prompt: under 110 columns in the
 * fullscreen layout, always on the main screen. The engine draws the one
 * frame there. `noxdeck` and the tabs share a row, then the tab's rows. A
 * count of what found no room stands at that row's end; where it does not
 * fit, `noxdeck` gives way, then its word. A probe (`probe`), where given,
 * sits in the cell after the title: a picture of one transparent pixel, its
 * alt a blank.
 */
export function inlineFrame(ui: Ui, tab: Tab, onTab: (tab: Tab) => void, body: InlineBody, probe: ImageSource | null = null): RenderElement {
  const { Box, Text, theme, s } = ui
  const tabs = INLINE_SLOT + tabCells(s)
  const fits = (title: number, note: string) => title + tabs + (note === '' ? 0 : 1 + cellsOf(note)) <= ui.width
  const long = body.hidden > 0 ? s.hidden(body.hidden) : ''
  const note = fits(0, long) ? long : body.hidden > 0 ? `+${body.hidden}` : ''
  const title = 'noxdeck'
  const isTitled = fits(title.length, note)
  const used = tabs + (isTitled ? title.length : 0)
  return (
    <Box flexDirection="column" width={ui.width}>
      <Box flexWrap="wrap">
        {isTitled ? (
          <Text bold color={theme.accent}>
            {title}
          </Text>
        ) : null}
        {probe !== null && ui.Image !== null ? (
          <Box height={1} width={INLINE_SLOT}>
            <ui.Image key="probe" source={probe} columns={1} rows={1} alt=" " />
          </Box>
        ) : (
          <Text> </Text>
        )}
        {tabsOf(s).map(one => tabButton(ui, one, tab, onTab))}
        {note === '' ? null : <Text color={theme.accent}>{note.padStart(Math.max(ui.width - used, cellsOf(note) + 1))}</Text>}
      </Box>
      {body.rows}
    </Box>
  )
}

/** The state as an inline row says it, in the accent while the person is waited on. */
function moodPart(ui: Ui, view: StatusView, mood: Mood, room: number): Part {
  const text = moodWords(ui, mood, view.agentsAtWork, room, true)
  return isWaitedOn(mood) ? { text, color: ui.theme.accent } : { text, ...DIM }
}

/** Entries after `lead` while they fit with a count of the rest behind them; the first one cut where it does not fit alone. */
function countedRow(ui: Ui, lead: readonly Part[], entries: readonly (readonly Part[])[], width: number): RenderElement {
  const rest = (count: number): Part[] => (count > 0 ? [DOTS, { text: `+${count}`, ...DIM }] : [])
  let kept = [...lead]
  let shown = 0
  for (const entry of entries) {
    const next = [...kept, ...entry]
    if (widthOf([...next, ...rest(entries.length - shown - 1)]) > width) break
    kept = next
    shown += 1
  }
  if (shown > 0) return partsRow(ui, [...kept, ...rest(entries.length - shown)], width)
  const tail = rest(entries.length - 1)
  return partsRow(ui, [...fitted([...lead, ...(entries[0] ?? [])], width - widthOf(tail)), ...tail], width)
}

/** RADAR in one row: its card's rows, then its hotspots one by one, as many as fit, the rest counted. */
function radarLine(ui: Ui, view: RadarView, width: number): RenderElement {
  const { s } = ui
  const { radar, cues, now } = view
  const title: Part = { text: s.titles.radar, ...BOLD }
  const entries: Part[][] = repeatedOf(radar).map(failed => [DOTS, { text: s.radar.failedTimes(failed.count, failedLabel(s, failed)), ...DIM }])
  if (radar.errors > 0 && radar.lastError !== null) {
    entries.push([DOTS, { text: s.radar.errors(radar.errors, radar.lastError.tool, s.radar.ago(Math.max(0, now - radar.lastError.at))), color: 'text' }])
  }
  hotspotsOf(radar).forEach((one, i) => {
    const name: Part = { text: `${one.name} ${one.count}×`, color: 'text' }
    entries.push(i === 0 ? [DOTS, { text: `${s.radar.hotspots} `, ...DIM }, name] : [{ text: ', ', ...DIM }, name])
  })
  const waited = waitedOf(cues, now)
  if (cues.approvals > 0 || waited > 0) entries.push([DOTS, { text: s.radar.waited(duration(waited), cues.isWaitApprox, cues.approvals), color: 'text' }])
  if (entries.length === 0) return partsRow(ui, [title, DOTS, { text: s.radar.empty, ...DIM }], width)
  return countedRow(ui, [title], entries, width)
}

/** PLAN in one row: done of all, the first step in the plan's order, the others counted; the step's words give way first. */
function planLine(ui: Ui, plan: readonly PlanStep[], width: number): RenderElement {
  const { s } = ui
  const title: Part = { text: s.titles.plan, ...BOLD }
  const step = orderedPlan(plan)[0]
  if (step === undefined) return partsRow(ui, [title, DOTS, { text: s.plan.empty, ...DIM }], width)
  const { glyph, glyphColor, isDim, isBold } = stepLook(ui, step)
  const done = plan.filter(one => one.status === 'completed').length
  const lead: Part[] = [
    title,
    { text: ` ${done}/${plan.length}`, ...DIM },
    DOTS,
    { text: `${glyph} `, ...(glyphColor === null ? DIM : { color: glyphColor }), ...(isDim ? DIM : {}) },
  ]
  const others = plan.length - 1
  const tail = (text: string): Part[] => (others > 0 ? [DOTS, { text, ...DIM }] : [])
  const words = tail(s.plan.more(others))
  const rest = width - widthOf(lead) - widthOf(words) >= INLINE_STEP_MIN ? words : tail(`+${others}`)
  const label = cutCells(stepLabel(step), Math.max(1, width - widthOf(lead) - widthOf(rest)))
  return partsRow(ui, [...lead, { text: label, ...(isBold ? BOLD : {}), ...(isDim ? DIM : {}) }, ...rest], width)
}

/** The loop warning in one row, bold in the accent, the call's name cut so the count shows. */
function loopLine(ui: Ui, streak: FailStreak, width: number): RenderElement {
  const { theme, s } = ui
  const lead = `${s.radar.loop} `
  const count = ` (${streak.count}×)`
  const label = cutCells(labelText(s, streak), Math.max(1, width - cellsOf(lead) - cellsOf(count)))
  return partsRow(ui, [{ text: `${lead}${label}${count}`, color: theme.accent, ...BOLD }], width)
}

/** What Live draws inline. */
export type LiveInline = {
  status: StatusView
  context: ContextSnapshot | null
  usage: UsageTrack
  /** The plan's steps where the session has a todo tool; null: RADAR. */
  plan: readonly PlanStep[] | null
  cues: Cues
}

/** The bottom row: RADAR or PLAN, a loop warning in their place while a call fails again and again. */
function bottomLine(ui: Ui, view: LiveInline, width: number): { element: RenderElement; isLoop: boolean } {
  const { status, plan, cues } = view
  const loop = loopOf(status.radar)
  if (loop !== null) return { element: loopLine(ui, loop, width), isLoop: true }
  const element = plan === null ? radarLine(ui, { radar: status.radar, cues, now: status.now }, width) : planLine(ui, plan, width)
  return { element, isLoop: false }
}

/** The legend in one row: the largest shares first, `+N` for those that do not fit. */
function legendRowOf(ui: Ui, context: ContextSnapshot, width: number): RenderElement {
  const { theme } = ui
  const items = legendItemsOf(ui, context)
  const order = context.sources.map((source, i) => ({ source, item: items[i] })).sort((a, b) => b.source.tokens - a.source.tokens)
  const line = legendLine(order.flatMap(one => (one.item === undefined ? [] : [one.item])), width)
  const parts = order.slice(0, line.shown).flatMap(({ source, item }, n): Part[] => [
    ...(n === 0 ? [] : [gap(line.gap)]),
    { text: '● ', color: sourceColor(theme, source.key, source.color) },
    { text: `${item?.label ?? source.key} ${item?.value ?? ''}`, ...DIM },
  ])
  return partsRow(ui, line.cut > 0 ? [...parts, gap(line.gap), { text: `+${line.cut}`, ...DIM }] : parts, width)
}

/** CONTEXT beside STATUS: its title and fill, the bar, the legend, the growth, shorter only beside the owl and only where it must be. */
function contextRows(ui: Ui, context: ContextSnapshot | null, usage: UsageTrack, width: number, isBesideOwl: boolean): RenderElement[] {
  const { Box, Text, s } = ui
  const head = (counter: string) => (
    <Box justifyContent="space-between">
      <Text bold>{s.titles.context}</Text>
      <Text dimColor>{counter}</Text>
    </Box>
  )
  if (context === null) return [head(s.na), partsRow(ui, [{ text: s.context.notMeasured, ...DIM }], width)]
  const { perTurn, compactIn, short } = growthWords(ui, context, usage)
  const long = `${perTurn} · ${compactIn}`
  const growth = isBesideOwl && cellsOf(long) > width ? short : long
  return [
    head(contextCounter(ui, context).join(' · ')),
    contextBar(ui, context, width),
    legendRowOf(ui, context, width),
    partsRow(ui, [{ text: growth, ...DIM }], width),
  ]
}

/**
 * Live with STATUS and CONTEXT side by side, the bottom row under them, null
 * where the width or the rows do not hold that. The mini owl stands between
 * the two where the view brings pictures (the fullscreen layout, a terminal
 * that draws them) and the block has the rows for it.
 */
function liveWide(ui: Ui, view: LiveInline, room: number): (InlineBody & { hasOwl: boolean }) | null {
  const { Box, Text, s } = ui
  const { status, context, usage } = view
  const Picture = ui.Image
  const pictures = Picture === null ? null : status.pictures
  const reading = limitReading(ui, status)
  const statusRows = 2 + (status.limit === null ? 0 : 1) + (reading.reset === null ? 0 : 1)
  const blockRows = Math.max(statusRows, context === null ? 2 : 4)
  if (ui.width < INLINE_WIDE_MIN || blockRows + 1 > room) return null

  const hasOwl = Picture !== null && pictures !== null && blockRows >= INLINE_OWL_BLOCK
  const left = INLINE_STATUS_COLUMNS
  const right = ui.width - left - INLINE_GAP - (hasOwl ? INLINE_OWL_COLUMNS : 0)
  const title: Part = { text: s.titles.status, ...BOLD }
  const mood = moodPart(ui, status, hasOwl ? besideOwl(status) : status.mood, left - cellsOf(title.text) - cellsOf(DOTS.text))
  const sentence = ` ${reading.sentence}`
  const words = limitCells(ui, status.limitStyle) + cellsOf(sentence) <= left ? sentence : ` ${reading.leftText}`
  const block = (
    <Box>
      <Box flexDirection="column" flexShrink={0} width={left}>
        {partsRow(ui, [title, DOTS, mood], left)}
        {partsRow(ui, [editPart(ui, status.activity)], left)}
        {limitLineOf(ui, status, reading, words)}
        {reading.reset === null ? null : partsRow(ui, [{ text: reading.reset, ...DIM }], left)}
      </Box>
      {hasOwl ? (
        <Box flexDirection="column" flexShrink={0} marginLeft={1} marginTop={blockRows - MINI_FINE_ROWS} width={MINI_FINE_COLUMNS}>
          <Picture key="mini" source={pictures.mini} columns={MINI_FINE_COLUMNS} rows={MINI_FINE_ROWS} alt={s.status.noxAlt} />
        </Box>
      ) : null}
      <Box flexDirection="column" flexShrink={0} marginLeft={INLINE_GAP} width={right}>
        {contextRows(ui, context, usage, right, hasOwl)}
      </Box>
    </Box>
  )
  return { rows: [block, bottomLine(ui, view, ui.width).element], hidden: 0, hasOwl }
}

/** The bar and beside it the fill, the share alone where the tokens would leave the bar too little. */
function narrowBar(ui: Ui, context: ContextSnapshot, width: number): RenderElement {
  const { Box, Text } = ui
  const counter = contextCounter(ui, context)
  const joined = counter.join(' · ')
  const words = width - cellsOf(joined) - 1 >= INLINE_BAR_MIN ? joined : (counter[0] ?? '')
  return (
    <Box>
      {contextBar(ui, context, Math.max(1, width - cellsOf(words) - 1))}
      <Text dimColor>{` ${words}`}</Text>
    </Box>
  )
}

/**
 * Live in one column, what matters most: the state and the file, the limit
 * and its reset, the bar, the bottom row. Rows that find no room go from
 * the bottom and are counted, a loop warning staying while any row does.
 */
function liveNarrow(ui: Ui, view: LiveInline, room: number): InlineBody {
  const { s } = ui
  const { status, context } = view
  const width = ui.width
  const reading = limitReading(ui, status)
  const reset = reading.reset === null ? '' : ` · ${reading.reset}`
  const cells = limitCells(ui, status.limitStyle)
  // The share left is never cut: the sentence gives way first, then the reset.
  const words = [` ${reading.sentence}${reset}`, ` ${reading.leftText}${reset}`].find(one => cells + cellsOf(one) <= width) ?? ` ${reading.leftText}`
  const bottom = bottomLine(ui, view, width)
  const state = partsRow(ui, [moodPart(ui, status, status.mood, width), DOTS, editPart(ui, status.activity)], width)
  const limit = limitLineOf(ui, status, reading, words)
  const bar = context === null ? partsRow(ui, [{ text: s.context.notMeasured, ...DIM }], width) : narrowBar(ui, context, width)
  const rows = [state, limit, bar].filter(row => row !== null)
  const order = bottom.isLoop ? [bottom.element, ...rows] : [...rows, bottom.element]
  const kept = new Set(order.slice(0, Math.max(0, room)))
  return { rows: [...rows, bottom.element].filter(row => kept.has(row)), hidden: order.length - kept.size }
}

/** The Live tab inline: side by side where that fits, else in one column; `hasOwl`: the drawing holds the mini owl. */
export function liveInline(ui: Ui, view: LiveInline, room: number): InlineBody & { hasOwl: boolean } {
  return liveWide(ui, view, room) ?? { ...liveNarrow(ui, view, room), hasOwl: false }
}

/**
 * The Changes tab inline: the title and counter in a row, the files that
 * fit, the last row counting the rest; the lines on files without lines and
 * cache files in what is left, else in the title row's count.
 */
export function changesInline(ui: Ui, changes: readonly FileChange[], missed: number, cacheFiles: number, root: string, room: number): InlineBody {
  const { s } = ui
  if (room < 1) return { rows: [], hidden: 1 }
  const counter = changesCounter(ui, changes, missed)
  const title: Part = { text: s.titles.changes, ...BOLD }
  const head = partsRow(ui, counter === null ? [title, DOTS, { text: s.changes.empty, ...DIM }] : [title, gap(2), { text: counter.join(' · '), ...DIM }], ui.width)
  const lines = [...(missed > 0 ? [s.changes.missed(missed)] : []), ...(cacheFiles > 0 ? [s.changes.cacheFiles(cacheFiles)] : [])]
  const left = room - 1
  const isCut = changes.length > left
  const shown = isCut ? Math.max(0, left - 1) : changes.length
  const more = isCut && left > 0 ? [partsRow(ui, [{ text: s.changes.moreRows(changes.length - shown), ...DIM }], ui.width)] : []
  const kept = lines.slice(0, Math.max(0, left - shown - more.length))
  return {
    rows: [head, ...changes.slice(0, shown).map(change => changeRow(ui, change, root)), ...more, ...kept.map(line => partsRow(ui, [{ text: line, ...DIM }], ui.width))],
    hidden: lines.length - kept.length + (isCut && left < 1 ? changes.length : 0),
  }
}

/** The Agents tab inline: the compact view, the way back to the main chat over it while its rows leave one for the head. */
export function agentsInline(ui: Ui, board: AgentBoard, room: number, controls: AgentsControls): InlineBody {
  if (room < 1) return { rows: [], hidden: 1 }
  const viewing = viewingRows(ui, board, controls)
  if (viewing === null) return { rows: agentsCompact(ui, board, room, controls), hidden: 0 }
  if (viewing.rows >= room) return { rows: agentsCompact(ui, board, room, controls), hidden: 1 }
  return { rows: [viewing.element, agentsCompact(ui, board, room - viewing.rows, controls)], hidden: 0 }
}
