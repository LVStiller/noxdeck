import type { Ask, CallLabel, Cues, FailCount, FailStreak, FileUse, Radar } from '../types'
import { baseName } from './model'
import { maskSecrets } from './secrets'

// RADAR's figures: a call failing again and again (three times in a row, or
// four times in one turn), the failures, the files most used, and the time
// approval dialogs stood open. Pure functions, no `$`.
// A call is kept by its tool and a hash of its target and shown by a
// description or a file's name: never a command, never a path.

type Loose = Record<string, unknown>

/** The tools of a plan: with one of them in the session the PLAN card shows instead of RADAR. */
export const TODO_TOOLS: ReadonlySet<string> = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])

export const NO_RADAR: Radar = { errors: 0, lastError: null, streak: null, turnFails: [], files: [] }

/** The same call failing this often in a row is a loop. */
export const LOOP_AFTER = 3
/** The same call failing this often in one turn, whatever came between, is told too. */
export const FAILS_IN_TURN = 4
/** Calls of one turn RADAR keeps counting; past this the least failed go. */
const MAX_TURN_FAILS = 50
/** Hotspots RADAR names. */
export const HOTSPOTS = 3
/** Files kept counted; past this the least used go. */
const MAX_FILES = 500
/** A detail is kept this long at most: one row of the card. */
const MAX_DETAIL = 80

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit'])

const text = (input: Loose, key: string): string | null => {
  const value = input[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** A file tool's path: `file_path`, or a notebook's. */
export const filePathOf = (tool: string, input: Loose): string | null =>
  FILE_TOOLS.has(tool) ? (text(input, tool === 'NotebookEdit' ? 'notebook_path' : 'file_path') ?? null) : null

/** FNV-1a over the text, as eight hex digits: a call's target told apart without keeping it. */
function hashOf(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** A flag's value given apart that only tunes the call: a number or a duration (`-count 1`, `-timeout 120s`). */
const isTuning = (token: string) => /^\d+(\.\d+)?(ms|s|m|h)?$/.test(token)

/**
 * A Bash command as the same call: its environment assignments, flags (and
 * a number or duration given to one), redirections and what each command is
 * piped into left out, so `npm test` and `CI=1 npm test -- --watch=false
 * 2>&1 | tail -20` are one call; the commands chained after it stay.
 */
export function normalizedCommand(command: string): string {
  const kept: string[] = []
  let isAtStart = true
  let isTargetNext = false
  let isFlagValueNext = false
  let isPipedInto = false
  for (const raw of command.match(/"[^"]*"|'[^']*'|\n|[^\s"']+/g) ?? []) {
    // A new line starts a new command, as `;` does.
    const token = raw === '\n' ? ';' : raw
    if (token === '&&' || token === '||' || token === ';') {
      if (kept.length > 0 && kept.at(-1) !== ';') kept.push(token)
      isAtStart = true
      isPipedInto = false
      isFlagValueNext = false
      continue
    }
    // What a command's output is piped into (a filter: tail, grep) is not the
    // call, up to the next `&&`, `||`, `;` or line, where the next command starts.
    if (isPipedInto) continue
    if (token === '|' || (token.startsWith('|') && !token.startsWith('||'))) {
      isPipedInto = true
      continue
    }
    if (isTargetNext) {
      isTargetNext = false
      continue
    }
    const isValue = isFlagValueNext && isTuning(token)
    isFlagValueNext = false
    if (isValue) continue
    // A redirection: `>`, `2>` and `<` take their target next; `2>&1` and `>file` hold it.
    if (/^\d*(>>?|<)$/.test(token)) {
      isTargetNext = true
      continue
    }
    if (/^\d*(>>?|<)/.test(token)) continue
    if (token.startsWith('-')) {
      isFlagValueNext = !token.includes('=')
      continue
    }
    if (isAtStart && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue
    isAtStart = false
    kept.push(token)
  }
  while (kept.at(-1) === ';' || kept.at(-1) === '&&' || kept.at(-1) === '||') kept.pop()
  return kept.join(' ')
}

/** A description as the same call: its words, whatever their spacing and case. */
const normalizedWords = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * What makes two calls the same call: Bash by its description when it has
 * one, else by its command without flags; the file, the URL, the search,
 * else the whole input.
 */
function targetOf(tool: string, input: Loose): string {
  const path = filePathOf(tool, input)
  if (path !== null) return path
  if (tool === 'Bash') {
    const description = text(input, 'description')
    return description !== null ? `description:${normalizedWords(description)}` : `command:${normalizedCommand(text(input, 'command') ?? '')}`
  }
  if (tool === 'WebFetch') return text(input, 'url') ?? ''
  if (tool === 'WebSearch') return text(input, 'query') ?? ''
  const { tool_use_id: _id, agentId: _agent, ...rest } = input
  try {
    return JSON.stringify(rest) ?? ''
  } catch {
    return ''
  }
}

/** A call's identity: its tool and a hash of its target. */
export const callKey = (tool: string, input: Loose): string => `${tool}:${hashOf(targetOf(tool, input))}`

/** A URL's host, without its scheme, credentials, port, path or query (an IPv6 host in its brackets). */
function hostOf(url: string): string {
  const authority = url.replace(/^[a-z][a-z0-9+.-]*:(?:\/\/)?/i, '').split(/[/?#]/)[0] ?? ''
  const host = authority.split('@').at(-1) ?? ''
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : (host.split(':')[0] ?? '')
}

/** One line, masked, cut to a card's row. */
const detailOf = (value: string | null): string | null => {
  if (value === null) return null
  const line = value.trim().split('\n')[0]?.trim() ?? ''
  return line === '' ? null : maskSecrets(line).slice(0, MAX_DETAIL)
}

/**
 * What RADAR shows of a call: Bash by its description (never its command),
 * a file tool by the file's name, WebFetch by the host, a search by its
 * words, an agent by its task; any other tool by its name alone.
 */
export function callLabel(tool: string, input: Loose): CallLabel {
  const path = filePathOf(tool, input)
  const detail =
    path !== null
      ? baseName(path)
      : tool === 'Bash'
        ? text(input, 'description')
        : tool === 'WebFetch'
          ? (() => {
              const url = text(input, 'url')
              return url === null ? null : hostOf(url)
            })()
          : tool === 'WebSearch'
            ? text(input, 'query')
            : tool === 'Agent'
              ? text(input, 'description')
              : tool === 'Skill'
                ? text(input, 'skill')
                : null
  return { tool: toolName(tool), detail: detailOf(detail) }
}

/** The name RADAR shows: an MCP tool by its own name, its server's left out. */
export const toolName = (tool: string): string => (tool.startsWith('mcp__') ? (tool.split('__').at(-1) ?? tool) : tool)

/**
 * A main-loop call failed: counted, its run of failures goes on or starts
 * over, and its failures in this turn go up by one.
 */
export function withFailure(radar: Radar, key: string, label: CallLabel, at: number): Radar {
  const count = radar.streak?.key === key ? radar.streak.count + 1 : 1
  const known = radar.turnFails.find(one => one.key === key)
  const failed: FailCount = { key, ...label, count: (known?.count ?? 0) + 1 }
  const turnFails = [failed, ...radar.turnFails.filter(one => one.key !== key)]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TURN_FAILS)
  return {
    ...radar,
    errors: radar.errors + 1,
    lastError: { tool: label.tool, at },
    streak: { key, ...label, count },
    turnFails,
  }
}

/** A main-loop call ended without failing (done, refused, interrupted): no run of failures goes on. */
export const withoutStreak = (radar: Radar): Radar => (radar.streak === null ? radar : { ...radar, streak: null })

/** A new main turn (a new prompt, a new attempt): neither stage's count goes on. */
export const withNewTurn = (radar: Radar): Radar =>
  radar.streak === null && radar.turnFails.length === 0 ? radar : { ...radar, streak: null, turnFails: [] }

/** The strict stage RADAR warns of: the same call failing three times and more in a row. */
export const loopOf = (radar: Radar): FailStreak | null =>
  radar.streak !== null && radar.streak.count >= LOOP_AFTER ? radar.streak : null

/**
 * The loose stage: calls that failed four times and more in this turn,
 * whatever came between, the most failed first; the one the strict stage
 * already warns of is left out.
 */
export function repeatedOf(radar: Radar): FailCount[] {
  const loop = loopOf(radar)
  return radar.turnFails.filter(one => one.count >= FAILS_IN_TURN && one.key !== loop?.key).slice(0, 3)
}

/** Files read or edited: each counted once more, the list kept to its size. */
export function withFileUses(radar: Radar, paths: readonly string[], at: number): Radar {
  if (paths.length === 0) return radar
  let files = [...radar.files]
  for (const path of paths) {
    const known = files.find(one => one.path === path)
    const used: FileUse = { path, count: (known?.count ?? 0) + 1, at }
    // The one used now goes first, so among equals (a stable sort) the latest leads.
    files = [used, ...files.filter(one => one.path !== path)]
  }
  files.sort((a, b) => b.count - a.count || b.at - a.at)
  return { ...radar, files: files.slice(0, MAX_FILES) }
}

/** The most used files, by name and count: the most used first, the latest first among equals. */
export const hotspotsOf = (radar: Radar): { name: string; count: number }[] =>
  radar.files
    .slice(0, HOTSPOTS)
    .map(one => ({ name: maskSecrets(baseName(one.path)), count: one.count }))

// ---------------------------------------------------------------- waiting

/** A dialog that waits for the person's approval: a permission or a plan, not a question to answer. */
export const isApproval = (ask: Ask): boolean => ask.tool !== 'AskUserQuestion'

/** Tools that end as soon as their dialog is answered: the call's end is the answer's time. */
export const ENDS_AT_ANSWER: ReadonlySet<string> = new Set(['ExitPlanMode', 'Edit', 'Write', 'NotebookEdit'])

/**
 * The cues with `asking` as given. The time any approval dialog stood open is
 * summed over the union of their spans; `isApprox` marks a span that ended
 * with its call, after the tool had run.
 */
export function withAsking(cues: Cues, asking: Ask[], at: number, isApprox = false): Cues {
  const wasOpen = cues.asking.some(isApproval)
  const isOpen = asking.some(isApproval)
  const isWaitApprox = cues.isWaitApprox || isApprox
  if (!wasOpen && isOpen) return { ...cues, asking, waitingSince: at, isWaitApprox }
  if (wasOpen && !isOpen) {
    const since = cues.waitingSince ?? at
    return { ...cues, asking, waitedMs: cues.waitedMs + Math.max(0, at - since), waitingSince: null, isWaitApprox }
  }
  return { ...cues, asking, isWaitApprox }
}

/** How long approval dialogs have stood open by `at`, the one open now included. */
export const waitedOf = (cues: Cues, at: number): number =>
  cues.waitedMs + (cues.waitingSince === null ? 0 : Math.max(0, at - cues.waitingSince))

// ---------------------------------------------------------------- reset

/** The 5h window's reset as a clock time of the day (`18:40`), in the machine's time zone. */
export function resetClockOf(resetsAt: string | null): string | null {
  const at = resetsAt ? Date.parse(resetsAt) : Number.NaN
  if (!Number.isFinite(at)) return null
  const time = new Date(at)
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
}
