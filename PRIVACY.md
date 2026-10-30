# Privacy

noxdeck is a Claude Code mod. It runs inside Claude Code on your machine and only draws its own pane.

## What noxdeck does not do

- It collects no data and has no telemetry or analytics.
- It sends nothing anywhere: it makes no network requests, starts no processes and calls no model.
- It writes no files and keeps nothing beyond the running session.
- It keeps no prompt text and reads no agent's transcript.

## What it processes

To draw its pane, noxdeck reads what Claude Code passes to its hooks during the session: tool calls (the tool, a command or file path, Claude's plan steps), the names of changed files, the project folder, token counts and context usage, the 5-hour limit, and the subagents' names, types and models. It reads one setting, Reduce motion. All of it is processed locally, in memory, and only to be shown in the pane. Secrets in the commands and texts it shows (tokens, keys, passwords) are masked. A subagent's prompt is kept only as a hash, briefly, to tell which agent it started.

## Where it is kept

noxdeck keeps its figures in its own `$.state`: values Claude Code holds in memory for the running session. noxdeck uses no persistent storage and writes nothing to disk. Like any mod's state, other mods running in the same session can read these values.

## Ko-fi

The README and the repository's Sponsor button link to [Ko-fi](https://ko-fi.com/noxdeck), an external service with its own privacy policy. noxdeck itself never contacts it.

## Contact

Responsible: Luis Vincent Stiller. Questions about privacy: open an issue at [github.com/LVStiller/noxdeck/issues](https://github.com/LVStiller/noxdeck/issues). Security reports: see [SECURITY.md](SECURITY.md).
