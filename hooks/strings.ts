// Every text the pane shows, in one place. A locale is chosen with the
// `language` option (plugin.json userConfig): English unless it says `de`.
// Both locales hold every key (a test compares them). Tab names, card titles,
// source labels and established terms (Context, Tokens, MCP, Skills, Cache
// Hit, Auto-Compact, Compact, Turn, Hotspots, deferred) stay English in every
// locale; sentences and states are translated.

import type { Mood } from './mascot'
import type { SourceKey } from './themes'

export type Locale = 'de' | 'en'

/** The Agents card's counts: running, waiting (pending, idle), done, failed, killed. */
export type AgentTally = { running: number; waiting: number; done: number; failed: number; killed: number }

/** A short time ago from milliseconds, in the locale's words: seconds, minutes, hours. */
const agoOf = (ms: number, s: (n: number) => string, min: (n: number) => string, h: (n: number) => string) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return s(seconds)
  if (seconds < 3600) return min(Math.floor(seconds / 60))
  return h(Math.floor(seconds / 3600))
}

export type Strings = {
  /** A percentage as the locale writes it: `89 %` or `89%`. */
  percent: (value: number | string) => string
  /** The same where room is short: `89%`. */
  percentTight: (value: number | string) => string
  /** The locale's decimal separator, for `8,4k` or `8.4k`. */
  decimal: string
  /** Where a figure is not known: a card's note, a share, a file's lines. */
  na: string
  tabs: { changes: string; agents: string; live: string }
  titles: { plan: string; radar: string; context: string; status: string; changes: string; agents: string }
  /** The context sources' labels in the legend, and shorter ones where room is short. */
  sources: Record<SourceKey, string>
  sourcesShort: Record<SourceKey, string>
  /** The breakdown table's row labels. */
  rows: { mcp: string; memory: string; skills: string }
  plan: {
    empty: string
    /** Steps cut for room, counted. */
    more: (count: number) => string
  }
  radar: {
    /** RADAR with nothing to tell: its one line. */
    empty: string
    /** Before the call that fails again and again: `⚠ dreht sich im Kreis:`. */
    loop: string
    /** A call that failed this often in the current turn, whatever came between. */
    failedTimes: (count: number, label: string) => string
    /** A Bash call without a description: never its command. */
    bashCommand: string
    /** Failures since load, the last one's tool and how long ago. */
    errors: (count: number, tool: string, ago: string) => string
    /** How long ago, from milliseconds. */
    ago: (ms: number) => string
    hotspots: string
    /** How long approval dialogs stood open (`≈` when only approximately known) and how many opened. */
    waited: (time: string, isApprox: boolean, approvals: number) => string
  }
  context: {
    notMeasured: string
    perTurn: (signed: string) => string
    perTurnNA: string
    compactIn: (turns: number) => string
    compactOff: string
    compactDue: string
    compactNA: string
    tools: (count: number) => string
    deferred: string
    none: string
    servers: (count: number) => string
    moreFiles: (count: number) => string
    listed: (count: number) => string
    of: (count: number) => string
    /**
     * The stats line's parts, joined by ` · ` and broken between parts where
     * room is short; `untilCompact`, the tokens left until auto-compaction,
     * is left out when null (auto-compaction off).
     */
    stats: (hit: string, untilCompact: string | null, compactions: number) => readonly string[]
  }
  status: {
    /** What the fine Nox's picture says where it cannot be drawn, and to a screen reader. */
    noxAlt: string
    editing: (file: string) => string
    lastEdit: (file: string) => string
    noEdits: string
    limit: (left: string) => string
    limitNA: string
    /** The window's reset time has passed since the last reading. */
    limitReset: string
    /** When the window resets, as a clock time. */
    resetAt: (time: string) => string
    mood: Record<Exclude<Mood, 'agents'>, string>
    /** The state in STATUS's title beside the mini owl: the caption's words, `arbeitet` without its dots. */
    moodTitle: Record<Exclude<Mood, 'agents'>, string>
    /** Shorter words where a state's own do not fit the title or the caption's row. */
    moodShort: { approval: string; question: string; agents: (count: number) => string }
    /**
     * Subagents at work while the main loop waits, in the Agents card's words
     * (running, waiting): Nox's caption.
     */
    agentsAtWork: (running: number, waiting: number) => string
  }
  changes: {
    /** The counter's parts: files, lines, and whether some counts are unknown. */
    counter: (files: number, added: number, removed: number, isPartial: boolean) => readonly string[]
    empty: string
    /** Rows left out for room; their counts are in the counter. */
    moreRows: (count: number) => string
    /** Files a diff named no lines for. */
    missed: (count: number) => string
    isNew: string
    deleted: string
    note: string
  }
  agents: {
    /** The card's head: how many run, wait, are done, failed, were stopped; parts with none left out. */
    counter: (counts: AgentTally) => readonly string[]
    /** The compact view's head after `AGENTS`: the same in glyphs, and what the agents processed. */
    compactCounter: (counts: AgentTally, processed: string) => readonly string[]
    empty: string
    /** The head the person presses to open the table of the pots (▸ closed, ▾ open). */
    processed: string
    /** The pots after the closed head, as parts: what the main chat, the agents and other loops processed since load. */
    totals: (main: string, agents: string, other: string) => readonly string[]
    /** The table the head opens: a row per pot, then how the main chat's figure comes about. */
    table: {
      /** The column heads: who, the block each step reads, what was processed; tight where the row has no room. */
      columns: readonly [string, string, string]
      columnsTight: readonly [string, string, string]
      /** Each pot's name and who works in it. */
      main: readonly [string, string]
      agents: readonly [string, string]
      other: readonly [string, string]
      /** The agents' block: each agent reads its own. */
      ownBlock: string
      /** The last row's name, under a rule: the three pots summed. */
      total: string
      rereads: string
      /** The main chat's steps, what each processed on average, and the whole. */
      sum: (steps: number, each: string, total: string) => string
    }
    /** A running agent's second line: model, effort, steps. */
    steps: (count: number) => string
    /** Its third line, roomy and tight: context of its last step, processed, new. */
    figures: (context: string, processed: string, fresh: string) => string
    figuresTight: (context: string, processed: string, fresh: string) => string
    /** Where an agent's tokens were not seen (before load, or a loop no list names). */
    processedNA: string
    /** How long ago its last call started. */
    ago: (ms: number) => string
    /** A failed or stopped agent's tool errors. */
    errors: (count: number) => string
    timeline: string
    /** The timeline's head where the pane has no room for its words. */
    timelineShort: string
    /** Agents left out where a line has no room, counted. */
    more: (count: number) => string
    note: string
    /** The Button back to the main chat while an agent's transcript is in the main view, with that agent's name. */
    back: (name: string) => string
    /** Under it: where the prompt's Enter goes now. */
    backNote: string
    /** The name `back` gives an agent the Agents tab does not know (one from before load, or past its 50). */
    someAgent: string
    /** The toast for a press on a workflow's agent, which has no view of its own. */
    workflowAgent: string
    /** The toast when Claude Code (or a plugin) refuses a view: its reason as it came, after these words. */
    viewDenied: (reason: string) => string
  }
  command: { description: string; opened: string; openedOn: (tab: string) => string }
}

const NBSP = ' '

const SHARED = {
  tabs: { changes: 'Changes', agents: 'Agents', live: 'Live' },
  titles: { plan: 'PLAN', radar: 'RADAR', context: 'CONTEXT', status: 'STATUS', changes: 'CHANGES', agents: 'AGENTS' },
  sources: {
    messages: 'messages',
    mcp: 'mcp',
    tools: 'tools',
    memory: 'memory',
    skills: 'skills',
    system: 'system',
    other: 'other',
  },
  sourcesShort: { messages: 'msgs', mcp: 'mcp', tools: 'tools', memory: 'mem', skills: 'skill', system: 'sys', other: 'other' },
  rows: { mcp: 'mcp', memory: 'memory', skills: 'skills' },
} as const

const de: Strings = {
  ...SHARED,
  percent: value => `${value}${NBSP}%`,
  percentTight: value => `${value}%`,
  decimal: ',',
  na: 'n/a',
  plan: { empty: 'kein Plan aktiv', more: count => `+${count} ${count === 1 ? 'weiterer Schritt' : 'weitere Schritte'}` },
  radar: {
    empty: 'keine Auffälligkeiten',
    loop: '⚠ dreht sich im Kreis:',
    failedTimes: (count, label) => `${count}× gescheitert: ${label}`,
    bashCommand: 'Bash-Befehl',
    errors: (count, tool, ago) => `Fehler ${count} · zuletzt ${tool} ${ago}`,
    ago: ms => {
      const minutes = Math.floor(ms / 60_000)
      if (minutes < 1) return 'gerade eben'
      if (minutes < 60) return `vor ${minutes} min`
      return `vor ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
    },
    hotspots: 'Hotspots',
    waited: (time, isApprox, approvals) =>
      `Wartezeit ${isApprox ? '≈' : ''}${time} · ${approvals} ${approvals === 1 ? 'Freigabe' : 'Freigaben'}`,
  },
  context: {
    notMeasured: 'Context noch nicht gemessen',
    perTurn: signed => `Ø ${signed}/Turn`,
    perTurnNA: 'Ø n/a/Turn',
    compactIn: turns => `Auto-Compact in ~${turns} ${turns === 1 ? 'Turn' : 'Turns'}`,
    compactOff: 'Auto-Compact aus',
    compactDue: 'Auto-Compact fällig',
    compactNA: 'Auto-Compact n/a',
    tools: count => `${count} ${count === 1 ? 'Tool' : 'Tools'}`,
    deferred: 'deferred',
    none: 'keine',
    servers: count => `${count} Server`,
    moreFiles: count => `+${count} weitere ${count === 1 ? 'Datei' : 'Dateien'}`,
    listed: count => `${count} gelistet`,
    of: count => `von ${count}`,
    stats: (hit, untilCompact, compactions) => [
      `Cache Hit ${hit}`,
      ...(untilCompact === null ? [] : [`noch ~${untilCompact} bis Compact`]),
      `${compactions}× kompaktiert`,
      'seit Laden',
    ],
  },
  status: {
    noxAlt: 'Nox, die Eule',
    editing: file => `✎ bearbeitet ${file}`,
    lastEdit: file => `zuletzt: ${file}`,
    noEdits: '✎ noch keine Änderungen',
    limit: left => `5h-Limit · ${left} übrig`,
    limitNA: '5h-Limit · n/a',
    limitReset: '5h-Limit · zurückgesetzt',
    resetAt: time => `Reset ${time}`,
    mood: {
      working: 'arbeitet …',
      ready: 'bereit',
      approval: 'braucht deine Freigabe',
      question: 'fragt dich',
      error: 'Fehler',
      done: 'fertig',
    },
    moodTitle: {
      working: 'arbeitet',
      ready: 'bereit',
      approval: 'braucht deine Freigabe',
      question: 'fragt dich',
      error: 'Fehler',
      done: 'fertig',
    },
    moodShort: { approval: 'Freigabe!', question: 'Frage!', agents: count => `${count} ${count === 1 ? 'Agent' : 'Agents'}` },
    agentsAtWork: (running, waiting) =>
      running > 0
        ? [
            `${running} ${running === 1 ? 'Agent läuft' : 'Agents laufen'}`,
            ...(waiting > 0 ? [`${waiting} ${waiting === 1 ? 'wartet' : 'warten'}`] : []),
          ].join(' · ')
        : `${waiting} ${waiting === 1 ? 'Agent wartet' : 'Agents warten'}`,
  },
  changes: {
    counter: (files, added, removed, isPartial) => [
      `${files} ${files === 1 ? 'Datei' : 'Dateien'}`,
      `+${added} −${removed}`,
      ...(isPartial ? ['unvollständig'] : []),
    ],
    empty: 'noch keine Änderungen',
    moreRows: count => `+${count} weitere ${count === 1 ? 'Datei' : 'Dateien'}`,
    missed: count => `+${count} ${count === 1 ? 'Datei' : 'Dateien'} ohne Zeilen (n/a)`,
    isNew: 'neu',
    deleted: 'gelöscht',
    note: 'Zeilen summiert, seit Laden',
  },
  agents: {
    counter: ({ running, waiting, done, failed, killed }) => [
      ...(running > 0 || done + failed + killed === 0 ? [`${running} ${running === 1 ? 'läuft' : 'laufen'}`] : []),
      ...(waiting > 0 ? [`${waiting} ${waiting === 1 ? 'wartet' : 'warten'}`] : []),
      ...(done > 0 ? [`${done} fertig`] : []),
      ...(failed > 0 ? [`${failed} fehlgeschlagen`] : []),
      ...(killed > 0 ? [`${killed} abgebrochen`] : []),
    ],
    compactCounter: ({ running, waiting, done, failed, killed }, processed) => [
      ...(running > 0 || done + failed + killed === 0 ? [`${running} ◉`] : []),
      ...(waiting > 0 ? [`${waiting} ◌`] : []),
      ...(done > 0 ? [`${done} ✓`] : []),
      ...(failed > 0 ? [`${failed} ✗`] : []),
      ...(killed > 0 ? [`${killed} ■`] : []),
      `verarbeitet ${processed}`,
    ],
    empty: 'noch keine Subagents',
    processed: 'Verarbeitet seit Laden',
    totals: (main, agents, other) => [`Haupt-Chat ${main}`, `Agents ${agents}`, `Sonstiges ${other}`],
    table: {
      columns: ['wer', 'Block', 'verarbeitet'],
      columnsTight: ['wer', 'Block', 'verarb.'],
      main: ['Haupt-Chat', 'du + Claude'],
      agents: ['Agents', 'Helfer'],
      other: ['Sonstiges', 'Haushalt'],
      ownBlock: 'eigene',
      total: 'Gesamt',
      rereads: 'Jeder Schritt liest den ganzen Block neu:',
      sum: (steps, each, total) => `Haupt-Chat ${steps} ${steps === 1 ? 'Schritt' : 'Schritte'} × ~${each} ≈ ${total}`,
    },
    steps: count => `${count} ${count === 1 ? 'Schritt' : 'Schritte'}`,
    figures: (context, processed, fresh) => `Kontext ${context} · verarbeitet ${processed} · davon neu ${fresh}`,
    figuresTight: (context, processed, fresh) => `Kontext ${context} · verarb. ${processed} · neu ${fresh}`,
    processedNA: 'verarbeitet –',
    ago: ms =>
      agoOf(
        ms,
        n => `vor ${n} s`,
        n => `vor ${n} min`,
        n => `vor ${n} h`,
      ),
    errors: count => `${count} Fehler`,
    timeline: 'Zeitleiste seit Laden',
    timelineShort: 'Zeitleiste',
    more: count => `+${count}`,
    note: 'Verarbeitet = Summe aller Schritte, inkl. Wiederholung aus dem Cache',
    back: name => `◀ Haupt-Chat · du siehst gerade ${name}`,
    backNote: 'Enter im Prompt geht jetzt an diesen Agent',
    someAgent: 'einen Agent',
    workflowAgent: 'Workflow-Agents siehst du über /workflows',
    viewDenied: reason => `Ansicht nicht möglich: ${reason}`,
  },
  command: {
    description: 'Öffnet das noxdeck-Pane (optional auf einem Tab: live, changes, agents)',
    opened: 'noxdeck geöffnet.',
    openedOn: tab => `noxdeck geöffnet: ${tab}.`,
  },
}

const en: Strings = {
  ...SHARED,
  percent: value => `${value}%`,
  percentTight: value => `${value}%`,
  decimal: '.',
  na: 'n/a',
  plan: { empty: 'no active plan', more: count => `+${count} more ${count === 1 ? 'step' : 'steps'}` },
  radar: {
    empty: 'nothing to note',
    loop: '⚠ going in circles:',
    failedTimes: (count, label) => `failed ${count}×: ${label}`,
    bashCommand: 'Bash command',
    errors: (count, tool, ago) => `${count} ${count === 1 ? 'error' : 'errors'} · last ${tool} ${ago}`,
    ago: ms => {
      const minutes = Math.floor(ms / 60_000)
      if (minutes < 1) return 'just now'
      if (minutes < 60) return `${minutes} min ago`
      return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} ago`
    },
    hotspots: 'Hotspots',
    waited: (time, isApprox, approvals) =>
      `Waited ${isApprox ? '≈' : ''}${time} · ${approvals} ${approvals === 1 ? 'approval' : 'approvals'}`,
  },
  context: {
    notMeasured: 'Context not measured yet',
    perTurn: signed => `avg ${signed}/Turn`,
    perTurnNA: 'avg n/a/Turn',
    compactIn: turns => `Auto-Compact in ~${turns} ${turns === 1 ? 'Turn' : 'Turns'}`,
    compactOff: 'Auto-Compact off',
    compactDue: 'Auto-Compact due',
    compactNA: 'Auto-Compact n/a',
    tools: count => `${count} ${count === 1 ? 'Tool' : 'Tools'}`,
    deferred: 'deferred',
    none: 'none',
    servers: count => `${count} ${count === 1 ? 'server' : 'servers'}`,
    moreFiles: count => `+${count} more ${count === 1 ? 'file' : 'files'}`,
    listed: count => `${count} listed`,
    of: count => `of ${count}`,
    stats: (hit, untilCompact, compactions) => [
      `Cache Hit ${hit}`,
      ...(untilCompact === null ? [] : [`~${untilCompact} left to Compact`]),
      `compacted ${compactions}×`,
      'since load',
    ],
  },
  status: {
    noxAlt: 'Nox the owl',
    editing: file => `✎ Editing ${file}`,
    lastEdit: file => `last: ${file}`,
    noEdits: '✎ no edits yet',
    limit: left => `5h limit · ${left} left`,
    limitNA: '5h limit · n/a',
    limitReset: '5h limit · reset',
    resetAt: time => `Reset ${time}`,
    mood: {
      working: 'working …',
      ready: 'ready',
      approval: 'needs your approval',
      question: 'asking you',
      error: 'error',
      done: 'done',
    },
    moodTitle: {
      working: 'working',
      ready: 'ready',
      approval: 'needs your approval',
      question: 'asking you',
      error: 'error',
      done: 'done',
    },
    moodShort: { approval: 'approve!', question: 'question!', agents: count => `${count} ${count === 1 ? 'agent' : 'agents'}` },
    agentsAtWork: (running, waiting) =>
      running > 0
        ? [`${running} ${running === 1 ? 'agent' : 'agents'} running`, ...(waiting > 0 ? [`${waiting} waiting`] : [])].join(' · ')
        : `${waiting} ${waiting === 1 ? 'agent' : 'agents'} waiting`,
  },
  changes: {
    counter: (files, added, removed, isPartial) => [
      `${files} ${files === 1 ? 'file' : 'files'}`,
      `+${added} −${removed}`,
      ...(isPartial ? ['partial'] : []),
    ],
    empty: 'no edits yet',
    moreRows: count => `+${count} more ${count === 1 ? 'file' : 'files'}`,
    missed: count => `+${count} ${count === 1 ? 'file' : 'files'} without lines (n/a)`,
    isNew: 'new',
    deleted: 'deleted',
    note: 'lines summed, since load',
  },
  agents: {
    counter: ({ running, waiting, done, failed, killed }) => [
      ...(running > 0 || done + failed + killed === 0 ? [`${running} running`] : []),
      ...(waiting > 0 ? [`${waiting} waiting`] : []),
      ...(done > 0 ? [`${done} done`] : []),
      ...(failed > 0 ? [`${failed} failed`] : []),
      ...(killed > 0 ? [`${killed} stopped`] : []),
    ],
    compactCounter: ({ running, waiting, done, failed, killed }, processed) => [
      ...(running > 0 || done + failed + killed === 0 ? [`${running} ◉`] : []),
      ...(waiting > 0 ? [`${waiting} ◌`] : []),
      ...(done > 0 ? [`${done} ✓`] : []),
      ...(failed > 0 ? [`${failed} ✗`] : []),
      ...(killed > 0 ? [`${killed} ■`] : []),
      `processed ${processed}`,
    ],
    empty: 'no subagents yet',
    processed: 'Processed since load',
    totals: (main, agents, other) => [`Main chat ${main}`, `Agents ${agents}`, `Other ${other}`],
    table: {
      columns: ['who', 'block', 'processed'],
      columnsTight: ['who', 'block', 'proc.'],
      main: ['Main chat', 'you + Claude'],
      agents: ['Agents', 'helpers'],
      other: ['Other', 'housekeeping'],
      ownBlock: 'own',
      total: 'Total',
      rereads: 'Every step re-reads the whole block:',
      sum: (steps, each, total) => `Main chat ${steps} ${steps === 1 ? 'step' : 'steps'} × ~${each} ≈ ${total}`,
    },
    steps: count => `${count} ${count === 1 ? 'step' : 'steps'}`,
    figures: (context, processed, fresh) => `context ${context} · processed ${processed} · new ${fresh}`,
    figuresTight: (context, processed, fresh) => `ctx ${context} · proc. ${processed} · new ${fresh}`,
    processedNA: 'processed –',
    ago: ms =>
      agoOf(
        ms,
        n => `${n} s ago`,
        n => `${n} min ago`,
        n => `${n} h ago`,
      ),
    errors: count => `${count} ${count === 1 ? 'error' : 'errors'}`,
    timeline: 'Timeline since load',
    timelineShort: 'Timeline',
    more: count => `+${count}`,
    note: 'Processed = sum over all steps, cache re-reads included',
    back: name => `◀ Main chat · you are viewing ${name}`,
    backNote: 'Enter in the prompt now goes to this agent',
    someAgent: 'an agent',
    workflowAgent: 'You see workflow agents in /workflows',
    viewDenied: reason => `View not possible: ${reason}`,
  },
  command: {
    description: 'Open the noxdeck pane (optionally on a tab: live, changes, agents)',
    opened: 'noxdeck opened.',
    openedOn: tab => `noxdeck opened on ${tab}.`,
  },
}

export const LOCALES: Readonly<Record<Locale, Strings>> = { de, en }

export function stringsOf(locale: unknown): Strings {
  return locale === 'de' ? de : en
}
