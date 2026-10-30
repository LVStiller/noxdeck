import type { SessionContextBreakdown, SessionContextUsage, SessionRateLimit, TurnUsage } from 'claude-code'

import type {
  AgentFolds,
  AgentLedger,
  AgentRow,
  AgentWork,
  ContextSample,
  ContextSnapshot,
  ExactFill,
  FileChange,
  HiddenFiles,
  PlanStep,
  RateWindow,
  StepStatus,
  TokenTally,
} from '../types'
import type { SourceKey } from './themes'

// Pure functions over the engine's records: no `$`, so the tests and the
// hooks share them. Tool records arrive as unknown data and are read with
// guards, never trusted to hold a field the tool may leave out.

type Loose = Record<string, unknown>

const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const isStatus = (value: unknown): value is StepStatus =>
  value === 'pending' || value === 'in_progress' || value === 'completed'

// ---------------------------------------------------------------- plan

export function planFromTodos(todos: unknown): PlanStep[] | null {
  if (!Array.isArray(todos)) return null
  const steps: PlanStep[] = []
  todos.forEach((todo, index) => {
    if (!isObject(todo) || !isStatus(todo.status)) return
    const content = text(todo.content)
    if (content === null) return
    steps.push({ id: `todo-${index}`, text: content, activeText: text(todo.activeForm), status: todo.status })
  })
  return steps
}

export function planWithCreated(plan: PlanStep[], input: Loose, result: unknown): PlanStep[] {
  const task = isObject(result) && isObject(result.task) ? result.task : null
  const id = task ? text(task.id) : null
  const subject = text(input.subject) ?? (task ? text(task.subject) : null)
  if (id === null || subject === null) return plan

  const step: PlanStep = { id, text: subject, activeText: text(input.activeForm), status: 'pending' }
  return [...plan.filter(one => one.id !== id), step]
}

export function planWithUpdate(plan: PlanStep[], input: Loose, result: unknown): PlanStep[] {
  if (isObject(result) && result.success === false) return plan
  const id = text(input.taskId)
  if (id === null) return plan
  if (input.status === 'deleted') return plan.filter(one => one.id !== id)

  return plan.map(one =>
    one.id !== id
      ? one
      : {
          ...one,
          text: text(input.subject) ?? one.text,
          activeText: text(input.activeForm) ?? one.activeText,
          status: isStatus(input.status) ? input.status : one.status,
        },
  )
}

export function planFromTaskList(plan: PlanStep[], result: unknown): PlanStep[] | null {
  if (!isObject(result) || !Array.isArray(result.tasks)) return null
  const known = new Map(plan.map(one => [one.id, one]))
  const steps: PlanStep[] = []
  for (const task of result.tasks) {
    if (!isObject(task) || !isStatus(task.status)) continue
    const id = text(task.id)
    const subject = text(task.subject)
    if (id === null || subject === null) continue
    steps.push({ id, text: subject, activeText: known.get(id)?.activeText ?? null, status: task.status })
  }
  return steps
}

export function planWithTask(plan: PlanStep[], result: unknown): PlanStep[] {
  const task = isObject(result) && isObject(result.task) ? result.task : null
  if (task === null || !isStatus(task.status)) return plan
  const id = text(task.id)
  const subject = text(task.subject)
  if (id === null || subject === null) return plan
  const known = plan.find(one => one.id === id)
  const step: PlanStep = { id, text: subject, activeText: known?.activeText ?? null, status: task.status }
  return known ? plan.map(one => (one.id === id ? step : one)) : [...plan, step]
}

const STATUS_ORDER: Record<StepStatus, number> = { in_progress: 0, pending: 1, completed: 2 }

export function orderedPlan(plan: readonly PlanStep[]): PlanStep[] {
  return plan
    .map((step, index) => ({ step, index }))
    .sort((a, b) => STATUS_ORDER[a.step.status] - STATUS_ORDER[b.step.status] || a.index - b.index)
    .map(({ step }) => step)
}

// ---------------------------------------------------------------- changes

function patchCounts(patch: unknown): { added: number; removed: number } | null {
  if (!Array.isArray(patch)) return null
  let added = 0
  let removed = 0
  for (const hunk of patch) {
    if (!isObject(hunk) || !Array.isArray(hunk.lines)) return null
    for (const line of hunk.lines) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  return { added, removed }
}

export function lineCount(content: string): number {
  if (content === '') return 0
  const lines = content.split('\n').length
  return content.endsWith('\n') ? lines - 1 : lines
}

const MAX_DIFF_CELLS = 4_000_000

/** Lines added and removed by a minimal line diff (longest common subsequence). */
export function lineDiff(before: string, after: string): { added: number; removed: number } | null {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  if (a.length * b.length > MAX_DIFF_CELLS) return null
  let previous = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? (previous[j - 1] ?? 0) + 1 : Math.max(previous[j] ?? 0, current[j - 1] ?? 0)
    }
    previous = current
  }
  const common = previous[b.length] ?? 0
  return { added: b.length - common, removed: a.length - common }
}

export type ObservedChange = Pick<FileChange, 'path' | 'added' | 'removed' | 'isNew' | 'isDeleted'>

/** What one answered Edit, Write or NotebookEdit call changed, from its record. */
export function changeOf(tool: string, input: Loose, result: unknown): ObservedChange | null {
  if (!isObject(result) || result.staged === true) return null

  if (tool === 'Edit') {
    const path = text(result.filePath) ?? text(input.file_path)
    const counts = patchCounts(result.structuredPatch)
    if (path === null) return null
    // An Edit always changes text: an empty patch means the engine's diff timed out.
    const isUnknown = counts === null || counts.added + counts.removed === 0
    return {
      path,
      added: isUnknown ? null : counts.added,
      removed: isUnknown ? null : counts.removed,
      isNew: false,
      isDeleted: false,
    }
  }

  if (tool === 'Write') {
    const path = text(result.filePath) ?? text(input.file_path)
    if (path === null) return null
    if (result.type === 'create') {
      const content = text(result.content) ?? text(input.content)
      return { path, added: content === null ? null : lineCount(content), removed: 0, isNew: true, isDeleted: false }
    }
    const counts = patchCounts(result.structuredPatch)
    // An empty patch is "nothing changed" only when the old and new content are known to match;
    // the record leaves it empty too when the diff timed out or the old content was too large.
    const isUnchanged = typeof result.originalFile === 'string' && result.originalFile === text(result.content)
    const isUnknown = counts === null || (counts.added + counts.removed === 0 && !isUnchanged)
    return {
      path,
      added: isUnknown ? null : counts.added,
      removed: isUnknown ? null : counts.removed,
      isNew: false,
      isDeleted: false,
    }
  }

  if (tool === 'NotebookEdit') {
    const path = text(result.notebook_path) ?? text(input.notebook_path)
    // A successful edit's record carries `error: ""`; only a non-empty one is a failure.
    const error = text(result.error)
    if (path === null || (error !== null && error !== '')) return null
    const counts = lineDiff(text(result.old_source) ?? '', text(result.new_source) ?? '')
    return { path, added: counts?.added ?? null, removed: counts?.removed ?? null, isNew: false, isDeleted: false }
  }

  return null
}

/** Folders a command fills on the side: caches, dependencies, a virtualenv, git's own store. */
const CACHE_FOLDERS = new Set(['__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'node_modules', '.venv', '.git'])

/** A file a command makes on the side: in a cache or build folder, compiled Python, Finder's .DS_Store. */
export function isCachePath(path: string): boolean {
  const folders = path.split(/[\\/]/)
  const name = folders.pop() ?? ''
  return folders.some(folder => CACHE_FOLDERS.has(folder)) || name.endsWith('.pyc') || name.endsWith('.pyo') || name === '.DS_Store'
}

/**
 * The files a Bash command changed, from its record's `bashEditDiff`: an
 * internal field of this build, read only when it is there and well formed.
 * A file it names without hunks has unknown counts; a cache file
 * (`isCachePath`) is only named in `hidden`; `missed` counts the changed
 * files it gives no path for at all.
 */
export function bashChangesOf(result: unknown): { changes: ObservedChange[]; hidden: string[]; missed: number } {
  const diff = isObject(result) && isObject(result.bashEditDiff) ? result.bashEditDiff : null
  if (diff === null) return { changes: [], hidden: [], missed: 0 }

  const changes: ObservedChange[] = []
  const files = Array.isArray(diff.files) ? diff.files : []
  for (const file of files) {
    if (!isObject(file)) continue
    const path = text(file.filePath)
    if (path === null) continue
    const counts = patchCounts(file.hunks)
    changes.push({
      path,
      added: counts?.added ?? null,
      removed: counts?.removed ?? null,
      isNew: file.created === true,
      isDeleted: file.deleted === true,
    })
  }
  const shown = new Set(changes.map(change => change.path))
  if (Array.isArray(diff.changedFiles)) {
    for (const path of diff.changedFiles) {
      if (typeof path !== 'string' || shown.has(path)) continue
      shown.add(path)
      changes.push({ path, added: null, removed: null, isNew: false, isDeleted: false })
    }
  }
  const more = typeof diff.moreFiles === 'number' ? diff.moreFiles : 0
  return {
    changes: changes.filter(change => !isCachePath(change.path)),
    hidden: [...shown].filter(isCachePath),
    missed: Math.max(0, files.length + more - shown.size),
  }
}

export const NO_HIDDEN: HiddenFiles = { paths: [], evicted: 0 }

/** Adds a command's cache files, each path once; past `max` the oldest fall off the list and stay counted. */
export function withHidden(hidden: HiddenFiles, paths: readonly string[], max: number): HiddenFiles {
  const known = new Set(hidden.paths)
  const fresh = [...new Set(paths)].filter(path => !known.has(path))
  if (fresh.length === 0) return hidden
  const all = [...fresh, ...hidden.paths]
  return { paths: all.slice(0, max), evicted: hidden.evicted + Math.max(0, all.length - max) }
}

export const hiddenCount = (hidden: HiddenFiles): number => hidden.paths.length + hidden.evicted

const sum = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a + b)

export function withChange(list: readonly FileChange[], change: ObservedChange, at: number): FileChange[] {
  const known = list.find(one => one.path === change.path)
  const merged: FileChange = known
    ? {
        path: change.path,
        added: sum(known.added, change.added),
        removed: sum(known.removed, change.removed),
        isNew: (known.isNew || change.isNew) && !change.isDeleted,
        isDeleted: change.isDeleted,
        edits: known.edits + 1,
        at,
      }
    : { ...change, edits: 1, at }
  return [merged, ...list.filter(one => one.path !== change.path)]
}

// ---------------------------------------------------------------- context

/** The group each breakdown row is summed into, by the name /context prints; display only. */
const SOURCE_BY_NAME: Readonly<Record<string, SourceKey>> = {
  Messages: 'messages',
  'System tools': 'tools',
  'Custom agents': 'tools',
  'MCP tools': 'mcp',
  'MCP server instructions': 'mcp',
  'Memory files': 'memory',
  Skills: 'skills',
  'System prompt': 'system',
}

/** Bar and legend order: neighbours are the theme's most distinct pairs. */
export const SOURCE_ORDER: readonly SourceKey[] = ['messages', 'mcp', 'tools', 'memory', 'skills', 'system', 'other']

export const sourceKeyOf = (name: string): SourceKey => SOURCE_BY_NAME[name] ?? 'other'

export function snapshotOf(breakdown: SessionContextBreakdown, exact: ExactFill | null, window: number): ContextSnapshot {
  const groups = new Map<SourceKey, { tokens: number; color: string; largest: number }>()
  for (const row of breakdown.categories) {
    if (row.kind !== 'used' || row.tokens <= 0) continue
    const key = sourceKeyOf(row.name)
    const group = groups.get(key) ?? { tokens: 0, color: row.color, largest: 0 }
    group.tokens += row.tokens
    if (row.tokens > group.largest) {
      group.largest = row.tokens
      group.color = row.color
    }
    groups.set(key, group)
  }
  const sources = SOURCE_ORDER.flatMap(key => {
    const group = groups.get(key)
    return group ? [{ key, tokens: group.tokens, color: group.color }] : []
  })

  const servers = new Map<string, { tools: number; tokens: number; deferred: number }>()
  for (const tool of breakdown.mcpTools) {
    const server = servers.get(tool.serverName) ?? { tools: 0, tokens: 0, deferred: 0 }
    server.tools += 1
    if (tool.isLoaded) server.tokens += tool.tokens
    else server.deferred += 1
    servers.set(tool.serverName, server)
  }

  return {
    exact,
    totalTokens: breakdown.totalTokens,
    window: window > 0 ? window : breakdown.rawMaxTokens,
    sources,
    threshold: breakdown.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null,
    mcp: [...servers].map(([server, use]) => ({ server, ...use })).sort((a, b) => b.tokens - a.tokens || b.tools - a.tools),
    memory: breakdown.memoryFiles.map(file => ({ path: file.path, kind: file.type, tokens: file.tokens })),
    skills: breakdown.skills
      ? { listed: breakdown.skills.includedSkills, total: breakdown.skills.totalSkills, tokens: breakdown.skills.tokens }
      : null,
  }
}

/** The status line's figures, when the live window has had a response. */
export function exactOf(usage: SessionContextUsage): ExactFill | null {
  if (usage.tokens === undefined || usage.percent === undefined || usage.window <= 0) return null
  return { tokens: usage.tokens, window: usage.window, percent: usage.percent }
}

export function fiveHourOf(limits: readonly SessionRateLimit[]): RateWindow | null {
  const window = limits.find(limit => limit.kind === 'five_hour')
  return window ? { percentUsed: window.percentUsed, resetsAt: window.resetsAt ?? null } : null
}

/** Whether the 5h reading's reset time has passed: the reading no longer stands. */
export function hasLimitReset(fiveHour: RateWindow | null, now: number): boolean {
  const resetsAt = fiveHour?.resetsAt ? Date.parse(fiveHour.resetsAt) : Number.NaN
  return fiveHour !== null && Number.isFinite(resetsAt) && now > 0 && now >= resetsAt
}

/** The share of the 5h window left, 0 to 100; null without a reading that still stands. */
export function limitLeft(fiveHour: RateWindow | null, now: number): number | null {
  if (fiveHour === null || hasLimitReset(fiveHour, now)) return null
  return Math.max(0, Math.min(100, 100 - fiveHour.percentUsed))
}

/** How full the window is, in percent: measured when it was, else the breakdown's estimate. */
export function contextPercent(context: ContextSnapshot): number {
  if (context.exact !== null) return context.exact.percent
  return context.window > 0 ? (context.totalTokens / context.window) * 100 : 0
}

/**
 * How far the context is on its way to the auto-compact threshold, in
 * percent (100 where auto-compaction runs); with auto-compaction off, how
 * full the window is.
 */
export function thresholdPercent(context: ContextSnapshot): number {
  if (context.threshold === null || context.threshold <= 0) return contextPercent(context)
  return ((context.exact?.tokens ?? context.totalTokens) * 100) / context.threshold
}

export type Growth = { perTurn: number | null; turnsLeft: number | null }

const GROWTH_WINDOW = 5

/** Mean growth over the last turns since the last drop, and turns to the threshold at that rate. */
export function growthOf(history: readonly ContextSample[], current: number, threshold: number | null): Growth {
  let start = 0
  for (let i = 1; i < history.length; i += 1) {
    if ((history[i]?.tokens ?? 0) < (history[i - 1]?.tokens ?? 0)) start = i
  }
  const run = history.slice(start).slice(-(GROWTH_WINDOW + 1))
  if (run.length < 2) return { perTurn: null, turnsLeft: null }

  const perTurn = ((run.at(-1)?.tokens ?? 0) - (run[0]?.tokens ?? 0)) / (run.length - 1)
  const turnsLeft =
    threshold !== null && perTurn > 0 && current < threshold ? Math.ceil((threshold - current) / perTurn) : null
  return { perTurn, turnsLeft }
}

/**
 * Cells of each source across a bar `width` wide: every source with tokens
 * gets at least one cell, the rest are shared by largest remainder.
 */
export function barCells(tokens: readonly number[], max: number, width: number): number[] {
  if (max <= 0 || width <= 0) return tokens.map(() => 0)
  const total = tokens.reduce((a, b) => a + b, 0)
  const present = tokens.filter(n => n > 0).length
  const filled = Math.min(width, Math.max(present, Math.round((total / max) * width)))
  if (total <= 0 || filled === 0) return tokens.map(() => 0)

  const cells: number[] = tokens.map(n => (n > 0 && present <= filled ? 1 : 0))
  const spare = filled - cells.reduce((a, b) => a + b, 0)
  const exact = tokens.map(n => (n / total) * spare)
  exact.forEach((n, i) => (cells[i] = (cells[i] ?? 0) + Math.floor(n)))
  let left = filled - cells.reduce((a, b) => a + b, 0)
  const byRemainder = exact.map((n, i) => ({ i, r: n - Math.floor(n) })).sort((a, b) => b.r - a.r)
  for (const { i } of byRemainder) {
    if (left <= 0) break
    cells[i] = (cells[i] ?? 0) + 1
    left -= 1
  }
  return cells
}

/** A braille cell's dot bits per side, bottom up: dots 7, 3, 2, 1 on the left, 8, 6, 5, 4 on the right. */
const DOTS = [
  [0x40, 0x04, 0x02, 0x01],
  [0x80, 0x20, 0x10, 0x08],
] as const

const braille = (bits: number) => String.fromCharCode(0x2800 + bits)

/** One chart row: the braille characters, and the faint placeholders where no turn has data. */
export type ChartRow = { data: string; placeholder: string }

/**
 * The history in braille, two turns a character (one dot column each), the
 * newest last, always two rows of four dots, scaled so `top` fills both. A
 * turn above zero shows at least its lowest dot. Dot columns no turn has
 * reached yet get a faint baseline dot on the bottom row, where their
 * character holds no data; nothing else is a placeholder.
 */
export function brailleRows(values: readonly number[], top: number, chars: number): ChartRow[] {
  const rows = 2
  const steps = rows * 4
  const shown = values.slice(-chars * DOTS.length)
  const heights = shown.map(v =>
    !Number.isFinite(v) || v <= 0 ? 0 : Math.max(1, Math.min(steps, Math.round((v / Math.max(top, 1e-9)) * steps))),
  )
  const all: ChartRow[] = []
  for (let row = 0; row < rows; row += 1) {
    const floor = (rows - 1 - row) * 4
    const isBottom = row === rows - 1
    let data = ''
    let placeholder = ''
    for (let c = 0; c < chars; c += 1) {
      let bits = 0
      let faint = 0
      DOTS.forEach((dots, side) => {
        const height = heights[c * DOTS.length + side]
        if (height === undefined) {
          if (isBottom) faint |= dots[0]
          return
        }
        const inRow = Math.max(0, Math.min(4, height - floor))
        for (let dot = 0; dot < inRow; dot += 1) bits |= dots[dot] ?? 0
      })
      data += bits === 0 ? ' ' : braille(bits)
      placeholder += bits === 0 && faint !== 0 ? braille(faint) : ' '
    }
    all.push({ data, placeholder })
  }
  return all
}

/** A legend item: its label (and a short one), its value spelled roomy (`≈3 %`) and compact (`≈3%`). */
export type LegendItem = { key: string; label: string; short: string; value: string; compact: string }

export type LegendLayout = {
  lines: number[][]
  gap: number
  isCompact: boolean
  isShort: boolean
  /** Items no spelling fits into two lines: the legend says `+cut` at its end. */
  cut: number
}

/** An item's cells: the bullet, a space (a bullet drawn wider than its cell spills into it), label, value. */
const legendSize = (item: LegendItem, isCompact: boolean, isShort: boolean) =>
  2 + (isShort ? item.short : item.label).length + 1 + (isCompact ? item.compact : item.value).length

/**
 * The legend's items laid into at most two lines: the roomiest spelling
 * that fits wins (a wider gap, then a tighter one, the compact value, the
 * short labels); the bullet always keeps its space. Lines are lists of item
 * indices. Where even the last spelling needs a third line, the second line
 * keeps room for a `+cut` note, so no source leaves the legend unsaid.
 */
export function legendLines(items: readonly LegendItem[], width: number): LegendLayout {
  const tries = [
    { gap: 2, isCompact: false, isShort: false },
    { gap: 1, isCompact: false, isShort: false },
    { gap: 1, isCompact: true, isShort: false },
    { gap: 1, isCompact: true, isShort: true },
  ]
  let last: LegendLayout = { lines: [], gap: 1, isCompact: true, isShort: true, cut: 0 }
  for (const { gap, isCompact, isShort } of tries) {
    const lines: number[][] = []
    const used: number[] = []
    items.forEach((item, i) => {
      const size = legendSize(item, isCompact, isShort)
      const line = lines.at(-1)
      const sum = used.at(-1) ?? 0
      if (line && sum + gap + size <= width) {
        line.push(i)
        used[used.length - 1] = sum + gap + size
      } else {
        lines.push([i])
        used.push(size)
      }
    })
    last = { lines: lines.slice(0, 2), gap, isCompact, isShort, cut: 0 }
    if (lines.length <= 2) return last
  }
  // In bar order they need a third line: try every split of the items into
  // two lines (a dozen sources at most), each line keeping bar order; the
  // colors still tie each item to its cells in the bar.
  const sizes = items.map(item => legendSize(item, true, true))
  const lineWidth = (members: readonly number[]) =>
    members.reduce((sum, i) => sum + (sizes[i] ?? 0), 0) + Math.max(0, members.length - 1) * last.gap
  if (items.length <= 12) {
    for (let mask = 0; mask < 1 << items.length; mask += 1) {
      const first = items.flatMap((_, i) => ((mask >> i) & 1 ? [i] : []))
      const second = items.flatMap((_, i) => ((mask >> i) & 1 ? [] : [i]))
      if (first.length > 0 && second.length > 0 && lineWidth(first) <= width && lineWidth(second) <= width) {
        return { ...last, lines: first[0] === 0 ? [first, second] : [second, first] }
      }
    }
  }
  // Still too many: keep two lines, and make room on the second for "+N".
  const second = last.lines[1] ?? []
  let room = width
  const fitted: number[] = []
  for (const index of second) {
    const item = items[index]
    if (item === undefined) continue
    const size = legendSize(item, last.isCompact, last.isShort) + (fitted.length > 0 ? last.gap : 0)
    if (room - size < last.gap + 1 + String(items.length).length) break
    fitted.push(index)
    room -= size
  }
  const lines = [last.lines[0] ?? [], fitted]
  return { ...last, lines, cut: items.length - lines.flat().length }
}

/** Parts joined by ` · `, broken into lines only between parts. */
export function flowParts(parts: readonly string[], width: number): string[] {
  const lines: string[] = []
  for (const part of parts) {
    const last = lines.at(-1)
    if (last !== undefined && last.length + 3 + part.length <= width) lines[lines.length - 1] = `${last} · ${part}`
    else lines.push(part)
  }
  return lines
}

// ---------------------------------------------------------------- formats

export function formatTokens(n: number, decimal = '.'): string {
  const short = (value: number, unit: string) => `${value.toFixed(1).replace(/\.0$/, '').replace('.', decimal)}${unit}`
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return short(n / 1000, 'k')
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return short(n / 1_000_000, 'M')
}

/**
 * A share of `max` as a percentage: whole from 1 up, one decimal below
 * (`0,4`), `<0,1` for a sliver; `percent` spells it per locale, `na`
 * where there is no `max`.
 */
export function share(tokens: number, max: number, percent: (value: number | string) => string, decimal: string, na: string): string {
  if (max <= 0) return na
  const pct = (tokens / max) * 100
  if (pct >= 0.95 || pct === 0) return percent(Math.round(pct))
  const tenth = Math.round(pct * 10) / 10
  return tenth < 0.1 ? `<${percent(`0${decimal}1`)}` : percent(tenth.toFixed(1).replace('.', decimal))
}

/** How many of `cells` are full for the share of the window left: rounded, one while any is left. */
export function cellsFull(percentLeft: number, cells: number): number {
  if (percentLeft <= 0) return 0
  return Math.max(1, Math.min(cells, Math.round((percentLeft / 100) * cells)))
}

export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/**
 * A file as CHANGES shows it: its path from the project folder (`root`, the
 * session's working directory), `src/auth/index.ts`; a file outside it, or
 * with no folder known, by its name alone. Never an absolute path.
 */
export function projectPath(path: string, root: string): string {
  const file = path.replace(/\\/g, '/')
  const folder = root.replace(/\\/g, '/').replace(/\/+$/, '')
  let rest = file
  if (/^(\/|~|[A-Za-z]:\/)/.test(file)) {
    if (folder === '' || !file.startsWith(`${folder}/`)) return baseName(file)
    rest = file.slice(folder.length + 1)
  }
  // Empty and `.` parts dropped; a `..` may climb out of the project, so then only the name.
  const parts = rest.split('/').filter(part => part !== '' && part !== '.')
  return parts.length === 0 || parts.includes('..') ? baseName(file) : parts.join('/')
}

export const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

// ---------------------------------------------------------------- agents

const END_STATUS: Readonly<Record<string, string>> = {
  answer: 'completed',
  refusal: 'failed',
  error: 'failed',
  aborted: 'killed',
}

const ENDED = new Set(['completed', 'failed', 'killed'])

/**
 * Its status as $.agent.list() says while it is listed, else as its own
 * turns showed it. One the list dropped has ended: its last ending status,
 * else how its last turn ended, else `ended` with no more known.
 */
export function agentStatus(row: AgentRow): string {
  if (!row.isGone && row.listedStatus !== null) return row.listedStatus
  if (!row.isGone && row.turnStartedAt !== null) return 'running'
  if (row.isGone && row.listedStatus !== null && ENDED.has(row.listedStatus)) return row.listedStatus
  if (row.endReason !== null && END_STATUS[row.endReason]) return END_STATUS[row.endReason] ?? 'ended'
  return row.isGone ? 'ended' : 'pending'
}

const LIVE = new Set(['running', 'pending', 'waiting'])

export const isAgentLive = (row: AgentRow): boolean =>
  !row.isGone && (row.turnStartedAt !== null || LIVE.has(agentStatus(row)))

/** A status the agent's loop has ended in: done, failed, killed, or ended with no more known. */
export const isEndedStatus = (status: string): boolean => ENDED.has(status) || status === 'ended'

/** How many agents run, wait (pending, waiting, idle teammates) and have ended. */
export function agentCounts(rows: readonly AgentRow[]): { running: number; waiting: number; ended: number } {
  const counts = { running: 0, waiting: 0, ended: 0 }
  for (const row of rows) {
    const status = agentStatus(row)
    if (status === 'running') counts.running += 1
    else if (isEndedStatus(status)) counts.ended += 1
    else counts.waiting += 1
  }
  return counts
}

export function agentElapsed(row: AgentRow, now: number): number | null {
  if (!row.isTimed) return null
  return row.doneMs + (row.turnStartedAt === null ? 0 : Math.max(0, now - row.turnStartedAt))
}

/** The most agents noxdeck keeps, rows and work alike. */
export const MAX_AGENTS = 50

/** The last `MAX_AGENTS` of a list kept oldest first: ended ones leave before live ones. */
export function lastAgents<T>(list: readonly T[], isLive: (item: T) => boolean): T[] {
  let over = list.length - MAX_AGENTS
  if (over <= 0) return [...list]
  const kept = list.filter(item => {
    if (over > 0 && !isLive(item)) {
      over -= 1
      return false
    }
    return true
  })
  return kept.slice(-MAX_AGENTS)
}

// ---------------------------------------------------------------- agent tokens

export const NO_TALLY: TokenTally = {
  steps: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  context: null,
  model: null,
  effort: null,
}

export const NO_LEDGER: AgentLedger = { since: 0, main: NO_TALLY, work: [], agentsPast: NO_TALLY, otherPast: NO_TALLY }

/** One model request added to a tally: its tokens where it reported usage, its model, the effort it asked for. */
export function withStep(tally: TokenTally, usage: TurnUsage | null, effort: string | null): TokenTally {
  if (usage === null) return { ...tally, steps: tally.steps + 1, effort }
  return {
    steps: tally.steps + 1,
    input: tally.input + usage.input_tokens,
    output: tally.output + usage.output_tokens,
    cacheRead: tally.cacheRead + usage.cache_read_input_tokens,
    cacheCreation: tally.cacheCreation + usage.cache_creation_input_tokens,
    context: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
    model: usage.model,
    effort,
  }
}

/** Two tallies summed, as a pot holds them; the later one's last context, model and effort. */
export function plusTally(sum: TokenTally, more: TokenTally | null): TokenTally {
  if (more === null) return sum
  return {
    steps: sum.steps + more.steps,
    input: sum.input + more.input,
    output: sum.output + more.output,
    cacheRead: sum.cacheRead + more.cacheRead,
    cacheCreation: sum.cacheCreation + more.cacheCreation,
    context: more.context ?? sum.context,
    model: more.model ?? sum.model,
    effort: more.effort ?? sum.effort,
  }
}

/** Every token the requests went through: the four kinds summed, the cache's re-reads included. */
export const processedOf = (tally: TokenTally): number => tally.input + tally.output + tally.cacheRead + tally.cacheCreation

/** What the requests did not read from the cache: input, cache writes and output. */
export const freshOf = (tally: TokenTally): number => tally.input + tally.cacheCreation + tally.output

/** The other loops (no spawn, no list) kept one by one, so a spawn answered late still claims its steps; older ones are summed. */
export const MAX_OTHER_LOOPS = 20

/** A loop first heard of now: seen from its start, a subagent once a spawn or the list names it. */
const newWork = (id: string): AgentWork => ({
  id,
  isAgent: false,
  isWhole: true,
  tally: null,
  calls: 0,
  errors: 0,
  lastCall: null,
  startedAt: null,
  endedAt: null,
})

/**
 * The ledger within its bounds: the last `MAX_AGENTS` subagents (ended ones
 * leave first) and the last `MAX_OTHER_LOOPS` other loops; the tokens of
 * those that leave are summed into their pot's past, so no pot loses any.
 */
function bounded(ledger: AgentLedger): AgentLedger {
  const agents = ledger.work.filter(one => one.isAgent)
  const others = ledger.work.filter(one => !one.isAgent)
  if (agents.length <= MAX_AGENTS && others.length <= MAX_OTHER_LOOPS) return ledger
  const keptAgents = new Set(lastAgents(agents, one => one.endedAt === null))
  const keptOthers = new Set(others.slice(-MAX_OTHER_LOOPS))
  const left = ledger.work.filter(one => !keptAgents.has(one) && !keptOthers.has(one))
  return {
    ...ledger,
    work: ledger.work.filter(one => keptAgents.has(one) || keptOthers.has(one)),
    agentsPast: left.filter(one => one.isAgent).reduce((sum, one) => plusTally(sum, one.tally), ledger.agentsPast),
    otherPast: left.filter(one => !one.isAgent).reduce((sum, one) => plusTally(sum, one.tally), ledger.otherPast),
  }
}

/** One loop's work changed, added when new; the ledger kept within its bounds. */
export function withWork(ledger: AgentLedger, id: string, change: (work: AgentWork) => AgentWork): AgentLedger {
  const work = ledger.work.some(one => one.id === id)
    ? ledger.work.map(one => (one.id === id ? change(one) : one))
    : [...ledger.work, change(newWork(id))]
  return bounded({ ...ledger, work })
}

/** A loop a spawn answered or the list named: a subagent, its tokens the Agents pot's. */
export const withAgent = (ledger: AgentLedger, id: string): AgentLedger =>
  withWork(ledger, id, work => (work.isAgent ? work : { ...work, isAgent: true }))

/** An agent's tokens where noxdeck saw all of them, from its start; else null (–). */
export const wholeTally = (work: AgentWork | null): TokenTally | null => (work?.isWhole === true ? work.tally : null)

/**
 * A model request counted by its loop: the main chat's without a loop id,
 * else that loop's own, whatever it turns out to be: the pots are decided
 * as the pane draws (potsOf).
 */
export function withLedgerStep(ledger: AgentLedger, loop: string | null, usage: TurnUsage | null, effort: string | null): AgentLedger {
  if (loop === null) return { ...ledger, main: withStep(ledger.main, usage, effort) }
  return withWork(ledger, loop, work => ({ ...work, tally: withStep(work.tally ?? NO_TALLY, usage, effort) }))
}

/** The three pots as the pane shows them: the main chat, the subagents, the other loops. */
export function potsOf(ledger: AgentLedger): { main: TokenTally; agents: TokenTally; other: TokenTally } {
  const sum = (isAgent: boolean, past: TokenTally) =>
    ledger.work.filter(one => one.isAgent === isAgent).reduce((total, one) => plusTally(total, one.tally), past)
  return { main: ledger.main, agents: sum(true, ledger.agentsPast), other: sum(false, ledger.otherPast) }
}

/** The effort a request asked for, as text: `high`, or a number's digits. */
export const effortText = (effort: string | number | undefined): string | null => (effort === undefined ? null : String(effort))

/** A model's family in a word (`opus`, `sonnet`, `haiku`), else its id without `claude-`. */
export function modelShort(model: string): string {
  const family = /opus|sonnet|haiku|fable/i.exec(model)?.[0]
  return family === undefined ? model.replace(/^claude-/, '') : family.toLowerCase()
}

/** The file a call names, by its name alone (its `file_path`, else its `path`); never the path. */
export function callFileOf(input: Record<string, unknown>): string | null {
  const path = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : null
  return path === null || path.trim() === '' ? null : baseName(path)
}

/** A description's group: the words before its first `:` and the rest; null where it has no such prefix. */
export function prefixOf(description: string): { prefix: string; rest: string } | null {
  const at = description.indexOf(':')
  if (at < 0) return null
  const prefix = description.slice(0, at).trim()
  const rest = description.slice(at + 1).trim()
  return prefix === '' || rest === '' ? null : { prefix, rest }
}

/** Agents grouped by their description's prefix, in the order the groups first come; a prefix one agent has stays single. */
export type AgentGroup<T> = { prefix: string | null; members: T[] }

export function groupsOf<T>(items: readonly T[], description: (item: T) => string): AgentGroup<T>[] {
  const groups: AgentGroup<T>[] = []
  const byPrefix = new Map<string, AgentGroup<T>>()
  for (const item of items) {
    const prefix = prefixOf(description(item))?.prefix ?? null
    const known = prefix === null ? undefined : byPrefix.get(prefix)
    if (known !== undefined) {
      known.members.push(item)
      continue
    }
    const group: AgentGroup<T> = { prefix, members: [item] }
    groups.push(group)
    if (prefix !== null) byPrefix.set(prefix, group)
  }
  // A prefix only one agent carries is that agent's name, not a group.
  return groups.map(group => (group.members.length === 1 ? { prefix: null, members: group.members } : group))
}

/** The Agents tab's two views, which fold their groups apart: the full card and the compact view. */
export type FoldView = 'large' | 'compact'

/** No group folded: the full card's all open, the compact view's all closed. */
export const NO_FOLDS: AgentFolds = { closed: [], opened: [] }

/** The most groups a view keeps folded against its default; the oldest fold goes first. */
const MAX_FOLDS = 50

/** Whether a group shows its agents in a view: open in the full card, closed in the compact view, unless the person turned it. */
export const isGroupOpen = (folds: AgentFolds, prefix: string, view: FoldView): boolean =>
  view === 'large' ? !folds.closed.includes(prefix) : folds.opened.includes(prefix)

/** The folds with one group turned in one view, the other view's left as they were. */
export function withFold(folds: AgentFolds, prefix: string, view: FoldView): AgentFolds {
  const turned = (list: readonly string[]) =>
    list.includes(prefix) ? list.filter(one => one !== prefix) : [...list, prefix].slice(-MAX_FOLDS)
  return view === 'large' ? { ...folds, closed: turned(folds.closed) } : { ...folds, opened: turned(folds.opened) }
}

/** The type most agents have: the others show theirs. */
export function commonType(types: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const type of types) if (type !== null) counts.set(type, (counts.get(type) ?? 0) + 1)
  let best: string | null = null
  for (const [type, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = type
  return best
}
