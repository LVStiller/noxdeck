# Privacy

noxdeck is a Claude Code mod. It runs inside Claude Code on your machine and only draws its own pane.

## What noxdeck does not do

- It collects no data and has no telemetry or analytics.
- It sends nothing anywhere: it makes no network requests, starts no processes and calls no model.
- It keeps one thing beyond the running session: how often each conversation was compacted (see [Where it is kept](#where-it-is-kept)). It writes no other file.
- It keeps no prompt text and reads no agent's transcript.

## What it processes

To draw its pane, noxdeck reads what Claude Code passes to its hooks during the session: tool calls (the tool, a command or file path, Claude's plan steps), the names of changed files, the project folder, token counts and context usage, the usage limits (5-hour, weekly), and the subagents' names, types and models, and the names of workflow runs with each agent's place in its run. It reads one setting, Reduce motion. All of it is processed locally, in memory, and only to be shown in the pane. Secrets in the commands and texts it shows (tokens, keys, passwords) are masked. A subagent's prompt is kept only as a hash and its length, briefly, to tell which agent it started.

## Where it is kept

noxdeck keeps its figures in its own `$.state`: values Claude Code holds in memory for the running session. Like any mod's state, other mods running in the same session can read these values.

One figure outlasts the session, so that a conversation you continue keeps its count: how often each conversation was compacted. noxdeck keeps it in its own `$.store`: a JSON file that Claude Code keeps for the plugin under `plugins/store/` in your Claude Code configuration folder (by default `~/.claude/plugins/store/`), on this machine. An entry holds a short hash of the conversation's session id (the first 16 hex characters of its SHA-256, never the id itself), the count and a timestamp, and nothing else. At the start of a session, entries not written for more than 30 days are removed, and all but the newest 50. Nothing of it leaves your machine: noxdeck makes no network requests, and only Claude Code reads and writes the file, for noxdeck.

## Ko-fi

The README and the repository's Sponsor button link to [Ko-fi](https://ko-fi.com/noxdeck), an external service with its own privacy policy. noxdeck itself never contacts it.

## Contact

Responsible: Luis Vincent Stiller. Questions about privacy: open an issue at [github.com/LVStiller/noxdeck/issues](https://github.com/LVStiller/noxdeck/issues). Security reports: see [SECURITY.md](SECURITY.md).
