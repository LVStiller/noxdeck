// What a tool call carries (a command, a URL, a search, a description)
// reaches the pane only through maskSecrets: whatever looks like a
// credential is replaced by MASK before it is kept in $.state, so it is
// never drawn and never held. The rules lean toward hiding: now and then a
// harmless value is masked too, never the other way round. Each rule finds
// its anchor once and never backtracks over a long line.

/** What a masked value is drawn as. */
export const MASK = '•••'

/** Text past this is never looked at: only the start of a line is shown. */
const MAX_SCANNED = 2000

/** A part of a name that marks the value given to it (`=`, a flag, a quoted key) as a credential. */
const SECRET_WORD = String.raw`(?:key|token|secret|passw(?:or)?d|pass|pwd|pw(?![a-z])|auth(?!or)|credential|creds?(?![a-z])|cookie|session|signature|bearer|webhook)`
/** The same for `name: value` without quotes, where prose (`auth: fix …`) is common: only plain credentials. */
const STRONG_WORD = String.raw`(?:token|secret|passw(?:or)?d|pwd|credential|bearer|webhook|api[_-]?key|(?:private|access|client|secret)[_-]?key)`
/**
 * A value: quoted, in brackets (a tuple, a list, an object), or up to the
 * next space, quote or separator, with a call's arguments when one follows.
 */
const VALUE = String.raw`(?:"[^"]*"|'[^']*'|\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|[^\s"'&;,|()}\]]+(?:\([^)]*\))?)`
/** A value may not start with a quote and a space: that quote closes something else (`rg "password:" -g …`). */
const NOT_CLOSING = String.raw`(?!["']\s)`
/** Schemes an Authorization header names before its credential; shown, the credential not. */
const SCHEMES = '(?:bearer|basic|token|digest|negotiate)'
/** Characters of a name. */
const NAME = '[A-Za-z0-9_.-]'

/** Replaces a value, keeping its quotes: `"abc"` becomes `"•••"`. */
const masked = (value: string) => (/^(["']).*\1$/s.test(value) ? `${value[0]}${MASK}${value[0]}` : MASK)

/** Tools that take a password after a flag whose name does not say so. */
const PASSWORD_TOOLS = String.raw`\b(?:(?:docker|podman|nerdctl|helm|buildah|skopeo|oras|az)\b[^|;&\n]*?\blogin|redis-cli|valkey-cli|mongo|mongosh|mongodump|mongorestore|mongoexport|mongoimport|sqlcmd|bcp|mssql-cli|cqlsh|cypher-shell|rabbitmqadmin|ipmitool|mosquitto_pub|mosquitto_sub|zip|unzip|unrar|7z|7za|ldap[a-z]*|gh\s+secret\s+set|security|ssh-keygen)\b`
/** Those flags, alone or glued to the value; tried once each in the rest of that tool's command. */
const PASSWORD_FLAG = new RegExp(String.raw`(\s(?:-pw|-[pPawNk]|-b|--body)(?:\s+|=|(?=[^\s-])))(?![-<>|])(?!${MASK})(${VALUE})`, 'g')

type Rule = { pattern: RegExp; replace: (match: string, ...groups: string[]) => string }

const RULES: readonly Rule[] = [
  // A private key in PEM form: everything from its header on.
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----.*/gs, replace: () => MASK },
  // Authorization and Cookie headers, whatever their scheme: the whole value
  // (to its closing quote, or the line's end), a known scheme's name kept.
  {
    pattern: new RegExp(
      String.raw`\b((?:proxy-)?authorization["']?\s*[:=]\s*)(?:("[^"]*"|'[^']*')|(${SCHEMES}\s+)?([^"'\n]+))`,
      'gi',
    ),
    replace: (_, head: string, quoted: string | undefined, scheme: string | undefined) =>
      quoted !== undefined ? `${head}${masked(quoted)}` : `${head}${scheme ?? ''}${MASK}`,
  },
  {
    pattern: /\b((?:set-)?cookie["']?\s*[:=]\s*)(?:("[^"]*"|'[^']*')|([^"'\n]+))/gi,
    replace: (_, head: string, quoted: string | undefined) => `${head}${quoted !== undefined ? masked(quoted) : MASK}`,
  },
  // `Bearer …` and `Basic …` anywhere, when what follows looks like a credential (not `basic validation`).
  {
    pattern: /\b([Bb]earer|BEARER|[Bb]asic|BASIC)(\s+)(?=[A-Za-z0-9._~+/=-]*[A-Z0-9+/=])[A-Za-z0-9._~+/=-]{6,}/g,
    replace: (_, scheme: string, gap: string) => `${scheme}${gap}${MASK}`,
  },
  // Credentials in a URL: `https://user:password@host`, `redis://:password@host`, `https://token@host`.
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:]*):([^\s/]+)@/gi,
    replace: (_, scheme: string, user: string) => `${scheme}${user}:${MASK}@`,
  },
  { pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]{12,})@/gi, replace: (_, scheme: string) => `${scheme}${MASK}@` },
  // A Slack webhook's path is its credential; a signed URL's signature (`?sig=…`, `X-Amz-Signature=…`).
  { pattern: /(\bhooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9_/-]+/gi, replace: (_, head: string) => `${head}${MASK}` },
  { pattern: /([?&](?:sig|x-amz-signature|x-goog-signature)=)([^&\s"'#]+)/gi, replace: (_, head: string) => `${head}${MASK}` },
  // Passwords some tools take glued to a flag, as user/password, or as a user:password pair.
  {
    pattern: /(\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^|;&\n]*?\s-p)(?=\S)("[^"]*"|'[^']*'|\S+)/gi,
    replace: (_, head: string, value: string) => `${head}${masked(value)}`,
  },
  { pattern: /(\bsshpass\s+-p\s*)(\S+)/gi, replace: (_, head: string) => `${head}${MASK}` },
  { pattern: /(\bcurl\b[^|;&\n]*?\s-b(?:\s+|=)?)(?!-)("[^"]*"|'[^']*'|\S+)/g, replace: (_, head: string, value: string) => `${head}${masked(value)}` },
  { pattern: /(\bopenssl\b[^|;&\n]*?\s-k\s+)("[^"]*"|'[^']*'|\S+)/g, replace: (_, head: string, value: string) => `${head}${masked(value)}` },
  { pattern: /(\bsqlplus\s+(?:-\w+\s+)*[^\s/@]+\/)([^\s@]+)/gi, replace: (_, head: string) => `${head}${MASK}` },
  // curl's -u/--user/-U/--proxy-user (alone or bundled: -ku, -su) and HTTPie's -a/--auth:
  // a user:password pair, quoted or not, keeps its user.
  {
    pattern: /((?<![\w.:-])(?:curl|https?|xhs?)(?=\s)[^|;&\n]*?\s(?:-[A-Za-z]*[uUa]|--(?:proxy-)?user|--auth)(?:\s+|=)?)((?:"[^"]*"|'[^']*'|[^\s"'|;&])+)/g,
    replace: (_, head: string, word: string) => {
      const colon = word.indexOf(':')
      if (colon < 0) return `${head}${word}`
      const open = /^(?:[^"']|"[^"]*"|'[^']*')*(["'])/.exec(word.slice(0, colon))?.[1] ?? ''
      return `${head}${word.slice(0, colon + 1)}${MASK}${open}`
    },
  },
  { pattern: /((?:^|\s)(?:-u\s*|--user(?:\s+|=))["']?[^\s:'"]+:)([^\s'"]+)/g, replace: (_, head: string) => `${head}${MASK}` },
  // The password flags of the tools above: the tool found once, then each flag in the rest of its command.
  {
    pattern: new RegExp(String.raw`(${PASSWORD_TOOLS})((?:"[^"]*"|'[^']*'|\([^)]*\)|[^|;&\n])*)`, 'g'),
    replace: (_, tool: string, rest: string) =>
      tool + rest.replace(PASSWORD_FLAG, (_whole: string, head: string, value: string) => `${head}${masked(value)}`),
  },
  // A password echoed into a command that reads it: `echo pw | sudo -S`, `| docker login --password-stdin`.
  {
    pattern:
      /(\b(?:echo|printf)\s+(?:-\w+\s+)*)("[^"]*"|'[^']*'|[^\s|]+)(?=\s*\|[^\n]*?(?:\bsudo\s+(?:-\w+\s+)*-S\b|--password-stdin|\bchpasswd\b|--passphrase-fd|\bpasswd\s+--stdin))/g,
    replace: (_, head: string, value: string) => `${head}${masked(value)}`,
  },
  // A value given to a credential's name: `API_KEY=…`, `?secret=…`,
  // `env['PASSWORD'] = …`, `"token": "…"`, `password: …`. A name is tried from
  // its start only, so a long run of name characters costs one pass.
  {
    pattern: new RegExp(
      String.raw`(?<!${NAME})((?=${NAME}*${SECRET_WORD})${NAME}+)(["']?\]?\s*=\s*)(?!${SCHEMES}\s)(?!${MASK})${NOT_CLOSING}(${VALUE})`,
      'gi',
    ),
    replace: (_, name: string, gap: string, value: string) => `${name}${gap}${masked(value)}`,
  },
  {
    pattern: new RegExp(
      String.raw`(["'])((?=${NAME}*${SECRET_WORD})${NAME}+)\1(\s*:\s*)(?!${SCHEMES}\s)(?!${MASK})${NOT_CLOSING}(${VALUE})`,
      'gi',
    ),
    replace: (_, quote: string, name: string, gap: string, value: string) => `${quote}${name}${quote}${gap}${masked(value)}`,
  },
  {
    pattern: new RegExp(
      String.raw`(?<!${NAME})((?=${NAME}*${STRONG_WORD})${NAME}+)(\s*:\s*)(?!${SCHEMES}\s)(?!${MASK})${NOT_CLOSING}(${VALUE})`,
      'gi',
    ),
    replace: (_, name: string, gap: string, value: string) => `${name}${gap}${masked(value)}`,
  },
  // A value after a credential's flag: `--token …`, `-password …`, `--creds …`.
  {
    pattern: new RegExp(String.raw`((?:^|\s)--?(?=[A-Za-z0-9_-]*${SECRET_WORD})[A-Za-z0-9_-]+)(\s+)(?![-<>|])(?!${MASK})(${VALUE})`, 'gi'),
    replace: (_, flag: string, gap: string, value: string) => `${flag}${gap}${masked(value)}`,
  },
  // A .netrc line: `machine host login me password hunter2`.
  { pattern: /(\blogin\s+\S+\s+password\s+)([^\s"']+)/gi, replace: (_, head: string) => `${head}${MASK}` },
  // Tokens known by their form: Anthropic and OpenAI, GitHub, GitLab, Slack,
  // AWS, Google, npm, Hugging Face, Stripe, and JSON web tokens.
  {
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|[rsp]k_(?:live|test)_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g,
    replace: () => MASK,
  },
  // Long hex strings: 32 digits and more (keys, hashes, full commit ids).
  { pattern: /(?<![0-9a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-fA-F])/g, replace: () => MASK },
]

/** A run that reads as random: 32 characters and more, with digits and both cases. */
const looksRandom = (run: string) => run.length >= 32 && /\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run)

/**
 * Long Base64 strings: 32 characters and more with digits and both cases.
 * In a path (from `/`, `./`, `~/`, or inside one, a URL's too) each part
 * between slashes is judged alone, so its words never read as one long run.
 */
function maskLongRuns(text: string): string {
  return text.replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, (run: string, offset: number) => {
    const before = text[offset - 1] ?? ''
    const isPath = run.includes('/') && (/^[/.~]/.test(run) || /[/.~]/.test(before))
    if (isPath) return run.split('/').map(part => (looksRandom(part) ? MASK : part)).join('/')
    return looksRandom(run) ? MASK : run
  })
}

/** The text with everything that looks like a token, key, password or secret replaced by MASK. */
export function maskSecrets(text: string): string {
  const scanned = text.slice(0, MAX_SCANNED)
  const ruled = RULES.reduce((current, rule) => current.replace(rule.pattern, rule.replace), scanned)
  return maskLongRuns(ruled)
}
