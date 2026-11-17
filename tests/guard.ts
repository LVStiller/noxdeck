// Claude Code's built-in guard above noxdeck, as far as the tests need it.
//
// Claude Code loads a plugin of its own, `sec-default@builtin`, ahead of
// every plugin a person installs where the machine has managed settings or
// the account is on a Team or Enterprise plan. Its source is public:
// anthropics/claude-code, mods/sec-default. The two hooks here are lines 38
// and 71 of its hooks/register.ts as of commit 14bb83918, word for word:
// every classic event and every compaction continue past the user tier, so
// a person's hook on them does not run. Its other hooks are left out.
//
// Only the test kit loads this, as an inline plugin beside the one under
// test (`{ plugins: [GUARD] }`); no manifest names it.

import type { Plugin } from 'claude-code/testing'

export const GUARD: Plugin = {
  name: 'guard',
  tier: 'prepend',
  register(on) {
    on('classic.*', ($, e, next) => next.to(e, 'append'))
    on('session.compact', ($, e, next) => next.to(e, 'append'))
  },
}
