// Signing in with GitHub (spec: Access and identity › Signing in with GitHub). The apex runs the
// OAuth web flow; the share origin turns a 60 s ticket into its own viewer cookie. The access token
// is used for one /user read and dropped: only the id, login, name and avatar are kept.
import { isId } from './ids.mjs'
import { namesOf } from './routes.mjs'
import { page } from './pages.mjs'
import { redirect } from './http.mjs'
import { b64url, cookie, nonceCookie, readCookies, sign, stateCookie, verify, viewerCookie } from './cookies.mjs'

const UA = 'proto-share'
const STATE_MS = 10 * 60_000
const TICKET_MS = 60_000
const COOKIE_S = 30 * 24 * 3600

const oauthBase = env => (env.GITHUB_OAUTH || 'https://github.com').replace(/\/+$/, '')
const apiBase = env => (env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, '')

/** Commenting needs all three secrets; without them the viewer only reads. */
export const signinReady = env => !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.VIEWER_KEY)

const NONCE = /^[\w-]{22}$/
const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)))
const sha256 = async s => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))

/**
 * Where the viewer goes back to: `back` is a path on the share's own origin, never a whole URL, so
 * the flow can't be turned into an open redirect. Anything else falls back to the share's start.
 */
export function safeBack(origin, root, back) {
  if (typeof back !== 'string' || back.length > 2000 || !back.startsWith(root) || back.startsWith('//') || /[\\\u0000-\u001f]/.test(back)) return root
  try { return new URL(back, origin).origin === origin ? back : root } catch { return root }
}

// The share's origin as the viewer had it: the path form on 127.0.0.1 (no subdomains there), in path
// mode, or when they were on it (`back` under /s/<id>/) on this Mac; else <id>.<host>.
function returnTo(env, protocol, host, id, back) {
  const prefix = `/s/${id}/`
  const paths = env.PATH_MODE === '1' || /^127\.0\.0\.1(:|$)/.test(host) || (namesOf(env.BASE).local && typeof back === 'string' && back.startsWith(prefix))
  const origin = paths ? `${protocol}//${host}` : `${protocol}//${id}.${host}`
  const root = paths ? prefix : '/'
  return { origin, root, back: safeBack(origin, root, back) }
}

/**
 * GET <share origin>/_in/start?back=<path>: where "Sign in with GitHub" goes. It sets a nonce cookie
 * on the share's origin and sends the browser to the apex with the nonce, which rides in the signed
 * state and the ticket. /_in/auth then takes the ticket only with that cookie, so a ticket replayed
 * in another browser, or pushed into a victim's (login CSRF), is refused.
 */
export function startIn(env, url, share, pathForm) {
  if (!signinReady(env)) return page('signin', { lang: share.lang })
  const nonce = random(16)
  const nc = nonceCookie(url, share.id, pathForm)
  const apexHost = pathForm ? url.host : url.host.slice(share.id.length + 1)
  const to = new URL(`${url.protocol}//${env.BASE}/auth/github`)
  to.searchParams.set('share', share.id)
  to.searchParams.set('back', url.searchParams.get('back') || (pathForm ? `/s/${share.id}/` : '/'))
  to.searchParams.set('nonce', nonce)
  to.searchParams.set('via', apexHost)
  return redirect(to.href, [cookie(nc.name, nonce, { path: nc.path, maxAge: STATE_MS / 1000, secure: nc.secure })])
}

/** GET <apex>/auth/github?share=<id>&back=<path>&nonce=<from /_in/start>[&via=<host>] */
export async function authStart(env, url) {
  if (!signinReady(env)) return page('signin', {})
  const q = url.searchParams
  if (!NONCE.test(q.get('nonce') || '')) return page('signin', {})
  const id = q.get('share') || ''
  const row = isId(id) ? await env.DB.prepare('SELECT lang, deleted_at, expires_at FROM shares WHERE id = ?').bind(id).first() : null
  if (!row || row.deleted_at || (row.expires_at && row.expires_at < Date.now())) return page('notfound', { lang: row?.lang })
  // GitHub matches redirect_uri exactly, so the flow runs on the one name the OAuth App knows
  // (BASE). A visitor on the other loopback name is sent there, with where they came from.
  if (url.host.toLowerCase() !== env.BASE.toLowerCase()) {
    const to = new URL(`${url.protocol}//${env.BASE}/auth/github`)
    to.searchParams.set('share', id)
    if (q.has('back')) to.searchParams.set('back', q.get('back'))
    to.searchParams.set('nonce', q.get('nonce'))
    to.searchParams.set('via', url.host)
    return redirect(to.href)
  }
  const via = (q.get('via') || '').toLowerCase()
  const host = namesOf(env.BASE).names.some(n => n.toLowerCase() === via) ? via : url.host
  const ret = returnTo(env, url.protocol, host, id, q.get('back'))
  const n = random(16), verifier = random(32)
  const sc = stateCookie(url)
  const state = await sign(env.VIEWER_KEY, 'state', { n, v: verifier, nn: q.get('nonce'), share: id, ...ret, exp: Date.now() + STATE_MS })
  const go = new URL(`${oauthBase(env)}/login/oauth/authorize`)
  go.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${url.protocol}//${url.host}/auth/github/callback`,
    scope: '', // the public profile only
    state: n,
    allow_signup: 'true',
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
  }).toString()
  return redirect(go.href, [cookie(sc.name, state, { path: sc.path, maxAge: STATE_MS / 1000, secure: sc.secure })])
}

// Avatars are shown as images on every viewer's page, so only GitHub's own image host is kept; a test
// GitHub (GITHUB_API overridden) may serve them from any https host.
function avatarOf(a, env) {
  if (typeof a !== 'string' || a.length > 500) return null
  return (env.GITHUB_API ? /^https:\/\/[^/]/ : /^https:\/\/avatars\.githubusercontent\.com\//).test(a) ? a : null
}

/** The few fields kept of GitHub's /user answer, or null when it isn't a user. */
export function viewerFrom(u, env) {
  if (!u || typeof u !== 'object' || !Number.isSafeInteger(u.id) || u.id <= 0) return null
  if (typeof u.login !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(u.login)) return null
  return {
    gh_id: u.id,
    login: u.login,
    name: typeof u.name === 'string' && u.name.trim() ? u.name.trim().slice(0, 80) : null,
    avatar: avatarOf(u.avatar_url, env),
  }
}

/** GET <apex>/auth/github/callback?code&state */
export async function authCallback(req, env, url) {
  const sc = stateCookie(url)
  const clear = cookie(sc.name, '', { path: sc.path, maxAge: 0, secure: sc.secure })
  const bad = () => { const r = page('signin', {}); r.headers.append('set-cookie', clear); return r }
  if (!signinReady(env)) return bad()
  let st = null
  for (const [name, value] of readCookies(req)) if (!st && name === sc.name) st = await verify(env.VIEWER_KEY, 'state', value)
  const q = url.searchParams
  if (!st || typeof st.n !== 'string' || q.get('state') !== st.n) return bad()
  // Declined on GitHub: back to the link, still signed out.
  if (q.get('error') || !q.get('code')) return redirect(st.origin + st.back, [clear])
  let user = null
  try {
    const t = await fetch(`${oauthBase(env)}/login/oauth/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
      body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: q.get('code'), redirect_uri: `${url.protocol}//${url.host}/auth/github/callback`, code_verifier: st.v }).toString(),
    })
    // A refused exchange is a 200 with an error field, so the token's presence is the test.
    const tok = await t.json().catch(() => null)
    if (!t.ok || typeof tok?.access_token !== 'string') return bad()
    const u = await fetch(`${apiBase(env)}/user`, { headers: { authorization: `Bearer ${tok.access_token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': UA } })
    user = u.ok ? viewerFrom(await u.json().catch(() => null), env) : null
  } catch (e) {
    console.error(e)
    return bad()
  }
  if (!user) return bad()
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO viewers (gh_id, login, name, avatar, seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(gh_id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar = excluded.avatar, seen_at = excluded.seen_at`,
  ).bind(user.gh_id, user.login, user.name, user.avatar, now).run()
  const ticket = await sign(env.VIEWER_KEY, 'ticket', { gh: user.gh_id, share: st.share, to: st.back, nn: st.nn, exp: now + TICKET_MS })
  return redirect(`${st.origin}${st.root}_in/auth?t=${encodeURIComponent(ticket)}`, [clear])
}

/**
 * GET <share origin>/_in/auth?t=<ticket>: the ticket becomes this origin's viewer cookie, only in the
 * browser holding the ticket's nonce cookie, and only once.
 */
export async function ticketIn(req, env, url, share, pathForm) {
  const bad = page('signin', { lang: share.lang })
  if (!env.VIEWER_KEY) return bad
  const t = await verify(env.VIEWER_KEY, 'ticket', url.searchParams.get('t'))
  if (!t || t.share !== share.id || !Number.isSafeInteger(t.gh) || typeof t.nn !== 'string') return bad
  const nc = nonceCookie(url, share.id, pathForm)
  if (!readCookies(req).some(([name, value]) => name === nc.name && value === t.nn)) return bad
  if (!await env.DB.prepare('SELECT 1 AS ok FROM viewers WHERE gh_id = ?').bind(t.gh).first()) return bad
  // Used once: the nonce is the ticket's id. Spent ones are dropped once their ticket has expired.
  const now = Date.now()
  await env.DB.prepare('DELETE FROM tickets WHERE exp < ?').bind(now).run()
  const spent = await env.DB.prepare('INSERT INTO tickets (nonce, exp) VALUES (?, ?) ON CONFLICT(nonce) DO NOTHING').bind(t.nn, t.exp).run()
  if (!spent.meta?.changes) return bad
  const vc = viewerCookie(url, share.id, pathForm)
  const value = await sign(env.VIEWER_KEY, 'v', { gh: t.gh, share: share.id, exp: now + COOKIE_S * 1000 })
  const root = pathForm ? `/s/${share.id}/` : '/'
  return redirect(url.origin + safeBack(url.origin, root, t.to), [
    cookie(vc.name, value, { path: vc.path, maxAge: COOKIE_S, secure: vc.secure }),
    cookie(nc.name, '', { path: nc.path, maxAge: 0, secure: nc.secure }),
  ])
}

/** The signed-in viewer of this share, { gh_id, login, name, avatar }, or null. */
export async function viewerOf(req, env, shareId) {
  if (!env.VIEWER_KEY) return null
  for (const [name, value] of readCookies(req)) {
    if (name !== 'v' && name !== '__Host-v') continue
    const p = await verify(env.VIEWER_KEY, 'v', value)
    if (!p || p.share !== shareId || !Number.isSafeInteger(p.gh)) continue
    const row = await env.DB.prepare('SELECT gh_id, login, name, avatar FROM viewers WHERE gh_id = ?').bind(p.gh).first()
    if (row) return row
  }
  return null
}

export function signOutCookie(url, shareId, pathForm) {
  const vc = viewerCookie(url, shareId, pathForm)
  return cookie(vc.name, '', { path: vc.path, maxAge: 0, secure: vc.secure })
}
