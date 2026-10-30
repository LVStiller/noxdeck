# noxdeck

[English](README.md) · **Deutsch**

Ein Mod für Claude Code: ein Retro-Terminal-Dashboard in einem Pane neben dem Transkript, mit Nox, einer kleinen Pixel-Eule, die zeigt, was Claude gerade tut. Er beobachtet nur.

![Nox in seinen fünf Kostümen](docs/noxdeck-costumes.png)

## Was er zeigt

- **Live** (der Standard-Tab):
  - **STATUS**: die Datei, die Claude gerade bearbeitet, das 5-Stunden-Limit als fünf Herzen oder als Balken aus zehn Zellen mit der Uhrzeit, zu der es zurückgesetzt wird, und Nox mit einer Zeile darunter (arbeitet, bereit, braucht deine Freigabe, fragt dich, Fehler, fertig, Agents bei der Arbeit).
  - **CONTEXT**: wie voll das Kontextfenster ist, nach Quelle (Nachrichten, MCP, Tools, Memory, Skills, System), ein Verlauf, das Wachstum pro Turn, die Cache-Trefferquote und wie viel bis zur automatischen Kompaktierung bleibt.
  - **RADAR**: derselbe Aufruf, der wieder und wieder scheitert, die Fehler seit dem Laden, die am häufigsten gelesenen oder bearbeiteten Dateien (Hotspots) und wie lange Freigabedialoge auf dich gewartet haben. Solange die Sitzung ein Todo-Tool hat, steht an seiner Stelle **PLAN** mit Claudes Todo-Liste.
- **Changes**: die in dieser Sitzung geänderten Dateien mit hinzugefügten und entfernten Zeilen, jede mit ihrem Pfad ab dem Projektordner. Cache- und Build-Dateien, die ein Bash-Befehl nebenbei erzeugt (in `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `node_modules`, `.venv` oder `.git`, `*.pyc`, `*.pyo`, `.DS_Store`), werden unter der Liste gezählt, nicht aufgeführt; ein Edit oder Write dort steht immer in der Liste.
- **Agents**: was Haupt-Chat, Subagents und andere Schleifen seit dem Laden verarbeitet haben, Modell, Tokens und aktuelle Tätigkeit jedes Subagents, in Gruppen, die sich zuklappen lassen, und eine Zeitleiste. Ein Druck auf die Zeile eines Agents zeigt sein Transkript in der Hauptansicht.

Nox ist ein Pixelbild, wo das Terminal Bilder zeichnet (Ghostty, kitty; iTerm2 ab 3.5 mit Vollbild-Rendering; tmux mit eingeschaltetem `allow-passthrough` und `focus-events`), und überall sonst aus Blockzeichen. Nox liest, schreibt, arbeitet in der Shell, denkt nach, winkt, wenn ein Subagent startet, wartet auf dich, freut sich, wenn der Turn fertig ist, erschrickt bei einem Fehler, warnt vor einer Schleife, schwitzt, wenn der Kontext voll wird, wird müde, wenn das 5-Stunden-Limit knapp wird, und gähnt und schläft nach zwei Minuten ohne Turn. Wo das Pane niedrig ist, nimmt eine Mini-Eule seinen Platz ein.

## Installation

Dieses Repository ist sein eigener Plugin-Marketplace: [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) nennt ein Plugin, `noxdeck`, aus dem Wurzelordner des Repositorys.

In Claude Code:

```
/plugin marketplace add LVStiller/noxdeck
/plugin install noxdeck@noxdeck
```

Oder in einer Shell in einem Schritt: `claude plugin install noxdeck --marketplace LVStiller/noxdeck`. Das fügt zuerst den Marketplace `noxdeck` hinzu, falls er noch fehlt.

Aktualisieren: `claude plugin marketplace update noxdeck`, `claude plugin update noxdeck@noxdeck`, dann `/reload-plugins` in einer laufenden Sitzung.

## Benutzung

- Das Pane öffnet sich von selbst in Terminals ab 144 Spalten Breite (das Vollbild-Layout dockt es neben dem Transkript an).
- `/noxdeck` öffnet es bei jeder Breite; `/noxdeck live`, `/noxdeck changes` und `/noxdeck agents` öffnen es auf diesem Tab.
- Einen Tab anklicken, oder das Pane fokussieren (ctrl+x tab) und Tab und Enter benutzen.

## Getestet mit

Claude Code 2.1.312. Die Mod-API ist Early Access und kann sich zwischen Releases ändern.

## Einstellungen

In `/config`, jeweils unter `noxdeck.<name>`, oder bei der Installation in einer Shell mit `--config <name>=<wert>` (zum Beispiel `claude plugin install noxdeck@noxdeck --config language=de`, sobald der Marketplace hinzugefügt ist).

| Einstellung | Werte | Was sie tut |
| --- | --- | --- |
| `language` | `en` (Standard), `de` | Sprache der Sätze und Zustände im Pane. Tab-Namen, Kartentitel und eingeführte Begriffe (Context, Tokens, MCP, Cache Hit, Auto-Compact, Hotspots, …) bleiben Englisch. |
| `noxStyle` | `fein` (Standard), `klassisch` | Der Stil: `fein` zeichnet Nox als Pixelbild, wo das Terminal es kann, sonst aus Blockzeichen; `klassisch` zeichnet immer die Blockzeichen. |
| `noxPalette` | `standard` (Standard), `nacht`, `retro` | Die Palette des Pixel-Nox: Lavendel, Blau und Silber oder Grüntöne. |
| `noxCostume` | `ohne` (Standard), `zauberer`, `astronaut`, `detektiv`, `hacker`, `zufall` | Das Kostüm des Pixel-Nox: keins, Zauberer, Astronaut, Detektiv oder Hacker. `zufall` zieht zu Beginn jeder Sitzung eines der vier und behält es bis zum Ende der Sitzung, auch über ein Neuladen hinweg. Der Block-Nox trägt keins. |
| `animations` | `voll` (Standard), `ruhig`, `aus` | Wie viel Nox sich bewegt: jede Animation, nur Blinzeln und der Wechsel des Zustands, oder ein Standbild. Die Claude-Code-Einstellung Reduce motion hält `voll` auf `ruhig`. |
| `limitStyle` | `hearts` (Standard), `bar` | Wie STATUS das 5-Stunden-Limit zeichnet: fünf Herzen oder ein Balken aus zehn Zellen. |
| `theme` | `classic` (Standard) | Das Farbschema des Panes; es zeichnet in den Farben deines Claude-Code-Themes. |

## Was dieser Mod kann

`claude plugin validate .` liest das Hooks-Modul so, wie Claude Code es lädt, und nennt jedes Ereignis, in das es sich einhängt, und jeden Aufruf, den es auf `$` macht. Für noxdeck 1.0.2:

```
hooks: session.start, command.run{command=noxdeck}, ui.close{id=noxdeck}, tool.call, agent.spawn, tool.check, classic.PreToolUse, classic.PermissionRequest, classic.PermissionDenied, classic.PostToolUseFailure, classic.PostToolUse, turn.step, turn.start, turn.complete, session.measure, session.compact, session.end, ui.render{component=Pane, requestId=noxdeck}, ui.render{component=SessionMode}
calls: $.agent.list, $.clock.after, $.clock.every (via ensureTicker), $.clock.now, $.command.register, $.session.root (via refreshRoot), $.session.usage (via refreshContext), $.settings.read (via readMotion), $.state.get, $.state.set, $.tool.list (via refreshTodoTools), $.ui.blit (via blit), $.ui.open (via openPane), $.ui.panes (via isPaneOpen, isPaneShown), $.ui.resolve, $.ui.toast, $.ui.view (via showView)
```

Jeder Hook gibt sein Ereignis unverändert weiter und liefert zurück, was Claude Code geantwortet hat. Die Aufrufe lesen (Tools, Kontextverbrauch, den Projektordner, Agents, Panes, die Einstellung Reduce motion), registrieren `/noxdeck`, betreiben seinen Timer, zeichnen sein eigenes Pane und halten seine Zahlen in seinem eigenen `$.state`. Ein Aufruf handelt, und nur, wenn du auf die Zeile eines Agents drückst: `$.ui.view` zeigt das Transkript dieses Agents in der Hauptansicht; eine Ablehnung (oder, bei einem Agent eines Workflows, wo er zu sehen ist) erscheint mit `$.ui.toast`.

Kein Netzwerk, keine Dateischreibzugriffe, kein Prompt-Logging: noxdeck stellt keine Netzwerkanfragen, schreibt keine Dateien, startet keine Prozesse, ruft kein Modell auf, behält keinen Prompt-Text und liest kein Transkript eines Agents. Geheimnisse in Befehlen, die es zeigt (Tokens, Schlüssel, Passwörter), werden maskiert. Nox' Bilder entstehen im Speicher.

## Entwickeln

```sh
claude plugin validate .
claude plugin test .
```

Alle Texte des Panes stehen in [`hooks/strings.ts`](hooks/strings.ts), auf Englisch und Deutsch; ein Test schlägt fehl, wenn einer der beiden Sprachen ein Schlüssel fehlt.

## Hinweis

noxdeck steht in keiner Verbindung zu Anthropic. Es ist ein Hobbyprojekt, ohne Gewährleistung und ohne Support-Versprechen. Siehe [LICENSE](LICENSE) (MIT). Sicherheitslücken: siehe [SECURITY.md](SECURITY.md).

## Autor

Luis Vincent Stiller, [github.com/LVStiller](https://github.com/LVStiller)

## Support

Wenn dir noxdeck nützt, kannst du es auf [Ko-fi](https://ko-fi.com/noxdeck) unterstützen.
