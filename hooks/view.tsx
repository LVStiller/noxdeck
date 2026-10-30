import type { Color, Elements, ImageSource, RenderChildren, RenderElement } from 'claude-code'

import type {
  Activity,
  AgentBoard,
  AgentFolds,
  AgentLedger,
  AgentRow,
  AgentWork,
  CallLabel,
  ContextSnapshot,
  Cues,
  FailStreak,
  FileChange,
  MiniPose,
  PlanStep,
  Pose,
  Radar,
  RateWindow,
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
  duration,
  flowParts,
  formatTokens,
  freshOf,
  groupsOf,
  growthOf,
  hasLimitReset,
  isAgentLive,
  isGroupOpen,
  isEndedStatus,
  legendLines,
  limitLeft,
  modelShort,
  NO_FOLDS,
  NO_TALLY,
  orderedPlan,
  potsOf,
  prefixOf,
  processedOf,
  projectPath,
  share,
  wholeTally,
} from './model'
import type { AgentGroup, FoldView, LegendItem } from './model'
import { hotspotsOf, loopOf, repeatedOf, resetClockOf, waitedOf } from './radar'
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

/**
 * The whole pane: a rounded frame with `noxdeck` in its top line, the tabs,
 * an empty line, then the cards stacked border to border. `ui.width` is the
 * cards' width. A probe (`probe`), where given, sits in the empty line's
 * first cell: a picture of one transparent pixel, its alt a blank, so the
 * line looks empty whether or not the terminal draws pictures.
 */
export function frame(ui: Ui, tab: Tab, onTab: (tab: Tab) => void, body: RenderChildren, probe: ImageSource | null = null): RenderElement {
  const { Box, Text, Button, theme, s } = ui
  const width = ui.width + PANE_INSET
  const isTerminal = ui.surface === 'terminal'
  const tabs: readonly { id: Tab; label: string }[] = [
    { id: 'changes', label: s.tabs.changes },
    { id: 'agents', label: s.tabs.agents },
    { id: 'live', label: s.tabs.live },
  ]
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="column" borderStyle="round" borderColor={theme.frame} paddingX={1} width={width}>
        {isTerminal ? null : (
          <Text bold color={theme.accent}>
            noxdeck
          </Text>
        )}
        <Box flexWrap="wrap" columnGap={1}>
          {tabs.map(one => (
            <Button key={`tab-${one.id}`} label={one.label} plain onPress={() => onTab(one.id)}>
              {one.id === tab ? (
                <Text bold color={theme.onAccent} backgroundColor={theme.accent}>{` ${one.label} `}</Text>
              ) : (
                <Text dimColor>{` ${one.label} `}</Text>
              )}
            </Button>
          ))}
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
  // The steps are Claude's own words; masked all the same, as RADAR's are.
  const labelOf = (step: PlanStep) => maskSecrets(step.status === 'in_progress' ? (step.activeText ?? step.text) : step.text)

  const row = (step: PlanStep) => {
    const [glyph, glyphColor, label, isDim, isBold] =
      step.status === 'in_progress'
        ? (['◉', theme.accent, labelOf(step), false, true] as const)
        : step.status === 'pending'
          ? (['○', null, labelOf(step), false, false] as const)
          : (['✓', theme.done, labelOf(step), true, false] as const)
    return (
      <Box>
        <Text {...styled(glyphColor, null)} dimColor={glyphColor === null || isDim}>
          {`${glyph} `}
        </Text>
        <Box flexShrink={1}>
          <Text bold={isBold} dimColor={isDim}>
            {label}
          </Text>
        </Box>
      </Box>
    )
  }
  const stepRows = steps.map(step => wrappedRows(labelOf(step), inner(ui) - 2))
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
    const label = failed.tool === 'Bash' && failed.detail !== null ? failed.detail : labelText(s, failed)
    rows.push(
      <Text dimColor wrap="truncate-end">
        {s.radar.failedTimes(failed.count, label)}
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

export function contextCard(ui: Ui, context: ContextSnapshot | null, usage: UsageTrack): Drawn {
  const { Box, Text, theme, s } = ui
  if (context === null) return card(ui, s.titles.context, [s.na], <Text dimColor>{s.context.notMeasured}</Text>, 1)

  const width = inner(ui)
  // One window for the whole card: header, bar, legend, mark and history agree.
  const max = context.window
  const exact = context.exact
  // Measured figures are written plainly; the breakdown's estimates carry ≈.
  const counter = exact
    ? [s.percent(Math.round(exact.percent)), `${tokens(ui, exact.tokens)} / ${tokens(ui, exact.window)}`]
    : [`≈${s.percent(Math.round((context.totalTokens / max) * 100))}`, `≈${tokens(ui, context.totalTokens)} / ${tokens(ui, max)}`]

  // The bar: full cells, one run per source (each at least one cell), the
  // free window a quiet dark grey, and a fine mark at the auto-compact threshold.
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

  // Every share is the breakdown's estimate: ≈ on each.
  const items: LegendItem[] = context.sources.map(source => ({
    key: source.key,
    label: s.sources[source.key as SourceKey] ?? source.key,
    short: s.sourcesShort[source.key as SourceKey] ?? source.key,
    value: `≈${share(source.tokens, max, s.percent, s.decimal, s.na)}`,
    compact: `≈${share(source.tokens, max, s.percentTight, s.decimal, s.na)}`,
  }))
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
  const current = exact?.tokens ?? context.totalTokens
  const growth = growthOf(usage.history, current, context.threshold)
  const perTurn =
    growth.perTurn === null
      ? s.context.perTurnNA
      : s.context.perTurn(`${growth.perTurn < 0 ? '−' : '+'}${tokens(ui, Math.abs(growth.perTurn))}`)
  const compactIn =
    context.threshold === null
      ? s.context.compactOff
      : current >= context.threshold
        ? s.context.compactDue
        : growth.turnsLeft === null
          ? s.context.compactNA
          : s.context.compactIn(growth.turnsLeft)

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
    <Text wrap="truncate">
      {runsOf(cells).map(run => (
        <Text {...styled(run.color, run.backgroundColor)}>{run.char}</Text>
      ))}
    </Text>,
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

/** How the 5h limit is drawn: five hearts, or the ten-cell bar (the `limitStyle` option). */
export type LimitStyle = 'hearts' | 'bar'

/** What STATUS shows: the file edited, the 5h limit and its reset, the loop warning, Nox (or the mini owl) and its state. */
export type StatusView = {
  activity: Activity
  fiveHour: RateWindow | null
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

/**
 * The STATUS card, at the top of the Live tab. While a call fails again and
 * again its warning comes first, so it never leaves the visible rows; then
 * the file edited, the 5h limit and its reset time. With Nox (`owl` nox)
 * or none, the state follows as a caption under them, in the accent while
 * the person is waited on; the mini owl sits beside them instead, cutting
 * them sooner, and the state moves into the title. Where the view brings
 * pictures and the surface draws them, either owl is one keyed `Image`
 * (Nox 16 × 8 cells, the mini owl 6 × 3) that the tick swaps; else the
 * block characters.
 */
export function statusCard(ui: Ui, view: StatusView, owl: Owl): Drawn {
  const { Box, Text, theme, s } = ui
  const { activity, fiveHour, mood, agentsAtWork, pose, miniPose, now, limitStyle } = view
  const Picture = ui.Image
  const pictures = Picture === null ? null : view.pictures
  const miniColumns = pictures === null ? MINI_COLUMNS : MINI_FINE_COLUMNS
  /** The cells the lines beside the owl have. */
  const room = owl === 'mini' ? inner(ui) - miniColumns - 1 : inner(ui)

  const loop = loopOf(view.radar)
  const warning = loop === null ? [] : loopRows(ui, loop)

  const editing =
    activity.editing !== null ? (
      <Text bold color={theme.accent} wrap="truncate-end">
        {s.status.editing(maskSecrets(baseName(activity.editing)))}
      </Text>
    ) : activity.lastEdited !== null ? (
      <Text dimColor wrap="truncate-end">
        {s.status.lastEdit(maskSecrets(baseName(activity.lastEdited)))}
      </Text>
    ) : (
      <Text dimColor wrap="truncate-end">
        {s.status.noEdits}
      </Text>
    )

  // The reading is the last response's; once its window's reset time has
  // passed it no longer stands, and the card says so instead of showing it.
  const hasReset = hasLimitReset(fiveHour, now)
  const left = limitLeft(fiveHour, now)
  const leftText = left !== null && left > 0 && left < 0.5 ? `<${s.percent(1)}` : s.percent(Math.round(left ?? 0))
  const hearts = theme.limitHearts
  const cells = limitStyle === 'hearts' ? 5 : theme.limitBar.cells
  const full = left === null ? 0 : cellsFull(left, cells)
  // The share left is never cut: where the sentence does not fit, the number alone follows the cells.
  const sentence = ` ${s.status.limit(leftText)}`
  const drawnCells = limitStyle === 'hearts' ? 2 * cells : cells
  const words = drawnCells + sentence.length <= room ? sentence : ` ${leftText}`
  const limit =
    left === null ? (
      <Text dimColor wrap="truncate-end">
        {hasReset ? s.status.limitReset : s.status.limitNA}
      </Text>
    ) : limitStyle === 'hearts' ? (
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
  // Under the limit, when the window resets: only while its reading stands.
  const resetTime = left === null ? null : resetClockOf(fiveHour?.resetsAt ?? null)
  const reset =
    resetTime === null ? null : (
      <Text dimColor wrap="truncate-end">
        {s.status.resetAt(resetTime)}
      </Text>
    )

  const lines = [editing, limit, reset].filter(line => line !== null)

  if (owl === 'mini') {
    // `fertig` while it hops, then `bereit`: the caption's 30 s are Nox's.
    const answered = activity.answeredAt === null ? Number.POSITIVE_INFINITY : now - activity.answeredAt
    const state = mood === 'done' && answered >= HOP_MS ? 'ready' : mood
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

export function changesCard(ui: Ui, changes: readonly FileChange[], missed: number, cacheFiles: number, root: string): RenderElement {
  const { Text, theme, s } = ui
  const known = changes.filter(change => change.added !== null && change.removed !== null)
  const added = known.reduce((total, change) => total + (change.added ?? 0), 0)
  const removed = known.reduce((total, change) => total + (change.removed ?? 0), 0)
  const files = changes.length + missed
  const isPartial = known.length < changes.length || missed > 0
  const counter = files === 0 ? null : s.changes.counter(files, added, removed, isPartial)

  const row = (change: FileChange) =>
    spread(
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
  agents: ShownAgent[]
  /** Running and waiting agents grouped as the finished are, in both views. */
  liveGroups: AgentGroup<ShownAgent>[]
  groups: AgentGroup<ShownAgent>[]
  counts: AgentTally
  /** The type most agents have; an agent of another shows its own. */
  common: string | null
}

const inStartOrder = (a: ShownAgent, b: ShownAgent) => a.row.firstSeen - b.row.firstSeen

function agentsViewOf(board: AgentBoard): AgentsView {
  const agents = shownAgents(board)
  // Running and waiting agents and the finished, each grouped by their description's prefix,
  // the newest group first, its agents in start order.
  const live = agents.filter(one => !one.isEnded)
  const byPrefix = (list: readonly ShownAgent[]) => groupsOf([...list].sort(inStartOrder), one => one.row.description ?? '').reverse()
  return {
    agents,
    liveGroups: byPrefix(live),
    groups: byPrefix(agents.filter(one => one.isEnded)),
    counts: agentTallyOf(agents),
    common: commonType(agents.map(one => one.row.type)),
  }
}

/** The odd type an agent shows: its own where it differs from the type most agents have. */
const oddType = (view: AgentsView, row: AgentRow) => (row.type !== null && row.type !== view.common ? row.type : null)

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
 * processed and how long, each as wide as its widest figure, a group's
 * included; a bar of 10 or 6 cells where the rows have the room for it.
 */
function columnsOf(ui: Ui, view: AgentsView, now: number): Columns {
  const figures = [
    ...view.agents.map(one => ({ processed: processedText(ui, one.work), time: elapsedText(one.row, now) })),
    ...[...view.liveGroups, ...view.groups].filter(group => group.prefix !== null).map(group => groupFigures(ui, group.members, now)),
  ]
  const processed = Math.max(1, ...figures.map(one => one.processed.length))
  const time = Math.max(1, ...figures.map(one => one.time.length))
  const free = inner(ui) - 2 - (processed + 1 + time) - 1
  return { bar: free >= 26 ? 10 : free >= 18 ? 6 : 0, processed, time }
}

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
const liveFold = (prefix: string) => `live:${prefix}`

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
 * by the rest of its name). The call gives way first, then the name; in
 * the narrowest pane the indent, then the time, never what it processed.
 * The compact view's line, and the full card's where it is shortened to fit.
 */
function liveLine(ui: Ui, one: ShownAgent, name: string, isMember: boolean, width: number, now: number, controls: AgentsControls): RenderElement {
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
  return pressRow(ui, one.row.id, parts, width, controls.viewed === one.row.id, pressOf(one.row, controls))
}

/**
 * The running agents, grouped as the finished are: a group's head (`◉ ▾
 * verify ×5` on the accent, ▸ while closed; what its agents processed, white
 * and bold, and the time since its first start in the accent) the person
 * presses to close or open it, its agents under it while open, each by the
 * rest of its name; an agent without a group alone, by its whole name. Each
 * agent in up to four lines, a dim ┄ between them; `isOneLine` (the card
 * shortened to fit the pane) in one line each, no ┄.
 */
function liveRows(ui: Ui, view: AgentsView, cols: Columns, now: number, controls: AgentsControls, isOneLine: boolean): RenderElement[] {
  const { theme } = ui
  const width = inner(ui)
  const agentRows = (one: ShownAgent, name: string, isMember: boolean) =>
    isOneLine ? [liveLine(ui, one, name, isMember, width, now, controls)] : liveBlock(ui, one, name, isMember, view, cols, now, controls)
  const blocks = view.liveGroups.flatMap((group): RenderElement[][] => {
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
 * The finished agents: a head per group (✓ ▾ prüfen ×4) the person presses
 * to close or open it, its agents under it while open; an agent without a
 * group alone. Every agent's row is pressed to see its transcript.
 * `isFolded` (the card shortened to fit the pane): the groups closed as in
 * the compact view, those the person opened there open, a press turning
 * them there.
 */
function endedRows(ui: Ui, view: AgentsView, cols: Columns, now: number, controls: AgentsControls, isFolded: boolean): RenderElement[] {
  const { theme, s } = ui
  const width = inner(ui)
  if (view.groups.length === 0) return []

  // Every bar against the agent that processed most, running ones included.
  const largest = Math.max(1, ...view.agents.map(one => processedOf(wholeTally(one.work) ?? NO_TALLY)))

  /** The bar, or a failed or stopped agent's errors in the accent; beside the name where the slot is too small. */
  const slotOf = (one: ShownAgent, isMember: boolean): { slot: Part[]; beside: string | null } => {
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

  const agentRow = (one: ShownAgent, name: string, isMember: boolean) => {
    const { slot, beside } = slotOf(one, isMember)
    // A group's agents stand under its name, past the glyph and the fold mark.
    const lead = isMember ? [gap(4)] : [glyphPart(ui, one.status), gap(1)]
    const after: Part[] = beside === null ? [] : [{ text: ` · ${beside}`, color: theme.accent }]
    const label = (room: number) => labelOf({ text: name, color: isBroken(one.status) ? theme.accent : 'text' }, oddType(view, one.row), after, room)
    const parts = workParts(lead, label, slot, cols.bar, endedFigures(cols, processedText(ui, one.work), elapsedText(one.row, now)), width)
    return pressRow(ui, one.row.id, parts, width, controls.viewed === one.row.id, pressOf(one.row, controls))
  }

  return view.groups.flatMap(group => {
    const prefix = group.prefix
    if (prefix === null) return group.members.map(one => agentRow(one, one.row.description ?? '', false))
    const status = groupStatus(group.members)
    const foldView: FoldView = isFolded ? 'compact' : 'large'
    const isOpen = isGroupOpen(controls.folds, prefix, foldView)
    const name: Part = { text: `${prefix} ×${group.members.length}`, bold: true, color: isBroken(status) ? theme.accent : 'text' }
    const figures = groupFigures(ui, group.members, now)
    const parts = workParts(foldLead(ui, status, isOpen), () => [name], [], cols.bar, endedFigures(cols, figures.processed, figures.time), width)
    const head = pressRow(ui, groupKey(prefix), parts, width, !isOpen && holdsViewed(group.members, controls), () => controls.onFold(prefix, foldView))
    if (!isOpen) return [head]
    return [head, ...group.members.map(one => agentRow(one, prefixOf(one.row.description ?? '')?.rest ?? '', true))]
  })
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
  const chronological = [...view.agents].sort((a, b) => a.row.firstSeen - b.row.firstSeen)
  const bars = groupsOf(chronological, one => one.row.description ?? '').flatMap(group => {
    const span = spanOf(group.members, now)
    if (span === null) return []
    const label = group.prefix ?? group.members[0]?.row.description ?? ''
    return [{ label, span, isLive: group.members.some(one => !one.isEnded), status: groupStatus(group.members) }]
  })
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
 * 3 no timeline. Where even that does not fit, the compact view.
 */
export type Shortening = 0 | 1 | 2 | 3

const SHORTENINGS: readonly Shortening[] = [0, 1, 2, 3]

/**
 * The Agents card at its full size: the head, what each pot processed since
 * load (or their table), the running agents in up to four lines each and
 * the finished ones, both by group, their figures in the same columns, a
 * rule between them; the timeline, and what `verarbeitet` means. Shortened
 * as `shortening` says.
 */
export function agentsLarge(ui: Ui, board: AgentBoard, controls: AgentsControls, shortening: Shortening = 0): Drawn {
  const { s } = ui
  const width = inner(ui)
  const { now, ledger } = board
  const view = agentsViewOf(board)
  const cols = columnsOf(ui, view, now)

  const processed = processedRows(ui, ledger, controls)
  const empty = view.agents.length === 0 ? dimLines(ui, s.agents.empty, width) : []
  const live = liveRows(ui, view, cols, now, controls, shortening >= 1)
  const ended = endedRows(ui, view, cols, now, controls, shortening >= 2)
  const between = live.length > 0 && ended.length > 0 ? [ruleRow(ui, '─', width)] : []
  const timeline = shortening >= 3 ? [] : timelineRows(ui, view, ledger.since, now)
  // The footer broken into rows of its own: in a narrow pane it wraps, never past the frame.
  const body = [...processed, ...empty, ...live, ...between, ...ended, ...timeline, ...dimLines(ui, s.agents.note, width)]
  return card(ui, s.titles.agents, view.agents.length === 0 ? null : s.agents.counter(view.counts), body, body.length)
}

/**
 * A line of the compact view: a group's head, an agent without a group, or
 * an agent under an open head (`at` its place there); how many agents it
 * stands for (a closed group's all, an open one's head none), its group's
 * fold, and whether it is the agent in the main view. An open head holding
 * that agent keeps itself drawn marked, for when the agent's line is left out.
 */
type CompactLine = {
  element: RenderElement
  kind: 'head' | 'agent' | 'member'
  agents: number
  group: string | null
  at: number
  isViewed: boolean
  marked?: RenderElement
}

/**
 * The running and the finished lines in `room` rows: all where they fit;
 * else lines left out until they do, the rest each in its place, a line
 * after the running and one after the finished counting the agents left out
 * there (`+3 ◉`, `+5 ✓`). The agents under open heads but their first give
 * way first, evenly (each group's last first), then the agents without a
 * group, then each open group's first, then the agent in the main view,
 * then the count lines, the heads last; within each the finished before
 * the running, the lowest first. So every head stays while the rows hold
 * the heads, an opened group shows its first agent while they hold one more
 * and the counts, and an open head whose agent in the main view was left
 * out is marked in its place.
 */
function cutLines(ui: Ui, live: readonly CompactLine[], ended: readonly CompactLine[], room: number): RenderElement[] {
  const { Text, s } = ui
  const left = new Set<CompactLine>()
  const isCounted = { live: true, ended: true }
  const isCut = (lines: readonly CompactLine[]) => lines.some(line => left.has(line))
  const rows = () => live.length + ended.length - left.size + (isCut(live) && isCounted.live ? 1 : 0) + (isCut(ended) && isCounted.ended ? 1 : 0)
  const lowestFirst = (keep: (line: CompactLine) => boolean) => [...live, ...ended].filter(keep).reverse()
  const isMember = (line: CompactLine) => line.kind === 'member' && !line.isViewed
  const leave = (line: CompactLine) => () => void left.add(line)
  const steps = [
    ...lowestFirst(line => isMember(line) && line.at > 0)
      .sort((a, b) => b.at - a.at)
      .map(leave),
    ...lowestFirst(line => line.kind === 'agent' && !line.isViewed).map(leave),
    ...lowestFirst(line => isMember(line) && line.at === 0).map(leave),
    ...lowestFirst(line => line.kind !== 'head' && line.isViewed).map(leave),
    () => void (isCounted.ended = false),
    () => void (isCounted.live = false),
    ...lowestFirst(line => line.kind === 'head').map(leave),
  ]
  for (const step of steps) {
    if (rows() <= room) break
    step()
  }
  const unseen = new Set([...live, ...ended].filter(line => line.isViewed && left.has(line)).map(line => line.group))
  const shown = (lines: readonly CompactLine[], glyph: string) => {
    const hidden = lines.filter(line => left.has(line)).reduce((sum, line) => sum + line.agents, 0)
    const counted = isCut(lines) && (glyph === '◉' ? isCounted.live : isCounted.ended) ? [<Text dimColor>{`${s.agents.more(hidden)} ${glyph}`}</Text>] : []
    const drawn = lines.filter(line => !left.has(line)).map(line => (line.marked !== undefined && unseen.has(line.group) ? line.marked : line.element))
    return [...drawn, ...counted]
  }
  // In a pane with no row even for the counts, those that fit.
  return [...shown(live, '◉'), ...shown(ended, '✓')].slice(0, Math.max(0, room))
}

/**
 * The Agents card where the pane is short, with no frame: the head in one
 * line, the running agents, then the finished in the rows left: a line per
 * group, closed until the person opens it, and per agent without one; a
 * running agent's line its own (`◉ review diff 1:23 · 1,1M → Read
 * model.ts`), a group's `◉ ▸ verify ×5 0:40 · 2,1M`. What does not fit is
 * counted in a line, the running and the finished apart.
 */
export function agentsCompact(ui: Ui, board: AgentBoard, room: number, controls: AgentsControls): RenderElement {
  const { Box, Text, theme, s } = ui
  const width = Math.max(8, ui.width - 2)
  const { now, ledger } = board
  const view = agentsViewOf(board)

  const head =
    view.agents.length === 0 ? (
      <Text wrap="truncate-end">
        <Text bold>{s.titles.agents}</Text>
        <Text dimColor>{` · ${s.agents.empty}`}</Text>
      </Text>
    ) : (
      <Text wrap="truncate-end">
        <Text bold>{s.titles.agents}</Text>
        <Text dimColor>{` ${s.agents.compactCounter(view.counts, tokens(ui, processedOf(potsOf(ledger).agents))).join(' · ')}`}</Text>
      </Text>
    )

  /**
   * A group's head, pressed to open or close it: its glyph and fold mark,
   * its words, then the first of `rests` (its count and figures, longest
   * first) the row has room for with a few cells of the words; the words cut to
   * the room left, never the count or what was processed. Marked while
   * closed holding the agent in the main view.
   */
  const groupHead = (group: AgentGroup<ShownAgent>, fold: string, status: string, rests: readonly string[], color: Color): CompactLine => {
    const isOpen = isGroupOpen(controls.folds, fold, 'compact')
    const lead = foldLead(ui, status, isOpen)
    // A rest is kept where a few cells of the words fit beside it, else the next.
    const least = Math.min(cellsOf(group.prefix ?? ''), 4)
    const rest = rests.find(one => widthOf(lead) + least + cellsOf(one) <= width) ?? rests.at(-1) ?? ''
    const words = cutCells(group.prefix ?? '', Math.max(1, width - widthOf(lead) - cellsOf(rest)))
    const drawn = (isMarked: boolean) =>
      pressRow(ui, groupKey(fold), [...lead, { text: `${words}${rest}`, color }], width, isMarked, () => controls.onFold(fold, 'compact'))
    const isHolding = holdsViewed(group.members, controls)
    return {
      element: drawn(!isOpen && isHolding),
      kind: 'head',
      agents: isOpen ? 0 : group.members.length,
      group: fold,
      at: 0,
      isViewed: false,
      ...(isOpen && isHolding ? { marked: drawn(true) } : {}),
    }
  }
  const lineOf = (element: RenderElement, one: ShownAgent, group: string | null, at: number): CompactLine => ({
    element,
    kind: group === null ? 'agent' : 'member',
    agents: 1,
    group,
    at,
    isViewed: controls.viewed === one.row.id,
  })

  // `◉ ▸ verify ×5 0:40 · 2,1M` (its time and what its agents processed, as an agent's line says them),
  // its agents under it once opened, each in its own line; an agent without a group alone.
  // Each line counts the agents it stands for, so a cut can say how many are left out.
  const liveLines = view.liveGroups.flatMap((group): CompactLine[] => {
    const prefix = group.prefix
    if (prefix === null) return group.members.map(one => lineOf(liveLine(ui, one, one.row.description ?? '', false, width, now, controls), one, null, 0))
    const fold = liveFold(prefix)
    const figures = groupFigures(ui, group.members, now)
    // Where the row has no room for its time, what its agents processed alone.
    const count = ` ×${group.members.length}`
    const headLine = groupHead(group, fold, liveStatus(group.members), [`${count} ${figures.time} · ${figures.processed}`, `${count} ${figures.processed}`], 'text')
    if (!isGroupOpen(controls.folds, fold, 'compact')) return [headLine]
    const members = group.members.map((one, at) =>
      lineOf(liveLine(ui, one, prefixOf(one.row.description ?? '')?.rest ?? '', true, width, now, controls), one, fold, at),
    )
    return [headLine, ...members]
  })

  // `✓ ▸ prüfen ×4 4,6M`, its agents under it once opened; `✓ review diff 1,2M` for an agent without a group.
  const agentLine = (one: ShownAgent, lead: readonly Part[], name: string) => {
    const color = isBroken(one.status) ? theme.accent : 'text'
    // The name cut to the room beside what it processed, never the figure.
    const processed = processedText(ui, one.work)
    const shown = cutCells(name, Math.max(0, width - widthOf(lead) - 1 - cellsOf(processed)))
    const parts: Part[] = [...lead, { text: `${shown}${shown === '' ? '' : ' '}${processed}`, color }]
    return pressRow(ui, one.row.id, parts, width, controls.viewed === one.row.id, pressOf(one.row, controls))
  }
  const endedLines = view.groups.flatMap((group): CompactLine[] => {
    const prefix = group.prefix
    if (prefix === null) return group.members.map(one => lineOf(agentLine(one, [glyphPart(ui, one.status), gap(1)], one.row.description ?? ''), one, null, 0))
    const status = groupStatus(group.members)
    const headLine = groupHead(group, prefix, status, [` ×${group.members.length} ${groupProcessed(ui, group.members)}`], isBroken(status) ? theme.accent : 'text')
    if (!isGroupOpen(controls.folds, prefix, 'compact')) return [headLine]
    const members = group.members.map((one, at) => {
      const lead = isBroken(one.status) ? [gap(4), { text: `${GLYPH[one.status]} `, color: theme.accent }] : [gap(4)]
      return lineOf(agentLine(one, lead, prefixOf(one.row.description ?? '')?.rest ?? ''), one, prefix, at)
    })
    return [headLine, ...members]
  })

  // The head always; then the running agents and the finished in the rows left.
  return (
    <Box flexDirection="column" paddingX={1}>
      {head}
      {cutLines(ui, liveLines, endedLines, Math.max(0, room - 1))}
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
  const fitting = left === null ? 0 : SHORTENINGS.find(shortening => agentsLarge(ui, board, judged, shortening).rows <= left)
  const shown = fitting === undefined ? agentsCompact(ui, board, left ?? 0, controls) : agentsLarge(ui, board, controls, fitting).element
  if (viewing === null) return shown
  return (
    <Box flexDirection="column">
      {viewing.element}
      {shown}
    </Box>
  )
}
