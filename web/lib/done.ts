// The pages the share host sends the browser to on prtype.dev when it has nothing else to show: how
// a sign-in ended (the owner's claim, a Mac signing in, a viewer's sign-in that didn't finish), and a
// link or page that isn't there or failed. The host redirects to /done/<kind>?login=<GitHub login>
// &lang=he (host/lib/pages.mjs, siteRedirect); the words and the status are the host's own (its
// COPY), kept here so the answer is the same as when the host drew the page itself. middleware.ts
// answers with the status; app/done/[kind] draws the words.
export type Lang = 'en' | 'he'
type Tone = 'ok' | 'wait' | 'stop' | 'off' | 'fail' | 'lost'
type Words = { head: string; text: string; /** The head when the login is missing or not a GitHub login. */ plain?: string }

export const DONE = {
  signin: { status: 400, tone: 'fail', en: { head: 'Sign-in didn’t finish', text: 'Go back to the link and try again.' }, he: { head: 'ההתחברות לא הושלמה', text: 'אפשר לחזור לקישור ולנסות שוב.' } },
  claimed: { status: 200, tone: 'ok', en: { head: 'Signed in as {login}', plain: 'Signed in', text: 'You can close this tab.' }, he: { head: 'התחברת בתור {login}', plain: 'התחברת', text: 'אפשר לסגור את הלשונית.' } },
  signedin: { status: 200, tone: 'ok', en: { head: 'Signed in as @{login}', plain: 'Signed in', text: 'You can close this tab.' }, he: { head: 'התחברת בתור @{login}', plain: 'התחברת', text: 'אפשר לסגור את הלשונית.' } },
  waiting: { status: 200, tone: 'wait', en: { head: 'Thanks, @{login}', plain: 'Thanks', text: 'Sharing opens once the maintainer approves you. You can close this tab.' }, he: { head: 'תודה, @{login}', plain: 'תודה', text: 'השיתוף ייפתח אחרי שהמתחזק יאשר את החשבון. אפשר לסגור את הלשונית.' } },
  blocked: { status: 403, tone: 'stop', en: { head: '@{login} can’t share here', plain: 'This account can’t share here', text: 'This account was blocked on this host.' }, he: { head: '@{login} לא יכול לשתף כאן', plain: 'החשבון הזה לא יכול לשתף כאן', text: 'החשבון הזה נחסם במארח הזה.' } },
  cancelled: { status: 200, tone: 'off', en: { head: 'Sign-in cancelled', text: 'Nothing was signed in. You can close this tab.' }, he: { head: 'ההתחברות בוטלה', text: 'שום דבר לא חובר. אפשר לסגור את הלשונית.' } },
  claimfail: { status: 400, tone: 'fail', en: { head: 'Sign-in didn’t finish', text: 'The sign-in link works once, for 10 minutes. Ask for a new one and try again.' }, he: { head: 'ההתחברות לא הושלמה', text: 'קישור ההתחברות עובד פעם אחת, למשך 10 דקות. אפשר לבקש קישור חדש ולנסות שוב.' } },
  notfound: { status: 404, tone: 'lost', en: { head: 'Link not found', text: 'Check the address, or ask for a new link.' }, he: { head: 'הקישור לא נמצא', text: 'כדאי לבדוק את הכתובת או לבקש קישור חדש.' } },
  error: { status: 500, tone: 'fail', en: { head: 'Something went wrong', text: 'Try again in a moment.' }, he: { head: 'משהו השתבש', text: 'כדאי לנסות שוב בעוד רגע.' } },
} satisfies Record<string, { status: number; tone: Tone; en: Words; he: Words }>

export type DoneKind = keyof typeof DONE
export const isDoneKind = (k: string): k is DoneKind => Object.hasOwn(DONE, k)

/** /done/<kind>, or null for any other path. */
export const doneKindOf = (pathname: string): DoneKind | null => {
  const m = /^\/done\/([a-z]+)\/?$/.exec(pathname)
  return m && isDoneKind(m[1]) ? m[1] : null
}

/** A GitHub login as the host keeps it (host/lib/github.mjs viewerFrom), else none. */
export const loginOf = (v: unknown): string | null => typeof v === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(v) ? v : null

export const langOf = (v: unknown): Lang => (v === 'he' ? 'he' : 'en')

/**
 * The page's two lines, the login put in (React escapes it) or the plain head without one. parts: the
 * head around the login (with its @), so the page can keep the login left to right in Hebrew.
 */
export function wordsOf(kind: DoneKind, lang: Lang, login: string | null) {
  const w: Words = DONE[kind][lang]
  if (!w.head.includes('{login}') || !login) return { head: w.plain ?? w.head, text: w.text, parts: null }
  const m = /^(.*?)(@?\{login\})(.*)$/.exec(w.head)!
  const name = m[2].replace('{login}', login)
  return { head: m[1] + name + m[3], text: w.text, parts: [m[1], name, m[3]] as const }
}
