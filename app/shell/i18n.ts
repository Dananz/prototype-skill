// The language of the page's own words (the chrome around the designs, never the designs). The
// session has one (`proto up --lang he`: the agent passes the language its conversation with the
// user is in); this browser can choose another in Settings, kept as `proto-lang`, and `?lang=`
// wins over both, as `?theme=` does. Resolved once, when the page loads: every string is read
// through t() as it is drawn, and some are read when their module loads, so a change reloads.
//
// English is the source: t() takes the English words and returns them in the page's language,
// from that language's dictionary (i18n/he.ts), or as written when it has none. `{name}` in the
// words is filled from `vars`, after the lookup, so the dictionary keeps the placeholder.
import session from '../session.json'
import { he } from './i18n/he'

export const LANGS = ['en', 'he'] as const
export type Lang = typeof LANGS[number]
/** What this browser chose: a language, or `auto`, the session's. */
export type LangChoice = Lang | 'auto'
/** Each language by its own name, as a language picker shows it. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', he: 'עברית' }
const RTL = new Set<Lang>(['he'])
const DICTS: Record<Lang, Record<string, string>> = { en: {}, he }

const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v)
/** The session's language, as `proto up --lang` left it. */
export const sessionLang = (s: unknown = session): Lang => { const l = (s as { lang?: unknown } | null)?.lang; return isLang(l) ? l : 'en' }

const stored = (): LangChoice => { try { const v = localStorage.getItem('proto-lang'); return isLang(v) ? v : 'auto' } catch { return 'auto' } }
const asked = new URLSearchParams(location.search).get('lang')

export const langChoice: LangChoice = stored()
export const lang: Lang = isLang(asked) ? asked : langChoice === 'auto' ? sessionLang() : langChoice
export const rtl = RTL.has(lang)
const dict = DICTS[lang]

document.documentElement.lang = lang
document.documentElement.dir = rtl ? 'rtl' : 'ltr'

// session.json changes with every `proto add`; read here only once, it must not reload the page
// each time (the shell's setSession hands a new language to followSession).
if (import.meta.hot) import.meta.hot.accept('../session.json', () => {})

/** Keeps this browser's choice and reloads into it (every string is read again). */
export function setLangChoice(next: LangChoice) {
  try { if (next === 'auto') localStorage.removeItem('proto-lang'); else localStorage.setItem('proto-lang', next) } catch { /* private mode: this load only */ }
  const was = lang
  const now = isLang(asked) ? asked : next === 'auto' ? sessionLang() : next
  if (now !== was) location.reload()
}
/** A session whose language changed (`proto up --lang`) reloads when this browser follows it. */
export const followSession = (next: unknown) => { if (!isLang(asked) && langChoice === 'auto' && sessionLang(next) !== lang) location.reload() }

const fill = (s: string, vars?: Record<string, unknown>) => vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => k in vars ? String(vars[k]) : m) : s

/** The English words in the page's language. */
export const t = (en: string, vars?: Record<string, unknown>) => fill(dict[en] ?? en, vars)

/** A count with its noun: `one` for exactly 1, else `many`, both English with `{n}`.
 *  tn(3, '{n} variant', '{n} variants') */
export const tn = (n: number, one: string, many: string, vars?: Record<string, unknown>) => t(n === 1 ? one : many, { n, ...vars })

/** A time of day in the page's language. */
export const time = (d: Date) => d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
/** A date in the page's language (Nov 2). */
export const day = (d: Date, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => d.toLocaleDateString(lang, opts)
