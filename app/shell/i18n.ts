// The language of the page's own words (the chrome around the designs, never the designs). The
// session has one (`proto up --lang he`: the agent passes the language its conversation with the
// user is in); this browser can choose another in Settings, kept as `proto-lang`. Shared viewers
// follow their browser instead, with their own `proto-viewer-lang` preference. `?lang=` wins over
// both, as `?theme=` does. Resolved once, when the page loads: every string is read
// through t() as it is drawn, and some are read when their module loads, so a change reloads.
//
// English is the source: t() takes the English words and returns them in the page's language,
// from that language's dictionary (i18n/he.ts), or as written when it has none. `{name}` in the
// words is filled from `vars`, after the lookup, so the dictionary keeps the placeholder.
import session from '../session.json'
import { he } from './i18n/he'
import { pageQuery } from './page-query'
import { SHARE } from './mode'

export const LANGS = ['en', 'he'] as const
export type Lang = typeof LANGS[number]
/** What this browser chose: a language, or `auto` (the browser's on a share, the session's locally). */
export type LangChoice = Lang | 'auto'
/** Each language by its own name, as a language picker shows it. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', he: 'עברית' }
const RTL = new Set<Lang>(['he'])
const DICTS: Record<Lang, Record<string, string>> = { en: {}, he }

const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v)
/** The session's language, as `proto up --lang` left it. */
export const sessionLang = (s: unknown = session): Lang => { const l = (s as { lang?: unknown } | null)?.lang; return isLang(l) ? l : 'en' }

const storageKey = SHARE ? 'proto-viewer-lang' : 'proto-lang'
const browserLang = (): Lang => {
  for (const locale of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const base = locale?.toLowerCase().split('-')[0]
    if (base === 'iw') return 'he'
    if (isLang(base)) return base
  }
  return 'en'
}
const autoLang = () => SHARE ? browserLang() : sessionLang()
const stored = (): LangChoice => { try { const v = localStorage.getItem(storageKey); return isLang(v) ? v : 'auto' } catch { return 'auto' } }
const asked = new URLSearchParams(pageQuery).get('lang')

export const langChoice: LangChoice = SHARE && isLang(asked) ? asked : stored()
export const lang: Lang = isLang(asked) ? asked : langChoice === 'auto' ? autoLang() : langChoice
export const rtl = RTL.has(lang)
const dict = DICTS[lang]

document.documentElement.lang = lang
document.documentElement.dir = rtl ? 'rtl' : 'ltr'

// session.json changes with every `proto add`; read here only once, it must not reload the page
// each time (the shell's setSession hands a new language to followSession).
if (import.meta.hot) import.meta.hot.accept('../session.json', () => {})

/** Keeps this browser's choice and reloads into it (every string is read again). */
export function setLangChoice(next: LangChoice) {
  try { if (next === 'auto') localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, next) } catch { /* private mode */ }
  if (SHARE) {
    // Keep the explicit choice usable with blocked storage and override an existing ?lang=.
    const url = new URL(location.href)
    if (next === 'auto') url.searchParams.delete('lang'); else url.searchParams.set('lang', next)
    location.assign(url.href)
    return
  }
  const was = lang
  const now = isLang(asked) ? asked : next === 'auto' ? sessionLang() : next
  if (now !== was) location.reload()
}
/** A session whose language changed (`proto up --lang`) reloads when this browser follows it. */
export const followSession = (next: unknown) => { if (!SHARE && !isLang(asked) && langChoice === 'auto' && sessionLang(next) !== lang) location.reload() }

const fill = (s: string, vars?: Record<string, unknown>) => vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => k in vars ? String(vars[k]) : m) : s

/** The English words in the page's language. */
export const t = (en: string, vars?: Record<string, unknown>) => fill(dict[en] ?? en, vars)

/** A count with its noun: `one` for exactly 1, else `many`, both English with `{n}`.
 *  tn(3, '{n} variant', '{n} variants') */
export const tn = (n: number, one: string, many: string, vars?: Record<string, unknown>) => t(n === 1 ? one : many, { n, ...vars })

/** A time of day in the page's language. */
let timeFormat: Intl.DateTimeFormat | null = null, timeLang = ''
export const time = (d: Date) => {
  if (!timeFormat || timeLang !== lang) { timeFormat = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }); timeLang = lang }
  return timeFormat.format(d)
}
/** A date in the page's language (Nov 2). */
export const day = (d: Date, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => d.toLocaleDateString(lang, opts)
