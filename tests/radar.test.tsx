import { describe, expect } from 'claude-code/testing'
import { callKey, callLabel, hotspotsOf, NO_RADAR, normalizedCommand, resetClockOf, withFailure, withFileUses } from '../hooks/radar'
import { MASK, maskSecrets } from '../hooks/secrets'
import { wrappedRows } from '../hooks/view'
import { SURFACES, test, PANE, engine, start, SPAWN, captionOf, READ_RESULT, MINUTE, ANSWERED, BASH_OK, failedRun, textsAt, has } from './helpers'
import type { Found } from './helpers'

/**
 * Invented: credentials the masking tests feed in, put together at run time:
 * no literal in this file has a real token's form, so a secret scanner (GitHub
 * push protection) has nothing to report.
 */
const FAKE = {
  anthropic: 'sk-' + 'ant-api03-' + 'AbCdEf0123456789xyz',
  anthropicLong: 'sk-' + 'ant-api03-' + 'Zx9Qw8Er7Ty6' + 'Ui5Op4As3Df2Gh1',
  github: 'ghp_' + 'aaaaBBBBcccc' + 'DDDDeeee1234',
  awsKeyId: 'AKIA' + 'IOSFODNN7' + 'EXAMPLE',
  awsSecret: 'wJalr' + 'XUtnFEMI/' + 'K7MDENG/' + 'bPxRfiCYEXAMPLEKEY',
  jwtHeader: 'eyJ' + 'hbGciOiJIUzI1NiJ9',
  jwt: ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmN' + 'Hl0w5N_XgL0n3I9PlFUP0THsR8U'].join('.'),
  slackBot: 'xox' + 'b-' + '123456789012-abcdefghijkl',
  privateKey: '-----BEGIN OPENSSH ' + 'PRIVATE KEY----- b3BlbnNzaC1rZXk',
  hex: '3f786850e387550f' + 'dab836ed7e6dc881de23001b',
  base64: 'dGhpcyBpcyBhIHNl' + 'Y3JldCB2YWx1ZTEyMw==',
  discordToken: 'Zx9Qw8' + 'Er7Ty6Ui5Op4' + 'As3Df2Gh1Jk0LzXcVbNm',
  slackHook: 'https://hooks.slack.com/' + 'services/' + 'T024BE7LD/B01ABCDEF12/' + 'aBcDeFgHiJ1k' + 'LmNoPqRsTuVw',
  azure: 'lQ88Q~' + 'Ck2nL.vZ3y',
  bearer: 'abc.def' + '-123_456',
  githubHeader: '0123' + 'abcd',
}

describe('RADAR', () => {
  test('the same call failing three times in a row: a warning in the accent, at the top of STATUS and of RADAR', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => (e.tool === 'Bash' && e.command.includes('just') ? failedRun($, e) : READ_RESULT))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    const run = (command = 'just test --all') => $.tool.call({ tool: 'Bash', command, description: 'Run the tests' })
    await run()
    await run()
    expect(has(await textsAt($, 80, 70), /dreht sich/)).toBe(false)
    await run()
    const wide = await textsAt($, 80, 70)
    const warnings = wide.filter(found => found.text === '⚠ dreht sich im Kreis: Bash · Run the tests (3×)')
    expect(warnings.length).toBe(2)
    for (const one of warnings) expect([one.props.color, one.props.bold]).toEqual(['claude', true])
    // STATUS on top: the warning is the pane's first row.
    expect(wide.find(found => found.props.wrap === 'truncate-end')?.text).toBe('⚠ dreht sich im Kreis: Bash · Run the tests (3×)')
    // Where the line is too long it breaks after the colon.
    const narrow = await textsAt($)
    expect(narrow.filter(found => found.text === '⚠ dreht sich im Kreis:').length).toBe(2)
    expect(narrow.filter(found => found.text === 'Bash · Run the tests (3×)').length).toBe(2)
    await run()
    expect(has(await textsAt($, 80, 70), /Run the tests \(4×\)$/)).toBe(true)
    // Another call ends the run.
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    expect(has(await textsAt($, 80, 70), /dreht sich/)).toBe(false)
    // The same description is the same call, whatever its command.
    for (const command of ['just a', 'just b', 'just c']) await run(command)
    expect(has(await textsAt($, 80, 70), /^⚠ dreht sich im Kreis: Bash · Run the tests \(3×\)$/)).toBe(true)
    // Another description is another call.
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    for (const description of ['Run the tests', 'Run the unit tests', 'Run the tests']) {
      await $.tool.call({ tool: 'Bash', command: 'just test', description })
    }
    expect(has(await textsAt($, 80, 70), /dreht sich/)).toBe(false)
    // No description: the command without flags, environment, redirections and
    // filters is the call; shown only as „Bash-Befehl“.
    for (const command of ['just deploy', 'just deploy --prod', 'CI=1 just deploy -v 2>&1 | tail -5']) {
      await $.tool.call({ tool: 'Bash', command })
    }
    const bare = await textsAt($, 80, 70)
    expect(has(bare, /^⚠ dreht sich im Kreis: Bash-Befehl \(3×\)$/)).toBe(true)
    expect(has(bare, /just/)).toBe(false)
    // The turn ends with the warning standing; the next prompt starts a new attempt.
    await $.turn.complete({ turnId: 't1', durationMs: 1, ...ANSWERED })
    expect(has(await textsAt($, 80, 70), /dreht sich/)).toBe(true)
    await $.turn.start({ text: '', turnId: 't2' })
    expect(has(await textsAt($, 80, 70), /dreht sich/)).toBe(false)
  })

  test('the loose stage: a call that failed four times in one turn, whatever came between, dim in RADAR only', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => {
      if (e.tool === 'Bash') return failedRun($, e)
      return { result: { filePath: (e as { file_path?: string }).file_path ?? '', structuredPatch: [], originalFile: 'x' } }
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    // Test fails, Claude edits, the test fails again: never three in a row.
    const attempt = async (flag = '') => {
      await $.tool.call({ tool: 'Bash', command: `npm test${flag}`, description: 'Run the tests' })
      await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'a', new_string: 'b' })
    }
    for (const flag of ['', ' -- --watch=false', '']) await attempt(flag)
    const three = await textsAt($, 80, 70)
    expect(has(three, /gescheitert|dreht sich/)).toBe(false)
    expect(has(three, /^Fehler 3 · /)).toBe(true)
    await attempt()
    const four = await textsAt($, 80, 70)
    const rows = four.filter(found => found.text === '4× gescheitert: Run the tests')
    expect(rows.length).toBe(1)
    expect(rows[0]?.props.dimColor).toBe(true)
    expect(rows[0]?.props.color).toBeUndefined()
    expect(has(four, /dreht sich/)).toBe(false)
    // Not in STATUS: the pane's first row is STATUS's edit line, and the row sits under CONTEXT.
    expect(four.find(found => found.props.wrap === 'truncate-end')?.text).toBe('✎ bearbeitet auth.ts')
    const context = four.findIndex(found => found.text === ' CONTEXT ')
    expect(four.findIndex(found => found.text === '4× gescheitert: Run the tests')).toBeGreaterThan(context)
    await attempt()
    expect(has(await textsAt($, 80, 70), /^5× gescheitert: Run the tests$/)).toBe(true)
    // A new turn counts anew.
    await $.turn.complete({ turnId: 't1', durationMs: 1, ...ANSWERED })
    expect(has(await textsAt($, 80, 70), /^5× gescheitert/)).toBe(true)
    await $.turn.start({ text: '', turnId: 't2' })
    for (let i = 0; i < 3; i += 1) await attempt()
    expect(has(await textsAt($, 80, 70), /gescheitert/)).toBe(false)
  })

  test('both stages for one call: in a row the warning only; once a success breaks the row, the dim count', async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => (e.tool === 'Bash' || e.tool === 'Edit' ? failedRun($, e) : READ_RESULT))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    for (let i = 0; i < 4; i += 1) await $.tool.call({ tool: 'Bash', command: 'just test' })
    const inRow = await textsAt($, 80, 70)
    expect(inRow.filter(found => found.text === '⚠ dreht sich im Kreis: Bash-Befehl (4×)').length).toBe(2)
    expect(has(inRow, /gescheitert/)).toBe(false)
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    await $.tool.call({ tool: 'Bash', command: 'just test --verbose' })
    const broken = await textsAt($, 80, 70)
    expect(has(broken, /dreht sich/)).toBe(false)
    expect(has(broken, /^5× gescheitert: Bash-Befehl$/)).toBe(true)
    // Any tool: by its name and the file's.
    for (let i = 0; i < 4; i += 1) {
      await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'x', new_string: 'y' })
      await $.tool.call({ tool: 'Read', file_path: '/proj/b.ts' })
    }
    expect(has(await textsAt($, 80, 70), /^4× gescheitert: Edit · auth\.ts$/)).toBe(true)
  })

  test('a Bash command as the same call: no flags, environment, redirections or filters', () => {
    expect(normalizedCommand('npm test')).toBe('npm test')
    expect(normalizedCommand('npm test -- --watch=false')).toBe('npm test')
    expect(normalizedCommand('CI=1 npm test 2>&1 | tail -20')).toBe('npm test')
    expect(normalizedCommand('pytest -x tests/ > out.txt')).toBe('pytest tests/')
    expect(normalizedCommand('cd /proj && FOO=1 npm test -v')).toBe('cd /proj && npm test')
    expect(normalizedCommand('npm test || echo failed')).toBe('npm test || echo failed')
    expect(normalizedCommand('npm run build')).not.toBe(normalizedCommand('npm run test'))
    // A flag's number or duration given apart goes with the flag.
    expect(normalizedCommand('go test -count 1 -timeout 120s ./...')).toBe('go test ./...')
    // Only the command a filter reads from is the call; the commands chained after it stay.
    expect(normalizedCommand('npm run build 2>&1 | tail -20 && npm test')).toBe('npm run build && npm test')
    expect(normalizedCommand('npm run build 2>&1 | tail -20 && npm test')).not.toBe(normalizedCommand('npm run build 2>&1 | tail -20 && npm run lint'))
    expect(normalizedCommand("cat <<'EOF' | python3\nprint(1)\nEOF")).not.toBe(normalizedCommand("cat <<'EOF' | python3\nimport os\nEOF"))
    const bash = (command: string, description?: string) => ({ command, ...(description === undefined ? {} : { description }) })
    expect(callKey('Bash', bash('npm test'))).toBe(callKey('Bash', bash('npm test --coverage')))
    expect(callKey('Bash', bash('npm test', 'Run the tests'))).toBe(callKey('Bash', bash('npm run test:unit', '  run THE tests ')))
    expect(callKey('Bash', bash('npm test', 'Run the tests'))).not.toBe(callKey('Bash', bash('npm test', 'Run the unit tests')))
    expect(callKey('Bash', bash('npm test', 'Run the tests'))).not.toBe(callKey('Bash', bash('npm test')))
  })

  test('a refusal, an interrupt or a deny is no failure: it neither counts nor carries a run on', async ($, on) => {
    engine(on)
    on('tool.check', (_, e) => (e.tool === 'Bash' && (e.input as { command?: string }).command === 'rm -rf /' ? { decision: 'deny' as const, reason: 'rule' } : { decision: 'allow' as const }))
    on('tool.call', (_, e) => failedRun($, e))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'just test', description: 'Run the tests' })
    await $.tool.call({ tool: 'Bash', command: 'just test', description: 'Run the tests' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf /', description: 'Clean up' })
    await $.tool.call({ tool: 'Bash', command: 'just test', description: 'Run the tests' })
    const texts = await textsAt($, 80, 70)
    expect(has(texts, /dreht sich/)).toBe(false)
    expect(has(texts, /^Fehler 3 · zuletzt Bash gerade eben$/)).toBe(true)
  })

  test('failures since load: how many, and the last one\'s tool and how long ago; a subagent\'s are its own', async ($, on) => {
    const clock = engine(on)
    on('tool.call', (_, e) => failedRun($, e))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    await $.tool.call({ tool: 'Edit', file_path: '/proj/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/b.ts', agentId: 'agent-1' })
    await $.tool.call({ tool: 'WebSearch', query: 'x', mode: 'standard' })
    await $.tool.call({ tool: 'Bash', command: 'false' })
    const row = async () => (await textsAt($)).find(found => /^Fehler /.test(found.text))?.text
    expect(await row()).toBe('Fehler 4 · zuletzt Bash gerade eben')
    await clock.advance(2 * MINUTE)
    expect(await row()).toBe('Fehler 4 · zuletzt Bash vor 2 min')
    for (let i = 0; i < 3; i += 1) await clock.advance(21 * MINUTE)
    expect(await row()).toBe('Fehler 4 · zuletzt Bash vor 1 h 05')
  })

  test('hotspots: the three files read or edited most, by name and count; subagents too, failures and engine forks not', async ($, on) => {
    engine(on, { agents: [{ id: 'agent-1', description: 'look around', type: 'Explore', status: 'running' }] })
    on('tool.call', (_, e) => {
      if (e.tool === 'Read' && e.file_path.endsWith('missing.ts')) return failedRun($, e)
      if (e.tool === 'Edit') return { result: { filePath: e.file_path, structuredPatch: [], originalFile: 'x' } }
      return READ_RESULT
    })
    await start($)
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Read', file_path: '/proj/src/deep/a.ts' })
    for (let i = 0; i < 2; i += 1) await $.tool.call({ tool: 'Edit', file_path: '/proj/src/deep/a.ts', old_string: 'a', new_string: 'b' })
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Read', file_path: '/proj/lib/b.ts', agentId: 'agent-1' })
    for (let i = 0; i < 4; i += 1) await $.tool.call({ tool: 'Read', file_path: '/proj/missing.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/c.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/d.ts' })
    // The engine's memory fork, which nothing names, is not Claude at work.
    for (let i = 0; i < 6; i += 1) await $.tool.call({ tool: 'Read', file_path: '/home/me/.claude/memory/MEMORY.md', agentId: 'memory-fork' })
    const texts = await textsAt($)
    expect(texts.find(found => /^Hotspots /.test(found.text))?.text).toBe('Hotspots a.ts 5× · b.ts 3× · d.ts 1×')
    expect(has(texts, /\/proj|MEMORY/)).toBe(false)
    // In a narrow dock each file has its row, its name cut before its count is.
    for (let i = 0; i < 9; i += 1) await $.tool.call({ tool: 'Read', file_path: '/proj/a-very-long-file-name.test.tsx' })
    const narrow = (await textsAt($, 80, 26)).filter(found => found.props.wrap === 'truncate-end' && /×$/.test(found.text))
    expect(narrow.map(found => found.text)).toEqual(['Hotspots a-ver… 9×', '         a.ts 5×', '         b.ts 3×'])
  })

  // Three and a half minutes of the clock at four frames a second: about 4.9 s here, version 0.17.1 as well, so more than the default 5 s.
  test('the wait for approvals: summed while a dialog is open, ≈ once a tool ran before its call ended; a question is none', { timeoutMs: 15_000 }, async ($, on) => {
    const clock = engine(on)
    const outer = $
    let during: string | undefined
    on('classic.PermissionRequest', () => ({}))
    on('classic.PostToolUse', () => ({}))
    on('tool.call', async (_, e) => {
      if (e.tool === 'Bash' && e.command === 'just build') {
        await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: e.command } })
        await clock.advance(10_000)
        // Approved; it runs a minute, and says so: the wait ends that much before the call.
        await clock.advance(60_000)
        await outer.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: e.tool_use_id ?? '', duration_ms: 60_000 })
        return BASH_OK
      }
      if (e.tool === 'ExitPlanMode') {
        await outer.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: {} })
        await clock.advance(20_000)
        return { result: {} }
      }
      if (e.tool === 'AskUserQuestion') {
        await outer.classic.PermissionRequest({ tool_name: 'AskUserQuestion', tool_input: { questions: [] } })
        await clock.advance(30_000)
        return { result: { answers: {} } }
      }
      await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: e.tool === 'Bash' ? e.command : '' } })
      await clock.advance(30_000)
      during = (await textsAt(outer)).find(found => /^Wartezeit /.test(found.text))?.text
      // Approved: the command runs on; the call's end comes later than the answer.
      await clock.advance(60_000)
      return BASH_OK
    })
    await start($)
    const row = async () => (await textsAt($)).find(found => /^Wartezeit /.test(found.text))?.text
    expect(await row()).toBeUndefined()
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'ExitPlanMode' })
    expect(await row()).toBe('Wartezeit 0:20 · 1 Freigabe')
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
    expect(await row()).toBe('Wartezeit 0:20 · 1 Freigabe')
    await $.tool.call({ tool: 'Bash', command: 'just deploy' })
    // While the dialog stood open the time went on, exact so far.
    expect(during).toBe('Wartezeit 0:50 · 2 Freigaben')
    // No run time told: the whole call counts, approximately.
    expect(await row()).toBe('Wartezeit ≈1:50 · 2 Freigaben')
    await $.tool.call({ tool: 'Bash', command: 'just build', tool_use_id: 'tu-build' })
    expect(await row()).toBe('Wartezeit ≈2:00 · 3 Freigaben')
  })

  test('the wait: an interrupted approved call is approximate too; a dialog a hook decided counts as one, its wait about none (its answer passes unread)', async ($, on) => {
    const clock = engine(on)
    const outer = $
    on('classic.PermissionRequest', (_, e) => (e.tool_input as { command?: string }).command === 'auto' ? { decision: { behavior: 'allow' as const } } : {})
    on('tool.call', async (_, e) => {
      const command = e.tool === 'Bash' ? e.command : ''
      await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command } })
      if (command === 'auto') return BASH_OK
      await clock.advance(70_000)
      await outer.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: { command }, tool_use_id: e.tool_use_id ?? '', error: 'interrupted', is_interrupt: true })
      return { isError: true, result: 'interrupted', text: 'interrupted' }
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    const row = async () => (await textsAt($)).find(found => /^Wartezeit /.test(found.text))?.text
    await $.tool.call({ tool: 'Bash', command: 'auto' })
    expect(await row()).toBe('Wartezeit ≈0:00 · 1 Freigabe')
    await $.tool.call({ tool: 'Bash', command: 'npm run dev', tool_use_id: 'tu-dev' })
    expect(await row()).toBe('Wartezeit ≈1:10 · 2 Freigaben')
  })

  test('RADAR in English', { options: { language: 'en' } }, async ($, on) => {
    engine(on)
    on('tool.call', (_, e) => failedRun($, e))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Bash', command: 'just test' })
    const texts = await textsAt($, 80, 70)
    expect(has(texts, /^⚠ going in circles: Bash command \(3×\)$/)).toBe(true)
    expect(has(texts, /^3 errors · last Bash just now$/)).toBe(true)
    expect(has(texts, /^Reset /)).toBe(false)
  })

  test('calls by identity and name: a hash of the target kept, a description or a file\'s name shown', () => {
    const bash = (command: string, description?: string) => ({ command, ...(description === undefined ? {} : { description }) })
    expect(callKey('Bash', bash('just test'))).not.toBe(callKey('Bash', bash('just lint')))
    expect(callKey('Bash', bash('just test'))).not.toContain('just')
    expect(callKey('Read', { file_path: '/a/b.ts' })).not.toBe(callKey('Edit', { file_path: '/a/b.ts' }))
    expect(callLabel('Bash', bash('just test'))).toEqual({ tool: 'Bash', detail: null })
    expect(callLabel('Bash', bash('x', `Deploy with ${FAKE.anthropic}`))).toEqual({ tool: 'Bash', detail: `Deploy with ${MASK}` })
    expect(callLabel('Read', { file_path: '/home/me/project/src/auth.ts' })).toEqual({ tool: 'Read', detail: 'auth.ts' })
    expect(callLabel('WebFetch', { url: 'https://me:pw@api.example.com:8443/v1/x?key=1', prompt: 'p' })).toEqual({ tool: 'WebFetch', detail: 'api.example.com' })
    expect(callLabel('mcp__linear__create_issue', { title: 'x' })).toEqual({ tool: 'create_issue', detail: null })
    expect(callLabel('WebFetch', { url: 'http://[::1]:8080/x', prompt: 'p' }).detail).toBe('[::1]')
    expect(callLabel('WebFetch', { url: 'https:example.com/x', prompt: 'p' }).detail).toBe('example.com')
    expect(callLabel('WebFetch', { url: 'https://registry.npmjs.org/@types/node', prompt: 'p' }).detail).toBe('registry.npmjs.org')
    // Rows as the renderer wraps words: never fewer than drawn.
    expect(wrappedRows('Updating documentation regarding configuration options', 14)).toBe(5)
    expect(wrappedRows('Run the integration tests', 14)).toBe(3)
    expect(wrappedRows('Auto-Compact in ~4 Turns', 16)).toBe(2)
    expect(wrappedRows('abcdefghijklmnopqrstuvwxyz', 10)).toBe(3)
    expect(wrappedRows('short', 40)).toBe(1)
    const twice = withFailure(withFailure(NO_RADAR, 'k', { tool: 'Bash', detail: null }, 1), 'k', { tool: 'Bash', detail: null }, 2)
    expect([twice.errors, twice.streak?.count, twice.lastError]).toEqual([2, 2, { tool: 'Bash', at: 2 }])
    const used = withFileUses(withFileUses(NO_RADAR, ['/a/x.ts', '/b/y.ts'], 1), ['/b/y.ts'], 2)
    expect(hotspotsOf(used)).toEqual([
      { name: 'y.ts', count: 2 },
      { name: 'x.ts', count: 1 },
    ])
    expect(resetClockOf(null)).toBe(null)
    expect(resetClockOf('not a time')).toBe(null)
  })

  test('no command and no path reach the pane; secrets are masked as a second guard and never kept', async ($, on) => {
    engine(on)
    const written: string[] = []
    on('state.set', { plugin: 'noxdeck' }, (_, e, next) => {
      written.push(JSON.stringify(e))
      return next(e)
    })
    const SECRET = FAKE.anthropicLong
    on('tool.call', (_, e) => (e.tool === 'Bash' ? failedRun($, e) : READ_RESULT))
    on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/very/private/dir/auth.ts' })
    for (let i = 0; i < 3; i += 1) {
      await $.tool.call({ tool: 'Bash', command: `ANTHROPIC_API_KEY=${SECRET} just deploy /proj/very/private`, description: `Deploy with ${SECRET}` })
    }
    await $.agent.spawn({ ...SPAWN, description: `deploy with ${SECRET}` })
    await $.turn.start({ text: SPAWN.prompt, turnId: 'a1-t', agentId: 'a1' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 90 }, surface })
      const texts = await ui.findAll({ type: 'Text' })
      expect(has(texts, new RegExp(`^⚠ dreht sich im Kreis: Bash · Deploy with ${MASK} \\(3×\\)$`))).toBe(true)
      expect(has(texts, /^Hotspots auth\.ts 1×$/)).toBe(true)
      for (const leak of [SECRET, 'just deploy', '/proj/very']) expect(has(texts, new RegExp(leak.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')))).toBe(false)
      await ui.press({ key: 'tab-agents' })
      expect(await ui.find({ type: 'Text', text: `deploy with ${MASK}` })).toBeDefined()
      await ui.press({ key: 'tab-live' })
      await ui.unmount()
    }
    expect(written.length).toBeGreaterThan(0)
    expect(written.some(one => one.includes(SECRET))).toBe(false)
    expect(written.some(one => one.includes('just deploy'))).toBe(false)
  })

  test('a loop the engine forks for itself (memory, compaction) is no agent at work for Nox', async ($, on) => {
    engine(on)
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ turnId: 't1', durationMs: 4000, ...ANSWERED })
    await $.turn.start({ text: '', turnId: 'm1', agentId: 'memory-fork' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await captionOf(ui))?.text).toBe('fertig')
    expect(await ui.find({ type: 'Text', text: /Agents? (läuft|laufen|wartet|warten)/ })).toBeUndefined()
    await ui.unmount()
  })

  test('Nox\'s caption and every STATUS and RADAR row stay one row in a narrow dock: cut, never wrapped', async ($, on) => {
    engine(on)
    const outer = $
    let narrow: Found[] = []
    on('classic.PermissionRequest', () => ({}))
    on('tool.call', async (_, e) => {
      if (e.tool === 'Bash' && e.command === 'rm -rf build') {
        await outer.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: e.command } })
        narrow = await textsAt(outer, 80, 24)
        return BASH_OK
      }
      return failedRun(outer, e)
    })
    await start($)
    await $.turn.start({ text: '', turnId: 't1' })
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Bash', command: 'x', description: 'Run every test there is' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    // Too narrow for its words, the caption says it shorter rather than cut.
    const asking = narrow.filter(found => found.text === 'Freigabe!')
    expect(asking.length).toBe(1)
    for (const one of asking) expect(one.props.wrap).toBe('truncate-end')
    for (const one of narrow.filter(found => /dreht sich|Fehler|Wartezeit|Run every/.test(found.text))) {
      expect(one.props.wrap).toBe('truncate-end')
    }
  })
})

describe('secrets never reach the pane', () => {
  const MASKED: readonly (readonly [string, string])[] = [
    [`export ANTHROPIC_API_KEY=${FAKE.anthropic}`, `export ANTHROPIC_API_KEY=${MASK}`],
    ['TOKEN=abc ./deploy.sh', `TOKEN=${MASK} ./deploy.sh`],
    [`GITHUB_TOKEN="${FAKE.github}" gh pr list`, `GITHUB_TOKEN="${MASK}" gh pr list`],
    [`export AWS_ACCESS_KEY_ID=${FAKE.awsKeyId}`, `export AWS_ACCESS_KEY_ID=${MASK}`],
    [`curl -H "Authorization: Bearer ${FAKE.bearer}" https://api.example.com`, `curl -H "Authorization: Bearer ${MASK}" https://api.example.com`],
    [`curl -H "Authorization: token ${FAKE.githubHeader}" https://api.github.com`, `curl -H "Authorization: token ${MASK}" https://api.github.com`],
    [`http GET example.com bearer:x Bearer ${FAKE.jwtHeader}`, `http GET example.com bearer:${MASK} Bearer ${MASK}`],
    ['wget --password hunter2 https://example.com/file', `wget --password ${MASK} https://example.com/file`],
    ['gh auth login --with-token --token=s3cr3t', `gh auth login --with-token --token=${MASK}`],
    ['mysql -u root -pS3cret shop', `mysql -u root -p${MASK} shop`],
    ['curl -u admin:hunter2 https://example.com', `curl -u admin:${MASK} https://example.com`],
    ['sshpass -p hunter2 ssh host', `sshpass -p ${MASK} ssh host`],
    ['openssl enc -aes256 -pass pass:hunter2 -in a', `openssl enc -aes256 -pass ${MASK} -in a`],
    ['git clone https://alice:hunter2@github.com/acme/app.git', `git clone https://alice:${MASK}@github.com/acme/app.git`],
    [`git clone https://${FAKE.github}@github.com/acme/app`, `git clone https://${MASK}@github.com/acme/app`],
    ['psql postgres://admin:pa55word@db.internal:5432/app', `psql postgres://admin:${MASK}@db.internal:5432/app`],
    ['curl "https://api.example.com/v1?api_key=abc123&q=cats"', `curl "https://api.example.com/v1?api_key=${MASK}&q=cats"`],
    ['echo {"client_secret": "s3cr3t-value"}', `echo {"client_secret": "${MASK}"}`],
    ['DB_PASSWORD=\'p a s s\' npm start', `DB_PASSWORD='${MASK}' npm start`],
    [`aws configure set aws_secret_access_key ${FAKE.awsSecret}`, `aws configure set aws_secret_access_key ${MASK}`],
    [`echo ${FAKE.hex}`, `echo ${MASK}`],
    [`echo ${FAKE.base64} | base64 -d`, `echo ${MASK} | base64 -d`],
    [`jwt ${FAKE.jwt}`, `jwt ${MASK}`],
    [`slack ${FAKE.slackBot}`, `slack ${MASK}`],
    [`echo ${FAKE.privateKey}`, `echo ${MASK}`],
    // Password flags whose names do not say so, on the tools that take them.
    ['docker login -u me -p hunter2 reg.io', `docker login -u me -p ${MASK} reg.io`],
    ['redis-cli -h db -a hunter2 ping', `redis-cli -h db -a ${MASK} ping`],
    ['mongosh -u admin -p hunter2 mongodb://host', `mongosh -u admin -p ${MASK} mongodb://host`],
    ["sqlcmd -S server -U sa -P 'Passw0rd!'", `sqlcmd -S server -U sa -P '${MASK}'`],
    ['zip -P hunter2 out.zip a.txt', `zip -P ${MASK} out.zip a.txt`],
    ['ldapsearch -x -D cn=admin -w hunter2', `ldapsearch -x -D cn=admin -w ${MASK}`],
    ['gh secret set FOO --body hunter2', `gh secret set FOO --body ${MASK}`],
    ['curl --user=admin:hunter2 https://x', `curl --user=admin:${MASK} https://x`],
    ['curl -uadmin:hunter2 https://x', `curl -uadmin:${MASK} https://x`],
    ['curl -b "sid=s3cr3t" https://x', `curl -b "${MASK}" https://x`],
    // Authorization and cookies, whatever their scheme or quoting.
    ['curl -H "Authorization: Splunk 12345678-1234-1234-1234-123456789012" https://splunk:8088', `curl -H "Authorization: ${MASK}" https://splunk:8088`],
    ['curl -H "Authorization: Bot MTk4NjIyNDgzNDcxOTI1MjQ4.Cl2FMQ.ZnCjm1XVW7vRze4b7Cq4se7kKWs" x', `curl -H "Authorization: ${MASK}" x`],
    ['curl -d \'{"Authorization": "Token hunter2"}\' x', `curl -d '{"Authorization": "${MASK}"}' x`],
    ["python3 -c \"requests.get(u, headers={'Authorization': 'SSWS 00aBcDeF'})\"", `python3 -c "requests.get(u, headers={'Authorization': '${MASK}'})"`],
    ['curl -H "Cookie: _ga=1; sid=s3cr3tvalue" x', `curl -H "Cookie: ${MASK}" x`],
    // Code forms, URLs and files.
    ["python3 -c \"requests.get(u, auth=('admin', 'hunter2'))\"", `python3 -c "requests.get(u, auth=${MASK})"`],
    ["python3 -c \"os.environ['API_KEY'] = 'sup3rsecret'\"", `python3 -c "os.environ['API_KEY'] = '${MASK}'"`],
    ['export REDIS_URL=redis://:hunter2@db:6379', `export REDIS_URL=redis://:${MASK}@db:6379`],
    ['psql postgres://user:p@ss@host/db', `psql postgres://user:${MASK}@host/db`],
    [`curl https://discord.com/api/webhooks/1234567890/${FAKE.discordToken}`, `curl https://discord.com/api/webhooks/1234567890/${MASK}`],
    ['azcopy copy a "https://acct.blob.core.windows.net/c/a?sv=2022&sig=Kq1x8sNc3%2BqP9L"', `azcopy copy a "https://acct.blob.core.windows.net/c/a?sv=2022&sig=${MASK}"`],
    ['echo "machine github.com login me password hunter2" >> ~/.netrc', `echo "machine github.com login me password ${MASK}" >> ~/.netrc`],
    // curl's and HTTPie's user:password, quoted or bundled.
    ['curl -u "admin:hunter2" https://x', `curl -u "admin:${MASK}" https://x`],
    ["curl -u 'admin:P@ss w0rd!' https://x", `curl -u 'admin:${MASK}' https://x`],
    ['curl -X GET -u "$USER:hunter2" https://x', `curl -X GET -u "$USER:${MASK}" https://x`],
    ['curl -ku elastic:hunter2 https://localhost:9200/_cat/indices', `curl -ku elastic:${MASK} https://localhost:9200/_cat/indices`],
    ['curl --proxy-user me:pw https://x', `curl --proxy-user me:${MASK} https://x`],
    ['curl -U me:pw https://x', `curl -U me:${MASK} https://x`],
    ['http -a admin:hunter2 GET example.com', `http -a admin:${MASK} GET example.com`],
    // Webhooks, cloud and keychain logins, passwords on stdin, and other spellings.
    [`curl -d @m.json ${FAKE.slackHook}`, `curl -d @m.json https://hooks.slack.com/services/${MASK}`],
    ['export SLACK_WEBHOOK_URL=https://example.com/hook/abc', `export SLACK_WEBHOOK_URL=${MASK}`],
    [`az login --service-principal -u 11111111-2222-3333-4444-555555555555 -p ${FAKE.azure} --tenant t`, `az login --service-principal -u 11111111-2222-3333-4444-555555555555 -p ${MASK} --tenant t`],
    ['security add-generic-password -a me -s github -w hunter2xyz', `security add-generic-password -a ${MASK} -s github -w ${MASK}`],
    ['echo "hunter2" | sudo -S softwareupdate -ia', `echo "${MASK}" | sudo -S softwareupdate -ia`],
    ["echo 'hunter2' | docker login registry.example.com -u me --password-stdin", `echo '${MASK}' | docker login registry.example.com -u me --password-stdin`],
    ['podman pull --creds me:hunter2 quay.io/x', `podman pull --creds ${MASK} quay.io/x`],
    ['export DB_PW=hunter2', `export DB_PW=${MASK}`],
    ['plink -ssh -pw hunter2 me@host', `plink -ssh -pw ${MASK} me@host`],
    ['mysql -h db -u root -p"hun ter2" app', `mysql -h db -u root -p"${MASK}" app`],
    ['git clone https://me@example.com:hunter2@git.example.com/x.git', `git clone https://me@example.com:${MASK}@git.example.com/x.git`],
    ['sqlplus system/hunter2@//db:1521/XE', `sqlplus system/${MASK}@//db:1521/XE`],
    ['ssh-keygen -t ed25519 -N "correct horse" -f ~/.ssh/deploy', `ssh-keygen -t ed25519 -N "${MASK}" -f ~/.ssh/deploy`],
    ['openssl enc -d -aes-256-cbc -k hunter2 -in s.enc', `openssl enc -d -aes-256-cbc -k ${MASK} -in s.enc`],
    ['ipmitool -I lanplus -H 10.0.0.5 -U admin -P hunter2 power status', `ipmitool -I lanplus -H 10.0.0.5 -U admin -P ${MASK} power status`],
    ['unrar x -phunter2 a.rar', `unrar x -p${MASK} a.rar`],
    ['printf "%s" "$(cat x)"; echo password: hunter2', `printf "%s" "$(cat x)"; echo password: ${MASK}`],
  ]

  test('everything that looks like a token, key, password or secret is masked', () => {
    for (const [raw, shown] of MASKED) expect(maskSecrets(raw)).toBe(shown)
  })

  const KEPT_AS_IS = [
    'git status --short',
    'npm test -- --watch=false',
    'git show 84ea5ce --stat',
    'git log --author=alice --format=%h',
    'grep -rn "password" src/',
    'sed -n 1,200p tests/noxdeck.test.tsx',
    'ls -la /home/me/noxdeck/hooks',
    'cd /tmp/claude-1000/-home-me/c0ffee00-1234-4abc-9def-0123456789ab/scratchpad && ls',
    'claude plugin validate .',
    'claude -p "hi"',
    'mkdir -p src/hooks',
    'ssh -p 2222 host',
    'docker run -p 8080:80 nginx',
    'git push -u origin main',
    'git log -p -1',
    'curl -w "%{http_code}" https://example.com:8080/a',
    'git clone git@github.com:acme/app.git',
    'cat -n data.json | jq .version',
    'curl -X POST -H "Content-Type: application/json" -d \'{"a":1}\' https://x',
    'curl -u admin https://x',
    'sort -u names.txt',
    'Implement password reset flow',
    'git commit -m "Fix password reset email"',
    'git commit -m "auth: handle expired sessions"',
    'git commit -m "Add basic validation for forms"',
    'rg "password:" -g "*.yml"',
    'openssl x509 -in cert.pem -noout -text',
    'Run the security review',
    'Explore the hooks',
    'register.tsx',
  ]

  test('masking stays fast on long, unlucky lines (no runaway backtracking)', () => {
    const unlucky = [
      'key'.repeat(700),
      'key='.repeat(500),
      ` --${'key'.repeat(700)}`,
      'a.'.repeat(1000),
      'aB3/'.repeat(500),
      `docker login ${'-x '.repeat(700)}`,
      'oras login -w('.repeat(143),
      'docker login -p ('.repeat(118),
      '7z -p('.repeat(334),
      `zip ${'('.repeat(2000)}`,
      'curl -u('.repeat(250),
      `echo ${'a '.repeat(990)}`,
      'password: '.repeat(200),
    ]
    for (const line of unlucky) {
      const started = performance.now()
      maskSecrets(line)
      expect(performance.now() - started).toBeLessThan(100)
    }
  })

  test('ordinary commands, paths and short ids stay as they are', () => {
    for (const raw of KEPT_AS_IS) expect(maskSecrets(raw)).toBe(raw)
  })
})
