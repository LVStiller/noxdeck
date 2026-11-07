import { describe, expect, test as kitTest } from 'claude-code/testing'
import type { AgentInfo, PluginRegisterInput, SessionRateLimit } from 'claude-code'
import { bashChangesOf, hiddenCount, isCachePath, NO_HIDDEN, projectPath, withHidden } from '../hooks/model'
import { LOCALES, stringsOf } from '../hooks/strings'
import {
  SURFACES,
  test,
  PANE,
  K,
  P,
  used,
  engine,
  start,
  TODOS,
  SPAWN,
  MOOD,
  captionOf,
  BAR,
  LIMIT_LINE,
  TWO_LINES,
  TALL,
  SHORT,
  poseIn,
  owlOf,
  shownPose,
  RUN,
  READ_RESULT,
  MINUTE,
  HOUR,
  ANSWERED,
  failedRun,
  textsAt,
  has,
} from './helpers'
import type { World, Found, Size } from './helpers'

const KEPT = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

/** A todo tool in the session: the PLAN card shows instead of RADAR. */
const WITH_TODO: World = { tools: ['TodoWrite'] }

/** The 5h limit bar's cells: the full ones in the accent, the empty ones in the track color. */
async function limitCells(ui: { findAll: (q: { type: string; text: RegExp }) => Promise<{ text: string; props: Record<string, unknown> }[]> }) {
  const runs = await ui.findAll({ type: 'Text', text: /^▊+$/ })
  const status = runs.slice(-2)
  const full = status.find(run => run.props.color === 'claude')?.text.length ?? 0
  const empty = status.find(run => run.props.color === 'subtle')?.text.length ?? 0
  return { full, empty }
}

describe('plan', () => {
  test('a TodoWrite list fills the PLAN card: running first, then open, then done, with x/y', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => ({ result: { oldTodos: [], newTodos: e.tool === 'TodoWrite' ? e.todos : [] } }))
    await start($)
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect((await ui.find({ type: 'Text', text: '2/4' }))?.text).toContain('2/4')
      const steps = (await ui.findAll({ type: 'Text' }))
        .map(found => found.text)
        .filter(text => /toggle|styles|tests|header/.test(text) && !/✓|○|◉/.test(text))
      expect(steps).toEqual(['Wiring it into the header', 'Run the tests', 'Add the toggle', 'Read the styles'])
      expect((await ui.find({ type: 'Text', text: '◉ ' }))?.props.color).toBe('claude')
      expect((await ui.find({ type: 'Text', text: '✓ ' }))?.props.color).toBe('success')
      expect((await ui.find({ type: 'Text', text: 'Read the styles' }))?.props.dimColor).toBe(true)
      await ui.unmount()
    }
  })

  test('the task tools build the plan too: create, start, delete', async ($, on) => {
    engine(on)
    let next = 0
    on('tool.call', (_, e) => {
      if (e.tool === 'TaskCreate') {
        next += 1
        return { result: { task: { id: String(next), subject: e.subject } } }
      }
      if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
      return { result: {} }
    })
    await start($)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Write the parser', description: 'd', activeForm: 'Writing the parser' })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Drop me', description: 'd' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'Writing the parser' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Drop me/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '0/1' })).toBeDefined()
    await ui.unmount()
  })
})

describe('context', () => {
  test('the CONTEXT card: measured header, grouped bar and legend, history, growth, table', async ($, on) => {
    // usage calls: session.start, the measure, two turn ends (one sample each), the compaction
    const clock = engine(on, { messages: [76 * K, 76 * K, 62 * K, 76 * K, 30 * K] })
    on('session.compact', (_, e) => ({ messages: e.messages, tokensBefore: 170 * K, tokensAfter: 40 * K }))
    await start($)
    await $.session.measure({ context: { window: 200 * K, tokens: 116 * K, percent: 58 }, rateLimits: [], changed: ['context'] })
    for (const turnId of ['t1', 't2']) {
      await $.turn.complete({
        turnId,
        answer: '',
        durationMs: 1,
        isAborted: false,
        reason: 'answer',
        usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, model: 'm' },
      })
    }

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      // Measured figures carry no ≈; the breakdown's estimates do.
      expect(await ui.find({ type: 'Text', text: `${P(58)} · 116k / 200k` })).toBeDefined()
      for (const [label, value] of [['messages', 38], ['tools', 9], ['mcp', 6], ['memory', 3], ['system', 2]] as const) {
        expect(await ui.find({ type: 'Text', text: `${label} ≈${P(value)}` })).toBeDefined()
      }
      expect(await ui.find({ type: 'Text', text: 'Ø +14k/Turn · Auto-Compact in ~4 Turns' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: P(84).padStart(6) })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '1 Server' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' · 31 Tools' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '≈12k' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /linear/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /CLAUDE\.md project/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '≈4,2k' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /24 gelistet/ })).toBeDefined()
      // 167k, the auto-compact threshold, less the 116k measured: ~51k left. No peak.
      expect(await ui.find({ type: 'Text', text: `Cache Hit ${P(90)} · noch ~51k bis Compact` })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Peak/ })).toBeUndefined()
      // Cache hits and compactions count from noxdeck's load: the line says so.
      expect(await ui.find({ type: 'Text', text: /^0× kompaktiert · seit Laden$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /ⓘ/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /main loop/ })).toBeUndefined()
      await ui.unmount()
    }

    await $.session.compact({ trigger: 'auto', messages: KEPT })
    await $.session.compact({ trigger: 'precompute', messages: KEPT })
    // Measured once the compaction is installed, after its chain returned; no history column for it.
    await clock.advance(1000)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    // Measured at 70k after compacting: ~97k left.
    expect(await ui.find({ type: 'Text', text: `Cache Hit ${P(90)} · noch ~97k bis Compact` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1× kompaktiert · seit Laden$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: `${P(35)} · 70k / 200k` })).toBeDefined()
    await ui.unmount()
  })

  test('a compaction window set with /autocompact: mark, line, forecast and what is left follow the engine\'s threshold', async ($, on) => {
    // A 1M model whose session compacts at 667k (/autocompact 700k): turns at 480k, 520k and 670k.
    engine(on, {
      window: 1000 * K,
      autoCompact: { window: 700 * K, threshold: 667 * K, source: 'settings' },
      messages: [360 * K, 440 * K, 480 * K, 630 * K],
    })
    await start($)
    const turn = (turnId: string) => $.turn.complete({ turnId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    await turn('t1')
    await turn('t2')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      // The header stays the status line's: against the model's whole window.
      expect(await ui.find({ type: 'Text', text: `${P(52)} · 520k / 1M` })).toBeDefined()
      // The mark at 667k of 1M: cell 26 of 40 (the model's own 967k put it at 38).
      const bar = (await ui.findAll({ type: 'Text' })).find(
        found => found.props.wrap === 'truncate' && found.text.length === 40 && /^█*│█*$/.test(found.text),
      )
      expect(bar?.text.indexOf('│')).toBe(26)
      // The dotted line and the history's scale at the threshold, the forecast to it.
      expect(await ui.find({ type: 'Text', text: P(67).padStart(6) })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Ø +40k/Turn · Auto-Compact in ~4 Turns' })).toBeDefined()
      // 667k less 520k: ~147k left, though the window has 480k free.
      expect(await ui.find({ type: 'Text', text: 'Cache Hit n/a · noch ~147k bis Compact' })).toBeDefined()
      await ui.unmount()
    }

    // Past 667k compaction is due, though the model's window is a third free.
    await turn('t3')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /· Auto-Compact fällig$/ })).toBeDefined()
    // 670k is past the threshold: nothing left, never a negative figure.
    expect(await ui.find({ type: 'Text', text: 'Cache Hit n/a · noch ~0 bis Compact' })).toBeDefined()
    await ui.unmount()
  })

  test('with auto-compaction off the stats say nothing about what is left', async ($, on) => {
    engine(on, { window: 1000 * K, autoCompact: { window: 1000 * K, threshold: null, source: 'auto' }, messages: [480 * K] })
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: `${P(52)} · 520k / 1M` })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: P(100).padStart(6) })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Ø n/a/Turn · Auto-Compact aus' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Cache Hit n/a · 0× kompaktiert' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /bis Compact|Peak/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('in English: ~51k left to Compact', { options: { language: 'en' } }, async ($, on) => {
    engine(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'Cache Hit n/a · ~51k left to Compact' })).toBeDefined()
    await ui.unmount()
  })

  test('nothing measured yet: short German states, never a made-up number', async ($, on) => {
    engine(on, { isMeasured: false })
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: 'Context noch nicht gemessen' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: LIMIT_LINE })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'RADAR · keine Auffälligkeiten' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'kein Plan aktiv' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: '✎ noch keine Änderungen' })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('status', () => {
  test('the limit bar follows the 5h window, the edited file and the mascot follow the turn', BAR, async ($, on) => {
    const outer = $
    const clock = engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] })
    // While the Edit runs beneath the plugin, the pane already says so.
    const editingSeen: (string | undefined)[] = []
    on('tool.call', async (_, e) => {
      const ui = await outer.ui.mount({ ...PANE, surface: 'terminal' })
      // The STATUS card's line (JETZT lists the call itself as `✎ Edit …`).
      const line = await ui.find({ type: 'Text', text: /^✎ (bearbeitet|noch)/ })
      editingSeen.push(`${line?.text} ${String(line?.props.color)}`)
      await ui.unmount()
      if (e.tool === 'Bash') return failedRun(outer, e)
      return { result: { filePath: '/proj/src/Toggle.tsx', structuredPatch: [], originalFile: '' } }
    })
    await start($)

    const caption = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const found = (await captionOf(ui))?.text
      await ui.unmount()
      return found
    }

    expect(await caption()).toBe('bereit')
    await $.turn.start({ text: '', turnId: 't1' })
    expect(await caption()).toBe('arbeitet …')
    await $.tool.call({ tool: 'Edit', file_path: '/proj/src/Toggle.tsx', old_string: 'a', new_string: 'b' })
    expect(editingSeen).toEqual(['✎ bearbeitet Toggle.tsx claude'])
    await $.tool.call({ tool: 'Bash', command: 'just test' })
    expect(await caption()).toBe('Fehler')
    // Claude is still at work in this turn: the file stays the one it is editing, bold in the accent.
    const during = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const editing = await during.find({ type: 'Text', text: '✎ bearbeitet Toggle.tsx' })
    expect(editing?.props.bold).toBe(true)
    expect(editing?.props.color).toBe('claude')
    expect(await during.find({ type: 'Text', text: /^zuletzt: / })).toBeUndefined()
    await during.unmount()
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    expect(await caption()).toBe('fertig')
    await clock.advance(31_000)
    expect(await caption()).toBe('bereit')
    await $.turn.start({ text: '', turnId: 't2' })
    await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, reason: 'error' })
    expect(await caption()).toBe('Fehler')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await limitCells(ui)).toEqual({ full: 7, empty: 3 })
      expect(await ui.find({ type: 'Text', text: ` 5h-Limit · ${P(70)} übrig` })).toBeDefined()
      const last = await ui.find({ type: 'Text', text: 'zuletzt: Toggle.tsx' })
      expect(last?.props.dimColor).toBe(true)
      expect(last?.props.bold).not.toBe(true)
      expect(await ui.find({ type: 'Text', text: /bearbeitet/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('the mascot blinks while waiting and moves while working', async ($, on) => {
    const clock = engine(on)
    await start($)
    const frames = async () => {
      const seen = new Set<string>()
      for (let i = 0; i < 6; i += 1) {
        const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
        seen.add(JSON.stringify(await ui.drawn()))
        await ui.unmount()
        await clock.advance(1000)
      }
      return seen.size
    }
    expect(await frames()).toBeGreaterThan(1)
    await $.turn.start({ text: '', turnId: 't1' })
    expect(await frames()).toBeGreaterThan(1)
  })

  test('a measured rate-limit move updates the limit bar', BAR, async ($, on) => {
    engine(on)
    await start($)
    await $.session.measure({
      context: { window: 200 * K },
      rateLimits: [{ kind: 'five_hour', percentUsed: 95 }],
      changed: ['rateLimits'],
    })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await limitCells(ui)).toEqual({ full: 1, empty: 9 })
    expect(await ui.find({ type: 'Text', text: ` 5h-Limit · ${P(5)} übrig` })).toBeDefined()
    await ui.unmount()
  })
})

describe('changes', () => {
  test('Edit, Write and Bash diffs add up per file; staged and failed calls do not count', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => {
      if (e.tool === 'Edit' && e.old_string === 'staged') return { result: { filePath: e.file_path, staged: true, structuredPatch: [] } }
      if (e.tool === 'Edit' && e.old_string === 'fails') return { isError: true, result: 'no match', text: 'no match' }
      if (e.tool === 'Edit') {
        const hunk = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: ['-a', '+b', '+c', ' d'] }
        return { result: { filePath: e.file_path, structuredPatch: [hunk], originalFile: 'a\nd\n' } }
      }
      if (e.tool === 'Write') return { result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }
      if (e.tool === 'Bash') {
        const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] }
        return { result: { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/proj/notes.md', hunks: [hunk] }], moreFiles: 0 } } }
      }
      return { result: {} }
    })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/proj/theme.css', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/theme.css', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/skip.css', old_string: 'staged', new_string: 'b' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/skip.css', old_string: 'fails', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/proj/src/Toggle.tsx', content: 'one\ntwo\nthree\n' })
    await $.tool.call({ tool: 'Bash', command: "sed -i '' s/x/y/ notes.md" })
    await $.command.run({
      command: 'noxdeck',
      args: 'changes',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 200 },
    })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: '3 Dateien · +8 −3' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'theme.css' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'src/Toggle.tsx' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'notes.md' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /skip\.css/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^\+4 −2$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^neu \+3 −0$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^\+1 −1$/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('cache files from Bash are counted, not listed; a real file from Bash and an Edit under node_modules are listed', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => {
      if (e.tool === 'Edit') {
        const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }
        return { result: { filePath: e.file_path, structuredPatch: [hunk], originalFile: 'a\n' } }
      }
      const hunk = { oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+a', '+b'] }
      const diff =
        e.tool === 'Bash' && e.command === 'pytest'
          ? {
              files: [],
              changedFiles: [
                '/proj/__pycache__/app.cpython-312.pyc',
                '/proj/tests/__pycache__/test_app.cpython-312-pytest-8.3.4.pyc',
                '/proj/.pytest_cache/v/cache/nodeids',
              ],
              moreFiles: 0,
            }
          : {
              files: [{ filePath: '/proj/models.py', created: true, hunks: [hunk] }],
              changedFiles: ['/proj/models.py', '/proj/__pycache__/gen.cpython-312.pyc'],
              moreFiles: 0,
            }
      return { result: { stdout: '', stderr: '', interrupted: false, bashEditDiff: diff } }
    })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/proj/node_modules/pkg/index.js', old_string: 'a', new_string: 'b' })
    let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ type: 'Text', text: 'node_modules/pkg/index.js' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ausgeblendet/ })).toBeUndefined()
    await ui.unmount()

    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    await $.tool.call({ tool: 'Bash', command: 'pytest' })
    await $.tool.call({ tool: 'Bash', command: 'python gen.py' })
    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'models.py' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^neu \+2 −0$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'node_modules/pkg/index.js' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /pycache|pytest_cache|\.pyc$/ })).toBeUndefined()
    // pytest's three files, twice, and the generator's .pyc: four files.
    expect(await ui.find({ type: 'Text', text: '+4 Cache-Dateien ausgeblendet' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2 Dateien · +3 −1' })).toBeDefined()
    await ui.unmount()
  })

  test('in English: the cache files hidden under an empty list; files a command named no path for still count', { options: { language: 'en' } }, async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => {
      const diff =
        e.tool === 'Bash' && e.command === 'npm install'
          ? { files: [], changedFiles: ['/proj/node_modules/.package-lock.json'], moreFiles: 3 }
          : { files: [], changedFiles: ['/proj/.DS_Store', '/proj/.venv/bin/python'], moreFiles: 0 }
      return { result: { stdout: '', stderr: '', interrupted: false, bashEditDiff: diff } }
    })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'uv venv' })
    let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ type: 'Text', text: 'no edits yet' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+2 cache files hidden' })).toBeDefined()
    await ui.unmount()

    await $.tool.call({ tool: 'Bash', command: 'npm install' })
    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '+2 files without lines (n/a)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+3 cache files hidden' })).toBeDefined()
    await ui.unmount()
  })

  test('the cache line in both languages, one file and more', () => {
    expect(stringsOf('de').changes.cacheFiles(1)).toBe('+1 Cache-Datei ausgeblendet')
    expect(stringsOf('de').changes.cacheFiles(4)).toBe('+4 Cache-Dateien ausgeblendet')
    expect(stringsOf('en').changes.cacheFiles(1)).toBe('+1 cache file hidden')
    expect(stringsOf('en').changes.cacheFiles(4)).toBe('+4 cache files hidden')
  })

  test('cache paths: those folders anywhere in the path, .pyc, .pyo and .DS_Store; look-alikes are not', () => {
    const hidden = [
      '/p/__pycache__/app.cpython-312.pyc',
      '/p/.pytest_cache/v/cache/lastfailed',
      '/p/.mypy_cache/3.12/app.meta.json',
      '/p/.ruff_cache/0.6.9/12345',
      '/p/web/node_modules/left-pad/index.js',
      '/p/.venv/lib/python3.12/site-packages/x.py',
      '/p/.git/index',
      '/p/legacy/mod.pyc',
      '/p/legacy/mod.pyo',
      '/p/docs/.DS_Store',
      'C:\\p\\node_modules\\x\\index.js',
      'node_modules/x/y.js',
    ]
    const shown = [
      '/p/app.py',
      '/p/.github/workflows/ci.yml',
      '/p/.gitignore',
      '/p/venv/x.py',
      '/p/src/pycache.py',
      '/p/node_modules.md',
      '/p/docs/notes.pyc.md',
      '/p/.DS_Store.bak',
    ]
    expect(hidden.filter(path => !isCachePath(path))).toEqual([])
    expect(shown.filter(isCachePath)).toEqual([])
  })

  test('cache files count each path once; past the cap the oldest fall off the list and stay counted', () => {
    expect(bashChangesOf({ bashEditDiff: { files: [], changedFiles: ['/p/a.pyc', '/p/b.py'], moreFiles: 3 } })).toEqual({
      changes: [{ path: '/p/b.py', added: null, removed: null, isNew: false, isDeleted: false }],
      hidden: ['/p/a.pyc'],
      missed: 1,
    })
    let hidden = withHidden(NO_HIDDEN, ['/p/a.pyc', '/p/b.pyc', '/p/a.pyc'], 3)
    expect(hidden).toEqual({ paths: ['/p/a.pyc', '/p/b.pyc'], evicted: 0 })
    expect(withHidden(hidden, ['/p/b.pyc'], 3)).toBe(hidden)
    hidden = withHidden(hidden, ['/p/c.pyc', '/p/d.pyc'], 3)
    expect(hidden).toEqual({ paths: ['/p/c.pyc', '/p/d.pyc', '/p/a.pyc'], evicted: 1 })
    expect(hiddenCount(hidden)).toBe(4)
  })
})

describe('observer', () => {
  test('the permission hooks and agent.spawn pass their events on unchanged and what answered them back as it came', async ($, on) => {
    engine(on)
    const seen: unknown[] = []
    const verdict = { decision: 'deny' as const, reason: 'Bash(rm:*) is denied' }
    const decided = { decision: { behavior: 'allow' as const } }
    const spawned = { model: 'm', agentId: 'a1' }
    on('tool.check', (_, e) => (seen.push(e), verdict))
    on('classic.PermissionRequest', (_, e) => (seen.push(e), decided))
    on('classic.PermissionDenied', (_, e) => (seen.push(e), {}))
    on('agent.spawn', (_, e) => (seen.push(e), spawned))
    await start($)
    const check = { tool: 'Bash', input: { command: 'rm -rf /' }, tool_use_id: 'tu-1' }
    const request = { tool_name: 'Bash', tool_input: { command: 'ls' } }
    const denied = { tool_name: 'Bash', tool_input: { command: 'rm x' }, tool_use_id: 'tu-3', reason: 'auto mode' }
    const spawn = { ...SPAWN, description: 'look around' }
    expect(await $.tool.check(check as never)).toEqual(verdict)
    expect(await $.classic.PermissionRequest(request)).toEqual(decided)
    expect(await $.classic.PermissionDenied(denied)).toEqual({})
    expect(await $.agent.spawn(spawn)).toEqual(spawned)
    for (const [i, sent] of [check, request, denied, spawn].entries()) expect(seen[i]).toMatchObject(sent)
  })

  test('a PreToolUse hook beneath hears the call as it came', async ($, on) => {
    engine(on)
    const seen: unknown[] = []
    on('classic.PreToolUse', (_, e) => (seen.push(e), {}))
    on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'curl -sSL https://example.com/data.json', tool_use_id: 'tu-2' })
    expect(seen).toEqual([{ tool: 'Bash', command: 'curl -sSL https://example.com/data.json', tool_use_id: 'tu-2' }])
  })

  test('tool calls and compactions pass through unchanged, results come back as answered', async ($, on) => {
    engine(on)
    const seen: unknown[] = []
    const answer = { result: { filePath: '/proj/a.ts', structuredPatch: [], originalFile: 'x' } }
    on('tool.call', (_, e) => {
      seen.push(e)
      return answer
    })
    on('session.compact', (_, e) => {
      seen.push(e)
      return { messages: e.messages }
    })
    await start($)
    const sent = { tool: 'Edit' as const, file_path: '/proj/a.ts', old_string: 'a', new_string: 'b' }
    const got = await $.tool.call(sent)
    expect(seen[0]).toMatchObject(sent)
    expect(got.result).toEqual(answer.result)

    const compaction = { trigger: 'manual' as const, instructions: 'keep the plan', messages: KEPT }
    await $.session.compact(compaction)
    expect(seen[1]).toMatchObject(compaction)
  })

  test('the footer reads noxdeck · classic beside the engine\'s own mode labels', async ($, on) => {
    engine(on)
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>focus</Text>
    })
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'noxdeck', surface, component: 'SessionMode', props: { modes: ['focus'] } })
      expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: 'noxdeck · classic' }))?.props.color).toBe('claude')
      await ui.unmount()
    }
  })
})

describe('edge cases', () => {
  test('NotebookEdit counts (its success record has error: ""); timed-out diffs show n/a, not +0 −0', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => {
      if (e.tool === 'NotebookEdit') {
        return {
          result: {
            new_source: 'a\nB\nc',
            old_source: 'a\nb\nc',
            cell_type: 'code',
            language: 'python',
            edit_mode: 'replace',
            error: '',
            notebook_path: e.notebook_path,
            original_file: '{}',
            updated_file: '{}',
          },
        }
      }
      if (e.tool === 'Edit') return { result: { filePath: e.file_path, structuredPatch: [], originalFile: 'x' } }
      if (e.tool === 'Write') {
        return { result: { type: 'update', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: 'old' } }
      }
      return { result: {} }
    })
    await start($)
    await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/proj/a.ipynb', new_source: 'a\nB\nc' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/slow.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/proj/big.ts', content: 'new' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ type: 'Text', text: 'a.ipynb' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\+1 −1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'slow.ts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'big.ts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^n\/a$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+0 −0/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '3 Dateien · +1 −1 · unvollständig' })).toBeDefined()
    await ui.unmount()
  })

  test('a Bash diff flagged unavailable still lists its files, and unnamed files are counted', async ($, on) => {
    engine(on)
    on('tool.call', () => {
      const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' a', '+b'] }
      return {
        result: {
          stdout: '',
          stderr: '',
          interrupted: false,
          bashEditDiff: { files: [{ filePath: '/proj/x.md', hunks: [hunk] }], moreFiles: 3, unavailable: true },
        },
      }
    })
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'make fmt' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ type: 'Text', text: 'x.md' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+3 Dateien ohne Zeilen (n/a)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '4 Dateien · +1 −0 · unvollständig' })).toBeDefined()
    await ui.press({ key: 'tab-live' })
    expect(await ui.find({ type: 'Text', text: 'zuletzt: x.md' })).toBeDefined()
    await ui.unmount()
  })

  test('an agent the list drops after it was listed running ends; the mascot stops working', async ($, on) => {
    const world: { agents: AgentInfo[] } = {
      agents: [{ id: 't1', description: 'teammate task', type: 'teammate', status: 'running' }],
    }
    const clock = engine(on, world)
    on('agent.spawn', () => ({ model: 'm', agentId: 't1' }))
    await start($)
    await $.agent.spawn({ ...SPAWN, description: 'teammate task', subagentType: 'teammate' })
    await $.turn.start({ text: '', turnId: 'x', agentId: 't1' })
    await clock.advance(2000)
    await $.turn.complete({ turnId: 'x', agentId: 't1', answer: '', durationMs: 2000, isAborted: false, reason: 'answer' })
    world.agents = []
    await clock.advance(2000)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('bereit')
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Text', text: '– 0:02' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 fertig' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /läuft/ })).toBeUndefined()
    await ui.unmount()
  })

  test('/resume starts the pane over, as /clear does', async ($, on) => {
    engine(on, WITH_TODO)
    on('tool.call', (_, e) => ({ result: { oldTodos: [], newTodos: e.tool === 'TodoWrite' ? e.todos : [] } }))
    on('session.end', (_, e) => ({ sessionId: e.sessionId }))
    await start($)
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
    await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'kein Plan aktiv' })).toBeDefined()
    await ui.unmount()
  })

  test('in a narrow pane the counter leaves the border for the card body', async ($, on) => {
    engine(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 30 }, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: ` ${P(58)} · 116k / 200k ` })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: `${P(58)} · 116k / 200k` })).toBeDefined()
    await ui.unmount()
  })

  test('the English locale translates sentences and states, not terms', { options: { language: 'en' } }, async ($, on) => {
    engine(on, { isMeasured: false })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('ready')
    expect(await ui.find({ type: 'Text', text: 'RADAR · nothing to note' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: LIMIT_LINE })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: ' Live ' })).toBeDefined()
    await ui.unmount()
  })
})

describe('render widths', () => {
  for (const columns of [45, 70] as const) {
    test(`at ${columns} columns every row fits and the legend takes at most two lines`, async ($, on) => {
      engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 11 }], messages: [76 * K, 90 * K, 104 * K] })
      on('tool.call', (_, e) => ({ result: { oldTodos: [], newTodos: e.tool === 'TodoWrite' ? e.todos : [] } }))
      await start($)
      await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
      for (const turnId of ['t1', 't2']) {
        await $.turn.complete({ turnId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
      }
      const card = columns - 4 - 4
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface })
        const rows = (await ui.findAll({ type: 'Text' })).filter(found => found.props.wrap === 'truncate')
        const bar = rows.find(found => /^█+/.test(found.text))
        expect(bar?.text.length).toBe(card)
        const legend = rows.filter(found => found.text.includes('●'))
        expect(legend.length).toBeGreaterThan(0)
        expect(legend.length).toBeLessThanOrEqual(2)
        for (const label of ['messages', 'mcp', 'tools', 'memory', 'system']) {
          expect(legend.some(line => line.text.includes(label))).toBe(true)
        }
        for (const row of rows) expect(row.text.length).toBeLessThanOrEqual(card)
        expect(await ui.find({ type: 'Text', text: `${P(84)}`.padStart(6) })).toBeDefined()
        if (surface === 'terminal') {
          for (const title of [' noxdeck ', ' PLAN ', ' CONTEXT ', ' STATUS ']) {
            expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
          }
        }
        await ui.unmount()
      }
    })
  }
})

describe('review round two', () => {
  test('a pane hidden behind another tab keeps its clock: back in front, done turns to waiting', async ($, on) => {
    const world: World = { pane: 'hidden' }
    const clock = engine(on, world)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await clock.advance(3000)
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 3000, isAborted: false, reason: 'answer' })
    await clock.advance(5000)
    world.pane = 'shown'
    await clock.advance(31_000)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('bereit')
    await ui.unmount()
  })

  test('a 5h reading whose reset time has passed is not shown as current', async ($, on) => {
    const clock = engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 97, resetsAt: new Date(1_000_500).toISOString() }] })
    await start($)
    await clock.advance(1000)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '5h-Limit · zurückgesetzt' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /♥/ })).toBeUndefined()
    await ui.unmount()
  })

  test('the limit bar and its text agree: 80,5 % left is eight of ten cells and 81 %', BAR, async ($, on) => {
    engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 19.5 }] })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await limitCells(ui)).toEqual({ full: 8, empty: 2 })
    expect(await ui.find({ type: 'Text', text: ` 5h-Limit · ${P(81)} übrig` })).toBeDefined()
    await ui.unmount()
  })

  test('German plurals: two agents run', async ($, on) => {
    engine(on, {
      agents: [
        { id: 'a', description: 'one', type: 'Explore', status: 'running' },
        { id: 'b', description: 'two', type: 'Explore', status: 'running' },
      ],
    })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Text', text: ' 2 laufen ' })).toBeDefined()
    await ui.unmount()
  })

  test('a source under 1 % shows its estimate with a decimal and ≈; a legend too narrow says +N', async ($, on) => {
    engine(on, {
      extra: [used('Skills', 600, 'warning'), used('Custom agents', 300, 'permission'), used('Slash commands', 200, 'inactive')],
    })
    await start($)
    const wide = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 90 }, surface: 'terminal' })
    expect(await wide.find({ type: 'Text', text: `skills ≈${P('0,3')}` })).toBeDefined()
    expect(await wide.find({ type: 'Text', text: `other ≈${P('0,1')}` })).toBeDefined()
    await wide.unmount()
    const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 34 }, surface: 'terminal' })
    expect(await narrow.find({ type: 'Text', text: /^ \+\d$/ })).toBeDefined()
    await narrow.unmount()
  })
})

describe('layout after the target image', () => {
  /** The chart rows: as wide as the chart (the card's 40 cells less the 6 of the line's label), braille only. */
  const chartRows = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }) =>
    (await ui.findAll({ type: 'Text' })).filter(
      found => found.props.wrap === 'truncate' && found.text.length === 34 && /^[\u2800-\u28ff ]+$/.test(found.text),
    )

  test('the history draws braille bars, two turns a column, under a dotted threshold line in the accent', async ($, on) => {
    // Fills of 51 %, 58 % and 65 % against a threshold at 83,5 %: five, six and six of eight dots.
    engine(on, { messages: [76 * K, 62 * K, 76 * K, 90 * K] })
    await start($)
    for (const turnId of ['t1', 't2', 't3']) {
      await $.turn.complete({ turnId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    }
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const rows = await chartRows(ui)
    expect(rows.length).toBe(2)
    // Top row: one, two and two dots; bottom row full under all three turns.
    expect(rows[0]?.text).toBe(`⣠⡄${' '.repeat(32)}`)
    // Dot columns no turn has reached yet: a faint baseline dot, in the track color.
    expect(rows[1]?.text).toBe(`⣿⡇${'⣀'.repeat(32)}`)
    const bars = (await ui.findAll({ type: 'Text' })).filter(found => /^[\u2800-\u28ff]+$/.test(found.text))
    expect(bars.filter(found => found.props.color === 'claude').map(found => found.text)).toEqual(['⣠', '⡄', '⣿', '⡇'])
    expect(bars.filter(found => found.props.color === 'subtle').length).toBe(32)
    expect((await ui.find({ type: 'Text', text: '·'.repeat(34) }))?.props.color).toBe('claude')
    await ui.unmount()
  })

  test('the history stays two rows tall while every turn is low', async ($, on) => {
    // A fill of 21 % against a threshold at 83,5 %: two of eight dots, both in the bottom row.
    engine(on, { messages: [2 * K] })
    await start($)
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const rows = await chartRows(ui)
    expect(rows.length).toBe(2)
    expect(rows[0]?.text.trim()).toBe('')
    expect(rows[1]?.text.slice(0, 2)).toBe('⡄⣀')
    await ui.unmount()
  })

  test('the context bar: full cells in the sources\' pastels, the free window dark grey, the mark on it', async ($, on) => {
    engine(on)
    await start($)
    // Too short for Nox; the mini owl's full cells are STATUS's, drawn before its title.
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 26 } }, surface: 'terminal' })
    const texts = await ui.findAll({ type: 'Text' })
    const inContext = texts.slice(texts.findIndex(found => found.text === ' STATUS ') + 1)
    const bar = inContext.find(found => found.props.wrap === 'truncate' && /^█+/.test(found.text))
    expect(bar?.text.length).toBe(40)
    expect(bar?.text.replace('│', '')).toMatch(/^█+$/)
    const runs = inContext.filter(found => /^█+$/.test(found.text)).map(found => found.props.color)
    expect(runs).toEqual([
      'rainbow_blue',
      'rainbow_green',
      'rainbow_indigo',
      'rainbow_yellow',
      'rainbow_orange',
      'userMessageBackground',
      'userMessageBackground',
    ])
    // The auto-compact mark sits in the free window, on its dark grey, so the run stays whole.
    const mark = await ui.find({ type: 'Text', text: /^│$/ })
    expect(mark?.props.backgroundColor).toBe('userMessageBackground')
    expect((await ui.find({ type: 'Text', text: /^● $/ }))?.props.color).toBe('rainbow_blue')
    await ui.unmount()
  })

  test('MCP in one line: servers and tools, the tokens in the window or deferred', async ($, on) => {
    const tool = (serverName: string, i: number, isLoaded: boolean) => ({
      name: `mcp__${serverName}__tool_${i}`,
      serverName,
      tokens: 400,
      isLoaded,
    })
    const world: World = {
      mcpTools: [...Array.from({ length: 3 }, (_, i) => tool('linear', i, true)), ...Array.from({ length: 2 }, (_, i) => tool('github', i, false))],
    }
    engine(on, world)
    await start($)
    const mcpLine = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const found = (await ui.findAll({ type: 'Text', text: /^mcp / })).find(one => one.props.wrap === 'truncate-end')
      const deferred = await ui.find({ type: 'Text', text: 'deferred' })
      const value = (await ui.findAll({ type: 'Text', text: /^(≈[\d,]+k?|deferred)$/ }))[0]
      await ui.unmount()
      return { line: found?.text, value: value?.text, isDeferredDim: deferred?.props.dimColor }
    }
    expect(await mcpLine()).toEqual({ line: 'mcp    2 Server · 5 Tools', value: '≈1,2k', isDeferredDim: undefined })
    world.mcpTools = [tool('github', 0, false)]
    await $.session.measure({ context: { window: 200 * K }, rateLimits: [], changed: ['context'] })
    expect(await mcpLine()).toEqual({ line: 'mcp    1 Server · 1 Tool', value: 'deferred', isDeferredDim: true })
    world.mcpTools = []
    await $.session.measure({ context: { window: 200 * K }, rateLimits: [], changed: ['context'] })
    expect((await mcpLine()).line).toBe('mcp    keine')
  })

  test('the legend keeps a space after every bullet', async ($, on) => {
    engine(on)
    await start($)
    for (const columns of [45, 70]) {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface: 'terminal' })
      const lines = (await ui.findAll({ type: 'Text', text: /●/ })).filter(found => found.props.wrap === 'truncate')
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) expect(line.text).not.toMatch(/●[^ ]/)
      await ui.unmount()
    }
  })

  test('without a plan the PLAN card is a single line', async ($, on) => {
    engine(on, WITH_TODO)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'PLAN · kein Plan aktiv' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' PLAN ' })).toBeUndefined()
    await ui.unmount()
  })

  test('Nox where the pane has the height for it, else the mini owl, none where that is too narrow; the state always', async ($, on) => {
    engine(on)
    await start($)
    const shown = async (size: Size) => {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: size.columns, scroll: { offset: 0, bodyRows: size.rows } }, surface: 'terminal' })
      const texts = await ui.findAll({ type: 'Text' })
      const caption = (await captionOf(ui))?.text ?? null
      await ui.unmount()
      return { owl: owlOf(poseIn(texts)), caption, title: texts.find(found => /^· /.test(found.text))?.text ?? null }
    }
    expect(await shown(TALL)).toEqual({ owl: 'nox', caption: 'bereit', title: null })
    expect(await shown(SHORT)).toEqual({ owl: 'mini', caption: null, title: '· bereit ' })
    expect(await shown({ rows: 26, columns: 39 })).toEqual({ owl: 'none', caption: 'bereit', title: null })
  })
})

describe('state written by an older version (hot reload, /reload-plugins)', () => {
  // $.state outlives a reload; these are the shapes version 0.1 stored, without a shape tag.
  const OLD_CONTEXT = {
    percentage: 58,
    totalTokens: 116 * K,
    maxTokens: 200 * K,
    sources: [{ name: 'Messages', tokens: 76 * K, color: 'permission' }],
    threshold: 167 * K,
    mcp: [],
    memory: [],
    skills: null,
  }
  const OLD_USAGE = {
    history: [
      { tokens: 100 * K, maxTokens: 200 * K },
      { tokens: 116 * K, maxTokens: 200 * K },
    ],
    peak: 58,
    compactions: 0,
    cacheRead: 0,
    inputTotal: 0,
  }

  test('an old context snapshot (sources by name, no key) reads as absent instead of crashing the pane', async ($, on) => {
    engine(on, { isMeasured: false })
    // A call on $ is answered { value }: here the read, { value, version }, of what 0.1 stored.
    on('state.get', { plugin: 'noxdeck', key: 'context' }, () => ({ value: { value: OLD_CONTEXT, version: 1 } }) as never)
    on('state.get', { plugin: 'noxdeck', key: 'usage' }, () => ({ value: { value: OLD_USAGE, version: 1 } }) as never)
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: 'Context noch nicht gemessen' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a usage track up to 0.12 kept (with a peak) reads as absent; one kept by 0.13 is read', async ($, on) => {
    const kept = { history: [], compactions: 2, cacheRead: 0, inputTotal: 0 }
    let stored: unknown = { shape: 'noxdeck/6', value: { ...kept, peak: 116 * K, isPeakEstimate: false } }
    // A breakdown and no response yet: nothing writes the track, the pane draws what was kept.
    engine(on, { hasResponse: false })
    on('state.get', { plugin: 'noxdeck', key: 'usage' }, () => ({ value: { value: stored, version: 1 } }) as never)
    await start($)
    const stats = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const lines = (await ui.findAll({ type: 'Text', text: /^(Cache Hit|\d+× kompaktiert)/ })).map(found => found.text)
      await ui.unmount()
      return lines
    }
    // The breakdown's estimate, 116k, against the 167k threshold either way; the count tells which track was read.
    expect(await stats()).toEqual(['Cache Hit n/a · noch ~51k bis Compact', '0× kompaktiert · seit Laden'])
    stored = { shape: 'noxdeck/7', value: kept }
    expect(await stats()).toEqual(['Cache Hit n/a · noch ~51k bis Compact', '2× kompaktiert · seit Laden'])
  })
})

describe('hot reload from an older version', () => {
  // Every key any version so far read while drawing. On a reload the old
  // version's render may still be running, and the engine judges its reads by
  // the new module's scan: a key the new module never names is refused there
  // ("$.state.get refused: its hooks module does not refer to noxdeck.hasTodoTool").
  const READ_WHILE_DRAWING = [
    'tab', 'plan', 'context', 'usage', 'fiveHour', 'activity', 'changes', 'missedFiles', 'hiddenFiles', 'agents', 'root', 'now',
    'hasTodoTool', 'isDismissed', 'cues', 'pose', 'turn', 'pace', 'todoTools', 'agentBoard', 'agentFolds', 'isProcessedOpen',
    'limit',
  ]

  test('the module still names every key an earlier version read while drawing', async ($, on) => {
    const admitted: PluginRegisterInput[] = []
    on('plugin.register', (_, e) => {
      admitted.push(e)
      return { allow: true }
    })
    engine(on)
    await start($)
    const reads = admitted.find(one => one.name === 'noxdeck')?.uses.state?.reads ?? []
    for (const key of READ_WHILE_DRAWING) expect(reads).toContainEqual({ plugin: 'noxdeck', key })
  })
})

describe('legend at the pane width you use', () => {
  test('six sources, one under 1 %, all fit two lines at 45 columns with a space after each bullet', async ($, on) => {
    engine(on, { extra: [used('Skills', 1600, 'warning')] })
    await start($)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 45 }, surface: 'terminal' })
    const lines = (await ui.findAll({ type: 'Text', text: /● / })).filter(found => found.props.wrap === 'truncate')
    expect(lines.length).toBe(2)
    const legend = lines.map(line => line.text).join(' ')
    for (const label of [/msgs|messages/, /mcp/, /tools/, /mem/, /skill/, /sys/]) expect(legend).toMatch(label)
    expect(legend).not.toMatch(/\+\d/)
    expect(legend).not.toMatch(/●[^ ]/)
    await ui.unmount()
  })
})

describe('5h limit as hearts (default) or bar', () => {
  // 70 % left: four of five hearts, seven of ten cells.
  const LIMIT = { rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] }
  const limitLine = async (ui: { findAll: (q: { type: string; text: RegExp }) => Promise<{ text: string; props: Record<string, unknown> }[]> }) =>
    (await ui.findAll({ type: 'Text', text: /5h-Limit · / })).find(found => found.props.wrap === 'truncate')

  for (const columns of [45, 70] as const) {
    const card = columns - 4 - 4

    test(`hearts at ${columns} columns: ♥ coral, ♡ grey, a space after every heart, two before the text, the row inside the frame`, async ($, on) => {
      engine(on, LIMIT)
      await start($)
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface })
        const line = await limitLine(ui)
        expect(line?.text).toBe(`♥ ♥ ♥ ♥ ♡  5h-Limit · ${P(70)} übrig`)
        expect(line?.text).not.toMatch(/[♥♡][^ ]/)
        expect((line?.text.length ?? 0) <= card).toBe(true)
        expect((await ui.find({ type: 'Text', text: /^(♥ )+$/ }))?.props.color).toBe('claude')
        expect((await ui.find({ type: 'Text', text: /^(♡ )+$/ }))?.props.color).toBe('inactive')
        expect(await ui.find({ type: 'Text', text: /^▊+ 5h/ })).toBeUndefined()
        await ui.unmount()
      }
    })

    test(`bar at ${columns} columns: the ten cells as before, no hearts`, BAR, async ($, on) => {
      engine(on, LIMIT)
      await start($)
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface })
        const line = await limitLine(ui)
        expect(line?.text).toBe(`▊▊▊▊▊▊▊▊▊▊ 5h-Limit · ${P(70)} übrig`)
        expect((line?.text.length ?? 0) <= card).toBe(true)
        expect(await limitCells(ui)).toEqual({ full: 7, empty: 3 })
        expect(await ui.find({ type: 'Text', text: /[♥♡]/ })).toBeUndefined()
        await ui.unmount()
      }
    })
  }

  test('hearts follow the share left: none at 0 %, one while anything is left, five when full', async ($, on) => {
    const world = { rateLimits: [{ kind: 'five_hour', percentUsed: 100 }] }
    engine(on, world)
    await start($)
    const hearts = async (used: number) => {
      await $.session.measure({ context: { window: 200 * K }, rateLimits: [{ kind: 'five_hour', percentUsed: used }], changed: ['rateLimits'] })
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const text = (await limitLine(ui))?.text.split('5h')[0]
      await ui.unmount()
      return text
    }
    expect(await hearts(100)).toBe('♡ ♡ ♡ ♡ ♡  ')
    expect(await hearts(99)).toBe('♥ ♡ ♡ ♡ ♡  ')
    expect(await hearts(0)).toBe('♥ ♥ ♥ ♥ ♥  ')
  })
})

describe('the limit STATUS shows: the 5h window, else the week\'s for all models, else no line', () => {
  // In milliseconds: HOUR and MINUTE are declared further down, after this block runs.
  const T5 = 1_000_000 + 2 * 3_600_000
  const T7 = 1_000_000 + 100 * 3_600_000 + 40 * 60_000
  const FIVE: SessionRateLimit = { kind: 'five_hour', percentUsed: 30, resetsAt: new Date(T5).toISOString() }
  // 17 % of the week used: 83 % left, four of five hearts, eight of ten cells.
  const WEEK: SessionRateLimit = { kind: 'seven_day', percentUsed: 17, resetsAt: new Date(T7).toISOString() }
  /** A Claude gateway's spend limit: never shown, as before. */
  const SPEND: SessionRateLimit = { kind: 'spend_limit', percentUsed: 40 }
  const clockOf = (at: number) => {
    const time = new Date(at)
    return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  }
  /** Each language's words, written out here rather than read from the locale. */
  const WORDS = {
    de: {
      percent: P,
      five: (left: string) => `5h-Limit · ${left} übrig`,
      week: (left: string) => `Woche · ${left} übrig`,
      weekReset: 'Woche · zurückgesetzt',
      weekdays: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
    },
    en: {
      percent: (n: number) => `${n}%`,
      five: (left: string) => `5h limit · ${left} left`,
      week: (left: string) => `week · ${left} left`,
      weekReset: 'week · reset',
      weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    },
  } as const

  /** STATUS's limit line (the whole row, cells and words) and the reset line under it; null for one not drawn. */
  async function limitRows(ui: { findAll: (q: { type: string }) => Promise<Found[]> }) {
    const texts = await ui.findAll({ type: 'Text' })
    return {
      limit: texts.find(found => found.props.wrap !== undefined && LIMIT_LINE.test(found.text))?.text ?? null,
      reset: texts.find(found => /^Reset /.test(found.text))?.text ?? null,
    }
  }

  for (const language of ['de', 'en'] as const) {
    const words = WORDS[language]
    const options = { language }

    test(`${language}: a 5h window: the 5h line and its time of day as before, the week beside it not shown`, { options }, async ($, on) => {
      // The week's first: the 5h window wins wherever it stands.
      engine(on, { rateLimits: [WEEK, FIVE, SPEND] })
      await start($)
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ ...PANE, surface })
        expect({ surface, ...(await limitRows(ui)) }).toEqual({
          surface,
          limit: `♥ ♥ ♥ ♥ ♡  ${words.five(words.percent(70))}`,
          reset: `Reset ${clockOf(T5)}`,
        })
        await ui.unmount()
      }
    })

    test(`${language}: no 5h window: the week's with the same hearts, its reset as weekday and time`, { options }, async ($, on) => {
      engine(on, { rateLimits: [SPEND, WEEK] })
      await start($)
      const reset = `Reset ${words.weekdays[new Date(T7).getDay()]} ${clockOf(T7)}`
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ ...PANE, surface })
        expect({ surface, ...(await limitRows(ui)) }).toEqual({ surface, limit: `♥ ♥ ♥ ♥ ♡  ${words.week(words.percent(83))}`, reset })
        expect((await ui.find({ type: 'Text', text: /^(♥ )+$/ }))?.props.color).toBe('claude')
        expect((await ui.find({ type: 'Text', text: reset }))?.props.dimColor).toBe(true)
        await ui.unmount()
      }
    })

    test(`${language}: no 5h window, as a bar: the week's in the same ten cells`, { options: { ...options, limitStyle: 'bar' } }, async ($, on) => {
      engine(on, { rateLimits: [WEEK] })
      await start($)
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      expect((await limitRows(ui)).limit).toBe(`▊▊▊▊▊▊▊▊▊▊ ${words.week(words.percent(83))}`)
      expect(await limitCells(ui)).toEqual({ full: 8, empty: 2 })
      expect(await ui.find({ type: 'Text', text: /[♥♡]/ })).toBeUndefined()
      await ui.unmount()
    })

    test(`${language}: the week's reading past its reset time: said so, no hearts, no reset line`, { options }, async ($, on) => {
      const clock = engine(on, { rateLimits: [{ kind: 'seven_day', percentUsed: 97, resetsAt: new Date(1_000_500).toISOString() }] })
      await start($)
      await clock.advance(1000)
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      expect(await limitRows(ui)).toEqual({ limit: words.weekReset, reset: null })
      expect(await ui.find({ type: 'Text', text: /[♥♡]/ })).toBeUndefined()
      await ui.unmount()
    })

    test(`${language}: no window at all (none measured, a gateway's spend limit alone): no limit line, no reset, no n/a`, { options }, async ($, on) => {
      engine(on)
      await start($)
      for (const rateLimits of [[], [SPEND]]) {
        await $.session.measure({ context: { window: 200 * K }, rateLimits, changed: ['rateLimits'] })
        for (const surface of SURFACES) {
          const ui = await $.ui.mount({ ...PANE, surface })
          const texts = await ui.findAll({ type: 'Text' })
          expect({ surface, ...(await limitRows(ui)) }).toEqual({ surface, limit: null, reset: null })
          // Neither cells nor words of a limit: the old `5h-Limit · n/a` is gone too (CONTEXT's own n/a stays).
          expect(has(texts, /^[♥♡▊]/)).toBe(false)
          expect(has(texts, /(5h[- ]limit|woche|week)/i)).toBe(false)
          await ui.unmount()
        }
      }
      // A row less: Nox shows from 30 rows, one fewer than with a limit line.
      expect(owlOf(await shownPose($, 'terminal', { rows: 30, columns: 48 }))).toBe('nox')
      expect(owlOf(await shownPose($, 'terminal', { rows: 29, columns: 48 }))).toBe('mini')
    })

    test(`${language}: each measurement picks the window anew: none, the week's, the 5h, none again`, { options }, async ($, on) => {
      engine(on)
      await start($)
      const after = async (rateLimits: SessionRateLimit[]) => {
        await $.session.measure({ context: { window: 200 * K }, rateLimits, changed: ['rateLimits'] })
        const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
        const rows = await limitRows(ui)
        await ui.unmount()
        return rows.limit
      }
      expect(await after([])).toBeNull()
      expect(await after([WEEK])).toBe(`♥ ♥ ♥ ♥ ♡  ${words.week(words.percent(83))}`)
      expect(await after([WEEK, FIVE])).toBe(`♥ ♥ ♥ ♥ ♡  ${words.five(words.percent(70))}`)
      expect(await after([SPEND])).toBeNull()
    })
  }
})

/** The cards from top to bottom, by their titles (a one-line card counts by its title). */
async function cardTitles(ui: { findAll: (q: { type: string }) => Promise<Found[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Text' })).map(found => found.text.trim()).filter(text => /^(PLAN|RADAR|CONTEXT|STATUS)$/.test(text))
}

describe('the Live tab', () => {
  test('the tab is called Live; /noxdeck live opens it, and /noxdeck plan still does', async ($, on) => {
    engine(on)
    await start($)
    const titles = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const found = await cardTitles(ui)
      await ui.unmount()
      return found
    }
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: ' Live ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Plan & Context/ })).toBeUndefined()
    await ui.press({ key: 'tab-changes' })
    expect(await cardTitles(ui)).toEqual([])
    await ui.unmount()
    expect((await $.command.run({ command: 'noxdeck', args: 'plan', ...RUN }))?.text).toBe('noxdeck geöffnet: live.')
    expect(await titles()).toEqual(['STATUS', 'CONTEXT', 'RADAR'])
    await $.command.run({ command: 'noxdeck', args: 'agents', ...RUN })
    expect(await titles()).toEqual([])
    expect((await $.command.run({ command: 'noxdeck', args: 'live', ...RUN }))?.text).toBe('noxdeck geöffnet: live.')
    expect(await titles()).toEqual(['STATUS', 'CONTEXT', 'RADAR'])
    // A word that is no tab opens the pane as it is.
    expect((await $.command.run({ command: 'noxdeck', args: 'constructor', ...RUN }))?.text).toBe('noxdeck geöffnet.')
    expect(await titles()).toEqual(['STATUS', 'CONTEXT', 'RADAR'])
  })

  test('STATUS on top, CONTEXT, then RADAR; PLAN in RADAR\'s place while the session has a todo tool', async ($, on) => {
    const world: World = {}
    engine(on, world)
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await cardTitles(ui)).toEqual(['STATUS', 'CONTEXT', 'RADAR'])
      expect(await ui.find({ type: 'Text', text: 'RADAR · keine Auffälligkeiten' })).toBeDefined()
      await ui.unmount()
    }
    world.tools = ['Read', 'TaskCreate']
    await $.turn.start({ text: '', turnId: 't1' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await cardTitles(ui)).toEqual(['STATUS', 'CONTEXT', 'PLAN'])
      expect(await ui.find({ type: 'Text', text: /RADAR/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('the tool list decides at every main turn; a todo tool that answered keeps PLAN until /clear', async ($, on) => {
    const world: World = {}
    engine(on, world)
    on('tool.call', (_, e) => ({ result: { oldTodos: [], newTodos: e.tool === 'TodoWrite' ? e.todos : [] } }))
    on('session.end', (_, e) => ({ sessionId: e.sessionId }))
    await start($)
    const bottom = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const last = (await cardTitles(ui)).at(-1)
      await ui.unmount()
      return last
    }
    expect(await bottom()).toBe('RADAR')
    world.tools = ['TodoWrite']
    await $.turn.start({ text: '', turnId: 'a1', agentId: 'agent-1' })
    expect(await bottom()).toBe('RADAR')
    await $.turn.start({ text: '', turnId: 't1' })
    expect(await bottom()).toBe('PLAN')
    world.tools = []
    await $.turn.complete({ turnId: 't1', durationMs: 1, ...ANSWERED })
    await $.turn.start({ text: '', turnId: 't2' })
    expect(await bottom()).toBe('RADAR')
    // A subagent's TodoWrite fills no plan here; the main loop's does.
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS], agentId: 'agent-1' })
    expect(await bottom()).toBe('RADAR')
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
    expect(await bottom()).toBe('PLAN')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(await bottom()).toBe('RADAR')
  })

  test('the reset time under the 5h limit, while the reading stands; none without one', { timeoutMs: 15_000 }, async ($, on) => {
    const resetsAt = 1_000_000 + 2 * HOUR
    const world: World = { rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: new Date(resetsAt).toISOString() }] }
    const clock = engine(on, world)
    await start($)
    const clockTime = new Date(resetsAt)
    const expected = `Reset ${String(clockTime.getHours()).padStart(2, '0')}:${String(clockTime.getMinutes()).padStart(2, '0')}`
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const texts = await ui.findAll({ type: 'Text' })
      const limit = texts.findIndex(found => /5h-Limit · /.test(found.text) && found.props.wrap === 'truncate')
      expect(texts[limit + 1 + texts.slice(limit + 1).findIndex(found => /^Reset /.test(found.text))]?.text).toBe(expected)
      expect((await ui.find({ type: 'Text', text: /^Reset \d\d:\d\d$/ }))?.props.dimColor).toBe(true)
      await ui.unmount()
    }
    // Past the reset the reading no longer stands, and neither does its time.
    for (let i = 0; i < 6; i += 1) await clock.advance(20 * MINUTE)
    await clock.advance(1000)
    const after = await textsAt($)
    expect(has(after, /^Reset /)).toBe(false)
    expect(has(after, /^5h-Limit · zurückgesetzt$/)).toBe(true)
  })
})

describe('the Live tab when the pane is short', () => {
  test('Nox goes first, STATUS keeps its lines; then RADAR loses its last rows; the loop warning stays on top', async ($, on) => {
    engine(on, TWO_LINES)
    on('tool.call', (_, e) => (e.tool === 'Bash' ? failedRun($, e) : READ_RESULT))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/src/a.ts' })
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Bash', command: 'just test', description: 'Run the tests' })
    // RADAR: the warning (two rows at this width), the failures, the hotspots, in its frame: 6 rows.
    // STATUS: the warning, the edit line, the limit, the caption in its frame: 7 rows, 13 with Nox;
    // with the mini owl beside the two lines instead of the caption, 7 as well.
    // The pane's frame takes 4, CONTEXT 15.
    const at = async (rows: number) => {
      const texts = await textsAt($, rows)
      return {
        owl: owlOf(poseIn(texts)),
        hasErrors: has(texts, /^Fehler 3 · /),
        hasHotspots: has(texts, /^Hotspots /),
        isWarningFirst: (texts.find(found => found.props.wrap === 'truncate-end')?.text ?? '') === '⚠ dreht sich im Kreis:',
        hasCaption: has(texts, MOOD),
      }
    }
    expect(await at(38)).toEqual({ owl: 'nox', hasErrors: true, hasHotspots: true, isWarningFirst: true, hasCaption: true })
    expect(await at(37)).toEqual({ owl: 'mini', hasErrors: true, hasHotspots: true, isWarningFirst: true, hasCaption: false })
    expect(await at(32)).toEqual({ owl: 'mini', hasErrors: true, hasHotspots: true, isWarningFirst: true, hasCaption: false })
    expect(await at(31)).toEqual({ owl: 'mini', hasErrors: true, hasHotspots: false, isWarningFirst: true, hasCaption: false })
    expect(await at(30)).toEqual({ owl: 'mini', hasErrors: false, hasHotspots: false, isWarningFirst: true, hasCaption: false })
    // No room for one RADAR row: no card at all, STATUS and CONTEXT whole.
    const none = await textsAt($, 28)
    expect(has(none, /^ RADAR $/)).toBe(false)
    expect(has(none, /^ CONTEXT $/) && has(none, /^ STATUS $/)).toBe(true)
  })

  test('a long plan loses its last steps first and counts them', async ($, on) => {
    engine(on, WITH_TODO)
    on('tool.call', (_, e) => ({ result: { oldTodos: [], newTodos: e.tool === 'TodoWrite' ? e.todos : [] } }))
    await start($)
    await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
    // PLAN: four steps in its frame, 6 rows; STATUS without Nox 5; frame 4; CONTEXT 15.
    expect(has(await textsAt($, 30), /^Read the styles$/)).toBe(true)
    const short = await textsAt($, 29)
    expect(has(short, /^Wiring it into the header$/)).toBe(true)
    expect(has(short, /^Run the tests$/)).toBe(true)
    expect(has(short, /^Read the styles$/)).toBe(false)
    expect(has(short, /^\+2 weitere Schritte$/)).toBe(true)
  })
})

describe('CHANGES: paths from the project folder', () => {
  test('a file in the project by its path from the folder; one outside it by its name; never an absolute path', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => ({ result: { filePath: (e as { file_path?: string }).file_path ?? '', structuredPatch: [], originalFile: 'x' } }))
    await start($)
    for (const file_path of ['/proj/src/auth/index.ts', '/home/me/notes/todo.md', '/proj-other/x.ts']) {
      await $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })
    }
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.press({ key: 'tab-changes' })
      const texts = await ui.findAll({ type: 'Text' })
      for (const shown of ['src/auth/index.ts', 'todo.md', 'x.ts']) expect(has(texts, new RegExp(`^${shown.replace('.', '\\.')}$`))).toBe(true)
      expect(has(texts, /\/home|\/proj/)).toBe(false)
      await ui.press({ key: 'tab-live' })
      await ui.unmount()
    }
  })

  test('relative, outside, home and Windows paths', () => {
    expect(projectPath('/proj/src/a.ts', '/proj')).toBe('src/a.ts')
    expect(projectPath('/proj/src/a.ts', '/proj/')).toBe('src/a.ts')
    expect(projectPath('/home/me/.claude/CLAUDE.md', '/proj')).toBe('CLAUDE.md')
    expect(projectPath('~/notes/todo.md', '/proj')).toBe('todo.md')
    expect(projectPath('/project/a.ts', '/proj')).toBe('a.ts')
    expect(projectPath('src/a.ts', '/proj')).toBe('src/a.ts')
    expect(projectPath('./src/a.ts', '/proj')).toBe('src/a.ts')
    expect(projectPath('../other/a.ts', '/proj')).toBe('a.ts')
    expect(projectPath('/proj/a.ts', '')).toBe('a.ts')
    expect(projectPath('C:\\Users\\me\\proj\\src\\a.ts', 'C:\\Users\\me\\proj')).toBe('src/a.ts')
    expect(projectPath('C:\\Users\\me\\other\\a.ts', 'C:\\Users\\me\\proj')).toBe('a.ts')
    // Absolute paths are tidied too: a `..` climbing out shows the name only.
    expect(projectPath('/proj/../notes/secret-plan.md', '/proj')).toBe('secret-plan.md')
    expect(projectPath('/proj//src/a.ts', '/proj')).toBe('src/a.ts')
    expect(projectPath('/proj/./src/a.ts', '/proj')).toBe('src/a.ts')
  })

  test('the project folder follows /cd and worktree moves', async ($, on) => {
    const world: World = {}
    engine(on, world)
    on('tool.call', (_, e) => ({ result: { filePath: (e as { file_path?: string }).file_path ?? '', structuredPatch: [], originalFile: 'x' } }))
    await start($)
    const shown = async () => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      await ui.press({ key: 'tab-changes' })
      const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
      await ui.press({ key: 'tab-live' })
      await ui.unmount()
      return texts
    }
    // A worktree entered in the turn moves the folder at once.
    world.root = '/proj/.claude/worktrees/feat'
    await $.tool.call({ tool: 'EnterWorktree' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/proj/.claude/worktrees/feat/src/auth/index.ts', old_string: 'a', new_string: 'b' })
    expect(await shown()).toContain('src/auth/index.ts')
    // /cd between turns: the next turn reads the folder anew.
    world.root = '/other'
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: '/other/lib/db.ts', old_string: 'a', new_string: 'b' })
    const after = await shown()
    expect(after).toContain('lib/db.ts')
    expect(after).toContain('index.ts')
  })
})

// ---------------------------------------------------------------- the languages

/** A locale's keys, each with what it holds: a text, a function and how many arguments it takes, a list and how long. */
function keysOf(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return [`${path}: text`]
  if (typeof value === 'function') return [`${path}: function/${value.length}`]
  if (Array.isArray(value)) return [`${path}: list/${value.length}`, ...value.flatMap((item, index) => keysOf(item, `${path}[${index}]`))]
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value)
      .sort()
      .flatMap(key => keysOf((value as Record<string, unknown>)[key], path === '' ? key : `${path}.${key}`))
  }
  return [`${path}: ${typeof value}`]
}

/** Every text a locale holds as it is (not the ones its functions make). */
function textsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(textsOf)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(textsOf)
  return []
}

describe('the languages', () => {
  test('en and de hold the same keys: no text of the pane is missing in either', () => {
    expect(Object.keys(LOCALES).sort()).toEqual(['de', 'en'])
    const de = keysOf(LOCALES.de)
    const en = keysOf(LOCALES.en)
    expect(de.length).toBeGreaterThan(100)
    // Named this way, a failure lists the keys one language lacks.
    expect({ missingInEn: de.filter(key => !en.includes(key)) }).toEqual({ missingInEn: [] })
    expect({ missingInDe: en.filter(key => !de.includes(key)) }).toEqual({ missingInDe: [] })
    for (const locale of [LOCALES.de, LOCALES.en]) for (const text of textsOf(locale)) expect(text.trim().length).toBeGreaterThan(0)
  })

  test('English unless the option says de', () => {
    expect(stringsOf('en')).toBe(LOCALES.en)
    expect(stringsOf('de')).toBe(LOCALES.de)
    for (const other of [undefined, null, '', 'fr', 'DE']) expect(stringsOf(other)).toBe(LOCALES.en)
  })

  kitTest('without the language option the pane speaks English: the manifest\'s default is en', async ($, on) => {
    engine(on, { isMeasured: false })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('ready')
    expect(await ui.find({ type: 'Text', text: 'RADAR · nothing to note' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: LIMIT_LINE })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: ' noxdeck ' })).toBeDefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'noxdeck', args: '', ...RUN }))?.text).toBe('noxdeck opened.')
    expect((await $.command.run({ command: 'noxdeck', args: 'agents', ...RUN }))?.text).toBe('noxdeck opened on agents.')
  })

  kitTest('language de: the pane speaks German', { options: { language: 'de' } }, async ($, on) => {
    engine(on, { isMeasured: false })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('bereit')
    expect(await ui.find({ type: 'Text', text: 'RADAR · keine Auffälligkeiten' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: LIMIT_LINE })).toBeUndefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'noxdeck', args: '', ...RUN }))?.text).toBe('noxdeck geöffnet.')
  })
})
