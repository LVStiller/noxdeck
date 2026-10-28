import type { Color } from 'claude-code'

// A theme names colors by the person's theme keys only, so every color
// follows their light or dark Claude Code theme, and picks the glyphs the
// bar, the threshold line and the hearts are drawn with. To add a theme: add
// an entry here and its name to the `theme` option's list in
// .claude-plugin/plugin.json.

export type SourceKey = 'messages' | 'tools' | 'mcp' | 'memory' | 'skills' | 'system' | 'other'

export type Theme = {
  name: string
  /** The one accent: the active tab, the running step, the edited file, the history and its threshold line. */
  accent: Color
  onAccent: Color
  done: Color
  bad: Color
  frame: Color
  /** The 5h limit bar's empty cells and the history's placeholder dots. */
  track: Color
  /** The context bar's free capacity: a quiet dark grey under full cells. */
  free: Color
  /** The auto-compact mark on the bar: it stands out on the free run and on every source. */
  marker: Color
  heart: Color
  /** One muted tone per context source. */
  sources: Record<SourceKey, Color>
  bar: { cell: string; marker: string; threshold: string }
  /**
   * The Agents tab's bars and the timeline's: a lower three-quarter block, so
   * bars on rows one under another keep a gap; a bar's empty rest in the same
   * glyph, dim. Whole cells only.
   */
  agentBar: { cell: string }
  /** The 5h limit as a small bar: `cells` cells of `cell`, full ones in `heart`, the rest in `track`. */
  limitBar: { cell: string; cells: number }
  /**
   * The 5h limit as five hearts: full ones in `heart`, empty ones in `emptyColor`.
   * Each is followed by a space: a terminal may draw the glyph wider than its
   * one cell, and the space takes the overflow instead of the next heart.
   */
  limitHearts: { full: string; empty: string; emptyColor: Color }
  /** The mascot's roles: body, outline and shadow, shine, pupils, and the yellow of eyes and feet. */
  mascot: { body: Color; outline: Color; shine: Color; eyes: Color; accent: Color }
}

const classic: Theme = {
  name: 'classic',
  accent: 'claude',
  onAccent: 'inverseText',
  done: 'success',
  bad: 'error',
  frame: 'promptBorder',
  track: 'subtle',
  free: 'userMessageBackground',
  marker: 'text',
  heart: 'claude',
  // Muted pastels: the theme's rainbow keys, the same soft tones in the dark
  // and light themes and plain ANSI colors in the ANSI ones.
  sources: {
    messages: 'rainbow_blue',
    mcp: 'rainbow_green',
    tools: 'rainbow_indigo',
    memory: 'rainbow_yellow',
    skills: 'rainbow_violet',
    system: 'rainbow_orange',
    other: 'inactive',
  },
  bar: { cell: '█', marker: '│', threshold: '·' },
  agentBar: { cell: '▆' },
  // Block elements draw one cell wide in every terminal font; hearts, circled
  // letters and similar symbols can be drawn wider and overlap their neighbours.
  limitBar: { cell: '▊', cells: 10 },
  limitHearts: { full: '♥', empty: '♡', emptyColor: 'inactive' },
  // Keys that keep their tone in the dark and the light theme, so the owl
  // reads alike on both: lavender with its own shine, a dark slate outline,
  // black pupils and chrome yellow.
  mascot: {
    body: 'rainbow_indigo',
    outline: 'rate_limit_empty',
    shine: 'rainbow_indigo_shimmer',
    eyes: 'clawd_background',
    accent: 'chromeYellow',
  },
}

export const THEMES: Readonly<Record<string, Theme>> = { classic }

export function themeOf(name: unknown): Theme {
  return (typeof name === 'string' && THEMES[name]) || classic
}
