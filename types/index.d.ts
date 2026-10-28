// The values noxdeck keeps in $.state: plain data the pane draws from.
// Nothing here is persisted to disk; the host holds it for the session.

/** The pane's tabs; `live` holds STATUS, CONTEXT and RADAR (or PLAN). */
export type Tab = 'changes' | 'agents' | 'live'

export type StepStatus = 'pending' | 'in_progress' | 'completed'

export type PlanStep = {
  /** TodoWrite has no ids: its position; the task tools: the task's id. */
  id: string
  text: string
  /** The present-continuous form shown while the step runs, when known. */
  activeText: string | null
  status: StepStatus
}

export type ContextSource = {
  /**
   * The group the breakdown rows were summed into, by the names /context
   * prints them under (display only): messages, tools, mcp, memory, skills,
   * system, or other for a row no known name covers.
   */
  key: string
  tokens: number
  /** The theme key /context draws the group's largest row in. */
  color: string
}

/** The status line's own figures: measured on the last response, not estimated. */
export type ExactFill = { tokens: number; window: number; percent: number }

export type McpServerUse = {
  server: string
  tools: number
  /** Tokens of the tool schemas inside the window now. */
  tokens: number
  /** Tools whose schemas load on demand and are not in the window. */
  deferred: number
}

export type MemoryUse = { path: string; kind: string; tokens: number }

export type ContextSnapshot = {
  /** Null until the live window had a response (a fresh or just compacted session). */
  exact: ExactFill | null
  /** The breakdown's own estimate of the tokens in use. */
  totalTokens: number
  /**
   * The model's context window: every share, mark and scale on the card is
   * against it, so header, bar, legend and history agree (the breakdown's
   * own compaction window may be smaller).
   */
  window: number
  sources: ContextSource[]
  /**
   * Token count at which auto-compaction runs; null when it is off. The
   * engine's own figure (the breakdown's `autoCompactThreshold`), so it
   * follows a compaction window set with /autocompact.
   */
  threshold: number | null
  mcp: McpServerUse[]
  memory: MemoryUse[]
  skills: { listed: number; total: number; tokens: number } | null
}

/** One finished main turn's measured fill: the status line's tokens over the window. */
export type ContextSample = { tokens: number; window: number }

export type UsageTrack = {
  /** One sample per measured main-thread turn, oldest first. */
  history: ContextSample[]
  /** Compactions that stood since noxdeck loaded. */
  compactions: number
  /** Main-loop input tokens summed over observed turns. */
  cacheRead: number
  inputTotal: number
}

export type RateWindow = { percentUsed: number; resetsAt: string | null }

export type Activity = {
  isWorking: boolean
  /** The last main turn ended in an API error or a refusal. */
  hasTurnError: boolean
  /** The latest main-loop tool call in this turn failed. */
  hasToolError: boolean
  /**
   * Absolute path of the file Claude is editing: an Edit/Write/NotebookEdit
   * call in flight, then the file it changed last while the main turn runs.
   */
  editing: string | null
  lastEdited: string | null
  /** When the last main turn ended with an answer: the mascot is done for a while. */
  answeredAt: number | null
}

/**
 * What a main-loop tool call has the mascot do: read, edit, shell, ask (a
 * question to the person), approve (a plan for the person to approve), other.
 */
export type ToolKind = 'read' | 'edit' | 'shell' | 'ask' | 'approve' | 'other'

/**
 * A permission dialog open now: the call it was raised for (its tool_use_id
 * when tool.check named it, else null), its tool, and its loop (null: the
 * main loop).
 */
export type Ask = { id: string | null; tool: string; agentId: string | null }

/** What the mascot reacts to besides the turn itself (Activity). */
export type Cues = {
  /** The main loop's tool calls running now, oldest first. */
  running: { id: string; kind: ToolKind }[]
  /** The permission dialogs open now; each ends with its call, or when a hook decides it. */
  asking: Ask[]
  /** When the last main-loop tool call or main turn failed. */
  startledAt: number | null
  /** When the last subagent was spawned. */
  wavedAt: number | null
  /** Since when no main turn has run: the mascot yawns, then falls asleep. */
  restingSince: number
  /** Time approval dialogs stood open (any of them), summed over the ones closed. */
  waitedMs: number
  /** Since when one is open; null while none is. */
  waitingSince: number | null
  /** A dialog's end was taken from its call's end, after the tool ran: the sum is approximate. */
  isWaitApprox: boolean
  /** Approval dialogs opened (a question to answer is none). */
  approvals: number
}

/** The mascot's frames (hooks/mascot.ts draws each). */
export type MascotFrame =
  | 'idle'
  | 'blink'
  | 'lookLeft'
  | 'lookRight'
  | 'yawn'
  | 'sleep'
  | 'sleepRising'
  | 'sleepStill'
  | 'write'
  | 'write2'
  | 'focus'
  | 'wave1'
  | 'wave2'
  | 'think1'
  | 'think2'
  | 'think3'
  | 'question'
  | 'questionLow'
  | 'happy'
  | 'happyLanded'
  | 'startled'
  | 'startledLanded'
  | 'tired'
  | 'tiredBlink'

/** The mascot as drawn now: a frame and what is laid over it. */
export type Pose = {
  frame: MascotFrame
  /** Breathing in: the body one pixel higher, the feet where they stand. */
  isInhaling: boolean
  /** Heavy lids over open eyes: the 5h limit runs low. */
  isDrowsy: boolean
  /**
   * The sweat drop beside the head (context over 80 % of the auto-compact
   * threshold, of the window with auto-compaction off): 0 high, 1 a pixel
   * lower; null for none.
   */
  drop: 0 | 1 | null
}

/** The mini owl's frames (hooks/mascot.ts draws each): Nox's few states where the pane is short. */
export type MiniFrame =
  | 'idle'
  | 'blink'
  | 'walkLeft'
  | 'walkRight'
  | 'lookLeft'
  | 'hop'
  | 'hopLanded'
  | 'startled'
  | 'sleep'
  | 'sleepRising'

/** The mini owl as drawn now: a frame, its colors, and the drop beside its head. */
export type MiniPose = {
  frame: MiniFrame
  /** The person is waited on: the feathers in the accent. */
  isAsking: boolean
  /**
   * The sweat drop beside the head (context over 80 % of the auto-compact
   * threshold, of the window with auto-compaction off, or a scare): 0 high,
   * 1 a pixel lower; null for none.
   */
  drop: 0 | 1 | null
}

/**
 * Nox's states in the fine style (the `fein` style): the names the sprites'
 * states carry (hooks/sprites.ts), one animation each for Nox and the mini
 * owl in each costume; hooks/fine.ts picks one from the session's scene.
 */
export type NoxState =
  | 'ruhe'
  | 'gaehnen'
  | 'schlaf'
  | 'lesen'
  | 'schreiben'
  | 'shell'
  | 'denken'
  | 'winken'
  | 'wartet-auf-dich'
  | 'fertig'
  | 'fehler'
  | 'loop-warnung'
  | 'schweiss'
  | 'muede'

/**
 * The fine Nox's costumes (version 0.19), as the sprites name them: `ohne`
 * is Nox as it is. The `noxCostume` option names one, or `zufall`.
 */
export type NoxCostume = 'ohne' | 'zauberer' | 'astronaut' | 'detektiv' | 'hacker'

/** A fine owl as drawn now (Nox's or the mini owl's sprites). Kept in the module, never in $.state. */
export type FinePose = {
  /** The costume it wears: its frames and its drop of sweat. */
  costume: NoxCostume
  state: NoxState
  /** The frame shown: its index in the size's frames. */
  frame: number
  /** The sweat drop laid over it: the index of the costume's `schweiss` frame whose drop pixels it is; null for none. */
  drop: number | null
}

/**
 * What RADAR shows of a call: its tool, and a description or a file's name
 * (masked, never a command or a path); null for the tool alone.
 */
export type CallLabel = { tool: string; detail: string | null }

/** The main loop's latest run of one call (one tool, one target) failing. */
export type FailStreak = CallLabel & {
  /**
   * The call's identity: its tool and a hash of its target (Bash: its
   * description, else its command without flags), never the target itself.
   */
  key: string
  count: number
}

/** How often one call failed in the main loop's current turn, whatever came between. */
export type FailCount = CallLabel & { key: string; count: number }

/** A file read or edited, by path (drawn by its name only), how often, and when last. */
export type FileUse = { path: string; count: number; at: number }

/** What RADAR reads: failures, a failing call repeated, the files most used. */
export type Radar = {
  /** Main-loop tool calls that failed since noxdeck loaded (a refusal or an interrupt is none). */
  errors: number
  lastError: { tool: string; at: number } | null
  streak: FailStreak | null
  /** The current main turn's failures by call (the last turn's between turns), the most failed first. */
  turnFails: FailCount[]
  /** Reads and edits of the main loop and its subagents, by path; the most used first. */
  files: FileUse[]
}

/** Whether the session has a todo tool (TodoWrite or the task tools): the PLAN card shows, else RADAR. */
export type TodoTools = {
  /** `$.tool.list()` named one when last asked. */
  isListed: boolean
  /** One answered a call in this conversation. */
  isUsed: boolean
}

export type FileChange = {
  path: string
  /** null when the tool's record did not say (a write too large to diff). */
  added: number | null
  removed: number | null
  isNew: boolean
  isDeleted: boolean
  edits: number
  at: number
}

export type AgentRow = {
  id: string
  /** From its agent.spawn or $.agent.list(); null for loops neither names. */
  description: string | null
  type: string | null
  /** As $.agent.list() last listed it; null while it was never listed. */
  listedStatus: string | null
  /** Why its last turn ended (turn.complete reason), for unlisted agents. */
  endReason: string | null
  /** When its current turn started, while one runs. */
  turnStartedAt: number | null
  /** Sum of its finished turns' durationMs. */
  doneMs: number
  /** Whether a turn of it was timed at all (else the duration is n/a). */
  isTimed: boolean
  /** Listed once, then dropped by $.agent.list(): its loop has ended. */
  isGone: boolean
  firstSeen: number
}

/**
 * What one loop's model requests cost, as each `turn.step` result reported
 * it (`usage`), summed; and what the last of them said.
 */
export type TokenTally = {
  /** Model requests seen, with a reported usage or without. */
  steps: number
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  /** The last reported request's input, cache read and cache creation: its context then; null before one. */
  context: number | null
  /** The model of the last request that reported usage (`usage.model`). */
  model: string | null
  /** The effort the last request asked for (`turn.step`'s input); null without one. */
  effort: string | null
}

/** A subagent's last tool call: the tool and the file's name only, never a command, prompt or pattern. */
export type AgentCall = { tool: string; file: string | null; at: number }

/** What noxdeck saw one loop other than the main chat do since it loaded, by its agentId. */
export type AgentWork = {
  id: string
  /**
   * A subagent: an `agent.spawn` noxdeck heard answered this id (a
   * workflow's agents too), or $.agent.list() named it. Else a loop no spawn
   * and no list names (the engine's forks for compaction or memory). Its
   * tokens are counted either way; the pane decides as it draws whether they
   * are the Agents pot's or Sonstiges, so a step heard before its spawn's
   * answer counts where its spawn puts it.
   */
  isAgent: boolean
  /**
   * Whether noxdeck saw it from its start: only then are its figures whole.
   * One there before noxdeck (or this version) loaded shows –.
   */
  isWhole: boolean
  /** Its requests' tokens; null while none was seen. */
  tally: TokenTally | null
  /** Its tool calls, and how many of them failed (a refusal is none). */
  calls: number
  errors: number
  lastCall: AgentCall | null
  /** When its first turn started and its last turn ended, as noxdeck heard them. */
  startedAt: number | null
  endedAt: number | null
}

/**
 * The tokens of every model request since noxdeck loaded: the main chat's
 * (no agentId), and every other loop's by its id in `work`. The pots the
 * pane shows are summed as it draws: Agents (the loops `isAgent` marks, and
 * `agentsPast`), Sonstiges (the others, and `otherPast`).
 */
export type AgentLedger = {
  /** When noxdeck loaded in this conversation: the timeline starts here. */
  since: number
  main: TokenTally
  /** The last 50 subagents and the last 20 other loops, oldest first. */
  work: AgentWork[]
  /** Subagents' tokens that left `work` past its 50: still the Agents pot's. */
  agentsPast: TokenTally
  /** Other loops' tokens that left `work` past its 20: kept as a sum in Sonstiges only. */
  otherPast: TokenTally
}

/** What the Agents tab draws, written at most once a second: the clock, the agents and their work. */
export type AgentBoard = { now: number; rows: AgentRow[]; ledger: AgentLedger }

/**
 * The groups the person folded on the Agents tab, by their prefix (`prüfen`
 * of `prüfen: model.ts`; a running group's as `live:prüfen`, the full card
 * alone): the full card's and the compact view's apart, each the groups
 * turned from that view's default.
 */
export type AgentFolds = {
  /** The full card shows its groups open; these the person closed. */
  closed: string[]
  /** The compact view shows its groups closed; these the person opened. */
  opened: string[]
}

// Every value is kept with a shape tag (STATE_SHAPE in hooks/register.tsx):
// $.state outlives a hot reload or /reload-plugins, and a value an older
// noxdeck wrote in another shape then reads as absent, never misread.
declare module 'claude-code' {
  interface PluginState {
    noxdeck: {
      tab: Shaped<Tab>
      plan: Shaped<PlanStep[]>
      context: Shaped<ContextSnapshot | null>
      usage: Shaped<UsageTrack>
      fiveHour: Shaped<RateWindow | null>
      activity: Shaped<Activity>
      changes: Shaped<FileChange[]>
      /** Files a Bash diff named no path for, or past the list's cap: counted, not listed. */
      missedFiles: Shaped<number>
      agents: Shaped<AgentRow[]>
      root: Shaped<string>
      now: Shaped<number>
      isDismissed: Shaped<boolean>
      cues: Shaped<Cues>
      /** Written by the animation tick only when the drawn pose changes, so the pane redraws no more than that. */
      pose: Shaped<Pose>
      /** The mini owl's pose, written by the same tick as `pose` and only when it changes. */
      miniPose: Shaped<MiniPose>
      radar: Shaped<Radar>
      todoTools: Shaped<TodoTools>
      /** Written at every step, tool call and turn of a loop; never read while drawing. */
      agentLedger: Shaped<AgentLedger>
      /** The Agents tab's snapshot of `agents`, `agentLedger` and the clock, written by the tick at most once a second. */
      agentBoard: Shaped<AgentBoard>
      /** Written when the person presses a group's head on the Agents tab (version 0.15). */
      agentFolds: Shaped<AgentFolds>
      /**
       * Whether the Agents tab's head `Verarbeitet seit Laden` is open, the
       * table of the pots in its place; written when the person presses it
       * (version 0.16). The full card's alone: the compact view has none.
       */
      isProcessedOpen: Shaped<boolean>
      /**
       * Whether the terminal draws pictures, as the probe or a blit of the fine
       * owl last learned (version 0.17): true, the fine Nox shows; false, the
       * block Nox; null before the first answer.
       */
      images: Shaped<boolean | null>
      /**
       * The costume `noxCostume` `zufall` drew at the session's start (noxdeck
       * 0.19): written once, while none is kept; a reload reads it and keeps
       * it, so the costume stays until the session ends. null before.
       */
      costume: Shaped<NoxCostume | null>
      /** Retired (version 0.7 drew its JETZT card from them): named once, read and never written. */
      turn: unknown
      pace: unknown
      /**
       * Retired (version 0.1 read it while drawing). Still named once, read
       * and never written: during a reload the old version's render may still
       * be running, and the engine judges its reads by this module's scan.
       */
      hasTodoTool: boolean | null
    }
  }
}
