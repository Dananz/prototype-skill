// The few HTML pages the host writes itself. One small template, English and Hebrew, dark by the
// viewer's colour scheme, and never indexed.
const COPY = {
  removed: { status: 410, en: ['This link was removed', 'The person who shared it took it down.'], he: ['הקישור הוסר', 'מי ששיתף אותו הסיר אותו.'] },
  notfound: { status: 404, en: ['Link not found', 'Check the address, or ask for a new link.'], he: ['הקישור לא נמצא', 'כדאי לבדוק את הכתובת או לבקש קישור חדש.'] },
  expired: { status: 410, en: ['This link has expired', 'Ask the person who shared it for a new one.'], he: ['תוקף הקישור פג', 'אפשר לבקש ממי ששיתף קישור חדש.'] },
  signin: { status: 400, en: ['Sign-in didn\'t finish', 'Go back to the link and try again.'], he: ['ההתחברות לא הושלמה', 'אפשר לחזור לקישור ולנסות שוב.'] },
  // The owner's sign-in (proto share signin, the Share popover): {login} is filled in, escaped.
  claimed: { status: 200, en: ['Signed in as {login}', 'You can close this tab.'], he: ['התחברת בתור {login}', 'אפשר לסגור את הלשונית.'] },
  claimfail: { status: 400, en: ['Sign-in didn\'t finish', 'The sign-in link works once, for 10 minutes. Ask for a new one and try again.'], he: ['ההתחברות לא הושלמה', 'קישור ההתחברות עובד פעם אחת, למשך 10 דקות. אפשר לבקש קישור חדש ולנסות שוב.'] },
  error: { status: 500, en: ['Something went wrong', 'Try again in a moment.'], he: ['משהו השתבש', 'כדאי לנסות שוב בעוד רגע.'] },
}

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const HEAD = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "frame-ancestors 'self'",
  'x-frame-options': 'SAMEORIGIN',
  'cache-control': 'no-store',
}

const STYLE = `:root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--dim:#78716c}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--dim:#a8a29e}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{padding:24px;max-width:28rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:var(--dim)}`

export function page(kind, { lang = 'en', title, login = '' } = {}) {
  const c = COPY[kind] || COPY.error
  const [head, body] = c[lang === 'he' ? 'he' : 'en'].map(s => s.replace('{login}', () => login))
  const dir = lang === 'he' ? 'rtl' : 'ltr'
  const html = `<!doctype html><html lang="${lang === 'he' ? 'he' : 'en'}" dir="${dir}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title || head)}</title><style>${STYLE}</style></head>
<body><main><h1>${esc(head)}</h1><p>${esc(body)}</p></main></body></html>`
  return new Response(html, { status: c.status, headers: HEAD })
}

// Link unfurlers read these tags and stop; browsers follow the script (which keeps the #/route of a
// deep link) or, without script, the meta refresh to the start route. Never a bare 302.
export function ogPage({ title, owner, target }) {
  const script = `location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')} + location.hash)`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="A prototype shared by ${esc(owner)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<style>${STYLE}</style></head>
<body><main><h1>${esc(title)}</h1><p>A prototype shared by ${esc(owner)}</p></main>
<script>${script}</script></body></html>`
  return new Response(html, { status: 200, headers: HEAD })
}
