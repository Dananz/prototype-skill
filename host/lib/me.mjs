// prtype.dev/me: the signed-in owner's links, from every project and every Mac, and what they can do
// with each (copy, open, edit on the Mac, the message for viewers, comments, turn off, remove). One
// server-rendered page with a small inline script (the fallback on hosts with no Next.js face, as on
// this Mac; prtype.dev serves me/ instead), and /me/api, a thin face over the owner API's own
// logic, authenticated by a cookie instead of a token. The cookie names a GitHub account; the page
// covers every owners row with that gh_id that is active, and every change checks the link is one of
// theirs. Signed in only through GitHub (github.mjs, kind 'me'). English only.
import { json, fail, redirect } from './http.mjs'
import { esc } from './pages.mjs'
import { cookie, meCookie, readCookies, verify, b64url } from './cookies.mjs'
import { signinReady } from './github.mjs'
import { namesOf } from './routes.mjs'
import { isId } from './ids.mjs'
import { MAX_MESSAGE, deleteShare, getShare, owns, patchShare, sharesOf } from './shares.mjs'
import { latestComments, patchComment } from './comments.mjs'

const DAY_MS = 86_400_000
// presence.at within 2 minutes is "in it now" (schema.sql, presence).
const NOW_MS = 120_000
const NOTES = 10
const KV_RETRY_MS = 300

// ---------- who is signed in ----------

/**
 * The GitHub account of this browser's /me cookie and the owners rows it is: { gh, login, ids, rows,
 * state } or null when signed out. ids: the active rows' ids, none when any row is banned. Only the
 * one cookie name this origin sets is read (meCookie), so on https a sibling share can't toss one in.
 */
export async function meOf(req, env, url) {
  if (!env.VIEWER_KEY) return null
  const name = meCookie(url).name
  let p = null
  for (const [n, v] of readCookies(req)) if (!p && n === name) p = await verify(env.VIEWER_KEY, 'me', v)
  if (!p || !Number.isSafeInteger(p.gh) || p.gh <= 0) return null
  const { results: rows } = await env.DB.prepare('SELECT id, gh_login, gh_name, gh_avatar, status, created_at FROM owners WHERE gh_id = ? ORDER BY created_at, id').bind(p.gh).all()
  const banned = rows.some(r => r.status === 'banned')
  const active = banned ? [] : rows.filter(r => r.status === 'active')
  const named = active.find(r => r.gh_login) || rows.find(r => r.gh_login)
  return {
    gh: p.gh,
    login: named?.gh_login || (typeof p.l === 'string' ? p.l : ''),
    name: named?.gh_name || null,
    avatar: named?.gh_avatar || null,
    ids: active.map(r => r.id),
    state: banned ? 'banned' : active.length ? 'owner' : rows.some(r => r.status === 'pending') ? 'pending' : 'none',
  }
}

const signOutCookie = url => { const mc = meCookie(url); return cookie(mc.name, '', { path: mc.path, maxAge: 0, secure: mc.secure }) }

// ---------- the face ----------

/** Every route under /me on the host's own name. */
export async function meFace(req, env, url, path, { pathsOnly = false } = {}) {
  // A host that serves every share under its own name (path mode off this Mac) would put other
  // people's pages on /me's origin, where they could act as its signed-in owner: /me stays shut there.
  if (pathsOnly) return path.startsWith('/me/api/') ? fail(404, 'No such route.') : shell({ title: 'Not on this host', body: quiet('Your links live on prtype.dev', 'This host has no owner page.') }, 404)
  // The cookie is set on BASE; the other loopback name goes there.
  if (url.host.toLowerCase() !== env.BASE.toLowerCase() && (req.method === 'GET' || req.method === 'HEAD')) return redirect(`${url.protocol}//${env.BASE}${url.pathname}${url.search}`)
  if (path === '/me' || path === '/me/') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
    return mePage(req, env, url)
  }
  if (path.startsWith('/me/api/')) return meApi(req, env, url, path.slice('/me/api/'.length).split('/'))
  return shell({ title: 'Not found', body: quiet('Nothing here', 'Your links are at /me.') }, 404)
}

// Every change must come from /me itself: the Origin a browser sends with every non-GET fetch is the
// host's own. A share on <id>.<base> is same-site, so SameSite=Lax alone would let its page post here.
const fromHere = (req, env, url) => req.headers.get('origin') === `${url.protocol}//${env.BASE}`

async function meApi(req, env, url, parts) {
  const m = req.method
  if (m !== 'GET' && m !== 'HEAD' && !fromHere(req, env, url)) return fail(403, 'Changes come from prtype.dev/me only.', { code: 'origin' })
  if (parts.length === 1 && parts[0] === 'signout') {
    if (m !== 'POST') return fail(405, 'Method not allowed.')
    return json({ ok: true }, 200, { 'set-cookie': signOutCookie(url) })
  }
  const me = await meOf(req, env, url)
  // The Next.js face (me/, its own Worker) asks who this is before it picks a page: signin says
  // whether "Sign in with GitHub" can work on this host at all.
  if (!me) return fail(401, 'Sign in with GitHub first.', { code: 'signin', signin: signinReady(env) })
  if (parts.length === 1 && parts[0] === 'me') {
    if (m !== 'GET' && m !== 'HEAD') return fail(405, 'Method not allowed.')
    return json({ login: me.login, name: me.name, avatar: me.avatar, state: me.state, base: env.BASE, origin: `${url.protocol}//${env.BASE}` })
  }
  if (!me.ids.length) return fail(404, 'No such share.')
  if (parts[0] === 'shares' && parts.length === 1) {
    if (m !== 'GET') return fail(405, 'Method not allowed.')
    const now = Date.now()
    const list = await sharesOf(env, me.ids)
    const notes = await latestComments(env, me.ids, NOTES)
    // Shaped as the page shows them (days left, who is in it, the words for times), so the Next.js
    // face draws them without a second copy of this logic.
    return json(list.map(s => shape(s, notes.get(s.id) ?? [], now)))
  }
  if (parts[0] === 'shares' && parts.length >= 2 && parts.length <= 3) {
    const id = parts[1]
    if (!isId(id)) return fail(404, 'No such share.')
    if (parts.length === 3) {
      if (parts[2] !== 'card') return fail(404, 'No such route.')
      if (m !== 'GET') return fail(405, 'Method not allowed.')
      return cardOf(env, me.ids, id)
    }
    if (m === 'PATCH') return patchShare(req, env, me.ids, id)
    if (m === 'DELETE') return deleteShare(env, me.ids, id)
    return fail(405, 'Method not allowed.')
  }
  if (parts[0] === 'comments' && parts.length === 2) {
    if (m !== 'PATCH') return fail(405, 'Method not allowed.')
    // /me replies and hides. The status is the Mac's: `sent` means sent to Claude, so it stays there.
    const b = await req.clone().json().catch(() => null)
    if (b && typeof b === 'object' && Object.hasOwn(b, 'status')) return fail(400, 'Send reply or hidden.', { code: 'invalid' })
    return patchComment(req, env, me.ids, parts[1].toLowerCase())
  }
  return fail(404, 'No such route.')
}

// The link's preview card, for its owner: from KV as the share serves it, and for a link that is off
// too (its own origin refuses everyone then). Never cached: it is behind the cookie.
async function cardOf(env, ids, id) {
  const row = await getShare(env, id)
  if (!owns(ids, row) || row.deleted_at || !row.card_key) return fail(404, 'No such card.')
  let bytes = await env.KV.get(row.card_key, 'arrayBuffer')
  if (!bytes) {
    await new Promise(go => setTimeout(go, KV_RETRY_MS))
    bytes = await env.KV.get(row.card_key, 'arrayBuffer')
  }
  if (!bytes) return fail(404, 'No such card.')
  return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
}

// ---------- words ----------

export function agoWords(at, now = Date.now()) {
  const s = Math.max(0, now - at) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86400)
  if (d < 2) return 'yesterday'
  if (d < 14) return `${d} days ago`
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`
  return `${Math.floor(d / 30)} months ago`
}
const daysLeftOf = (exp, now) => exp == null ? null : Math.ceil((exp - now) / DAY_MS)
export const expiryWords = d => d === null ? 'No expiry' : d <= 0 ? 'Expired' : d === 1 ? 'Expires tomorrow' : d <= 7 ? `Expires in ${d} days` : `${d} days left`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const nameOf = a => a?.name || a?.login || 'Someone'
// A face with no picture: its first letter on one of eight tints, the same one for the same login.
const tintOf = s => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 8 }

// ---------- icons (Phosphor, regular weight, 256 viewBox; copied, never drawn) ----------

const P = {
  copy: 'M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z',
  check: 'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z',
  checkBold: 'M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z',
  out: 'M224,104a8,8,0,0,1-16,0V59.32l-66.33,66.34a8,8,0,0,1-11.32-11.32L196.68,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z',
  terminal: 'M128,128a8,8,0,0,1-3,6.25l-40,32a8,8,0,1,1-10-12.5L107.19,128,75,102.25a8,8,0,1,1,10-12.5l40,32A8,8,0,0,1,128,128Zm48,24H136a8,8,0,0,0,0,16h40a8,8,0,0,0,0-16Zm56-96V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56ZM216,200V56H40V200H216Z',
  reply: 'M232,200a8,8,0,0,1-16,0,88.1,88.1,0,0,0-88-88H51.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,85.66,61.66L51.31,96H128A104.11,104.11,0,0,1,232,200Z',
  eyeSlash: 'M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l22,24.21a8,8,0,1,0,11.84-10.76Zm47.33,75.84,41.67,45.85a32,32,0,0,1-41.67-45.85ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l18,19.75a48,48,0,0,0,63.66,70l14.73,16.2A112,112,0,0,1,128,192Zm6-95.43a8,8,0,0,1,3-15.72,48.16,48.16,0,0,1,38.77,42.64,8,8,0,0,1-7.22,8.71,6.39,6.39,0,0,1-.75,0,8,8,0,0,1-8-7.26A32.09,32.09,0,0,0,134,96.57Zm113.28,34.69c-.42.94-10.55,23.37-33.36,43.8a8,8,0,1,1-10.67-11.92A132.77,132.77,0,0,0,231.05,128a133.15,133.15,0,0,0-23.12-30.77C185.67,75.19,158.78,64,128,64a118.37,118.37,0,0,0-19.36,1.57A8,8,0,1,1,106,49.79,134,134,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z',
  eye: 'M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z',
  chat: 'M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z',
  left: 'M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z',
  right: 'M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z',
  power: 'M120,128V48a8,8,0,0,1,16,0v80a8,8,0,0,1-16,0Zm60.37-78.7a8,8,0,0,0-8.74,13.4C194.74,77.77,208,101.57,208,128a80,80,0,0,1-160,0c0-26.43,13.26-50.23,36.37-65.3a8,8,0,0,0-8.74-13.4C47.9,67.38,32,96.06,32,128a96,96,0,0,0,192,0C224,96.06,208.1,67.38,180.37,49.3Z',
  trash: 'M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z',
  signOut: 'M120,216a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V40a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H56V208h56A8,8,0,0,1,120,216Zm109.66-93.66-40-40a8,8,0,0,0-11.32,11.32L204.69,120H112a8,8,0,0,0,0,16h92.69l-26.35,26.34a8,8,0,0,0,11.32,11.32l40-40A8,8,0,0,0,229.66,122.34Z',
  'github-fill': 'M216,104v8a56.06,56.06,0,0,1-48.44,55.47A39.8,39.8,0,0,1,176,192v40a8,8,0,0,1-8,8H104a8,8,0,0,1-8-8V216H72a40,40,0,0,1-40-40A24,24,0,0,0,8,152a8,8,0,0,1,0-16,40,40,0,0,1,40,40,24,24,0,0,0,24,24H96v-8a39.8,39.8,0,0,1,8.44-24.53A56.06,56.06,0,0,1,56,112v-8a58.14,58.14,0,0,1,7.69-28.32A59.78,59.78,0,0,1,69.07,28,8,8,0,0,1,76,24a59.75,59.75,0,0,1,48,24h24a59.75,59.75,0,0,1,48-24,8,8,0,0,1,6.93,4,59.74,59.74,0,0,1,5.37,47.68A58,58,0,0,1,216,104Z',
  'warning-fill': 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-8,56a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm8,104a12,12,0,1,1,12-12A12,12,0,0,1,128,184Z',
  lock: 'M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Z',
  github: 'M208.31,75.68A59.78,59.78,0,0,0,202.93,28,8,8,0,0,0,196,24a59.75,59.75,0,0,0-48,24H124A59.75,59.75,0,0,0,76,24a8,8,0,0,0-6.93,4,59.78,59.78,0,0,0-5.38,47.68A58.14,58.14,0,0,0,56,104v8a56.06,56.06,0,0,0,48.44,55.47A39.8,39.8,0,0,0,96,192v8H72a24,24,0,0,1-24-24A40,40,0,0,0,8,136a8,8,0,0,0,0,16,24,24,0,0,1,24,24,40,40,0,0,0,40,40H96v16a8,8,0,0,0,16,0V192a24,24,0,0,1,48,0v40a8,8,0,0,0,16,0V192a39.8,39.8,0,0,0-8.44-24.53A56.06,56.06,0,0,0,216,112v-8A58.14,58.14,0,0,0,208.31,75.68ZM200,112a40,40,0,0,1-40,40H112a40,40,0,0,1-40-40v-8a41.74,41.74,0,0,1,6.9-22.48A8,8,0,0,0,80,73.83a43.81,43.81,0,0,1,.79-33.58,43.88,43.88,0,0,1,32.32,20.06A8,8,0,0,0,119.82,64h32.35a8,8,0,0,0,6.74-3.69,43.87,43.87,0,0,1,32.32-20.06A43.81,43.81,0,0,1,192,73.83a8.09,8.09,0,0,0,1,7.65A41.72,41.72,0,0,1,200,104Z',
}
const icon = (name, size = 18, cls = '') => `<svg class="i ${cls}" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${P[name]}"/></svg>`

// The Prototype mark (site/src/components/logo.tsx, path for path): five cubes, the picked one purple.
const CUBES = [
  ['M441.69 526.76L569.53 600.57L441.69 674.38L313.85 600.57Z', 'M313.85 748.19L441.69 822L441.69 674.38L313.85 600.57Z', 'M569.53 748.19L441.69 822L441.69 674.38L569.53 600.57Z'],
  ['M441.69 364.38L569.53 438.19L441.69 512L313.85 438.19Z', 'M313.85 585.81L441.69 659.62L441.69 512L313.85 438.19Z', 'M569.53 585.81L441.69 659.62L441.69 512L569.53 438.19Z'],
  ['M441.69 202L569.53 275.81L441.69 349.62L313.85 275.81Z', 'M313.85 423.43L441.69 497.24L441.69 349.62L313.85 275.81Z', 'M569.53 423.43L441.69 497.24L441.69 349.62L569.53 275.81Z'],
  ['M582.31 445.57L710.15 519.38L582.31 593.19L454.47 519.38Z', 'M454.47 667L582.31 740.81L582.31 593.19L454.47 519.38Z', 'M710.15 667L582.31 740.81L582.31 593.19L710.15 519.38Z'],
  ['M582.31 283.19L710.15 357L582.31 430.81L454.47 357Z', 'M454.47 504.62L582.31 578.43L582.31 430.81L454.47 357Z', 'M710.15 504.62L582.31 578.43L582.31 430.81L710.15 357Z'],
]
function logo({ tile = false, cls = '' } = {}) {
  const fills = i => i === 4 ? ['#c4c1fc', '#7f7af4', '#5a53e3'] : ['#ffffff', '#e6e4fc', '#c9c6f5']
  const cubes = CUBES.map((c, i) => `<g>${c.map((d, k) => `<path d="${d}" fill="${fills(i)[k]}"/>`).join('')}</g>`).join('')
  const bg = tile ? '<defs><linearGradient id="pl-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d68f0"/><stop offset="1" stop-color="#312ab8"/></linearGradient></defs><rect width="1024" height="1024" rx="229" fill="url(#pl-bg)"/><rect x="4" y="4" width="1016" height="1016" rx="225" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="8"/>' : ''
  return `<svg class="${cls}" viewBox="0 0 1024 1024" aria-hidden="true">${bg}${cubes}</svg>`
}

// ---------- the page ----------

const FONTS = 'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400..700&family=Google+Sans+Code:wght@400..500&display=swap'

const csp = nonce => [
  "default-src 'none'",
  `script-src 'nonce-${nonce}'`,
  `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
].join('; ')

function shell({ title, body, extraCss = '', script = '', bodyClass = '' }, status = 200, nonce = b64url(crypto.getRandomValues(new Uint8Array(16)))) {
  const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style nonce="${nonce}">${CSS}${extraCss}</style></head>
<body class="${bodyClass}">${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': csp(nonce),
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  })
}

const quiet = (head, text, action = '') => `<main class="quiet"><div class="quiet-box">${logo({ tile: true, cls: 'quiet-logo' })}<h1>${esc(head)}</h1><p>${text ? esc(text) : ''}</p>${action}</div></main>`


// Signed out: the link card's own picture (its deep-night glow, the five cubes large in it), the one
// way in, and what GitHub shares. The prototype's pick, me-login #4 Deep night.
function signedOut(env, url) {
  if (!signinReady(env)) return shell({ title: 'Your links', body: quiet('Sign-in isn\'t set up on this host', 'Your links are on prtype.dev/me.') })
  const failed = url.searchParams.has('failed')
  const body = `<div class="night-glow" aria-hidden="true"></div>
<main class="night">
<h1>Every link you shared,<br>in one place</h1>
<p class="night-lede">From every project and Mac. See who opened them, read the comments, turn them off, from any browser.</p>
<div class="night-act">
${failed ? `<p class="night-failed" role="alert">${icon('warning-fill', 16)}Sign-in didn’t finish. Try again.</p>` : ''}
<a class="night-gh" href="/auth/github?me=1">${icon('github-fill', 20)}${failed ? 'Try again with GitHub' : 'Sign in with GitHub'}</a>
<p class="night-privacy">${icon('lock', 13)}GitHub shares only your name, login and picture. Nothing is posted.</p>
</div>
<div class="night-mark" aria-hidden="true"><div class="night-halo"></div>${logo({ cls: 'night-cubes' })}</div>
</main>`
  return shell({ title: 'Your links', body, bodyClass: 'is-night', extraCss: NIGHT_CSS })
}

const NIGHT_CSS = `html:has(body.is-night){background:#121019}
body.is-night{position:relative;isolation:isolate;overflow-x:hidden;color:#fff;background:radial-gradient(120% 80% at 50% 120%,#4a42d4 0%,#1c1830 45%,#121019 75%) #121019}
.night-glow{position:absolute;inset:auto 0 0 0;height:60%;z-index:-1;background:radial-gradient(50% 60% at 50% 100%,rgba(109,104,240,.35),transparent 70%)}
.night{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:clamp(56px,14vh,140px) 16px 0}
.night h1{font-size:32px;line-height:1.1;font-weight:600;letter-spacing:-.03em;text-wrap:balance}
@media(min-width:640px){.night h1{font-size:44px}}
.night-lede{margin-top:16px;max-width:40ch;font-size:15px;line-height:1.55;color:rgba(255,255,255,.7);text-wrap:balance}
.night-act{margin-top:32px;display:flex;flex-direction:column;align-items:center}
.night-failed{margin-bottom:12px;display:flex;align-items:center;gap:6px;font-size:13.5px;color:#ffb4b4}
.night-gh{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:48px;padding:0 24px;border-radius:999px;background:#fff;color:#121019;font-size:15px;font-weight:600;box-shadow:0 0 0 1px rgba(255,255,255,.2),0 10px 40px -8px rgba(109,104,240,.75);transition:transform .15s,background-color .15s}
.night-gh:hover{background:#f3f2fe}
.night-gh:active{transform:scale(.98)}
.night-gh:focus-visible{outline:2px solid #b9b5ff;outline-offset:3px}
.night-privacy{margin-top:16px;max-width:34ch;font-size:12.5px;line-height:1.5;color:rgba(255,255,255,.45);text-wrap:balance}
@media(min-width:640px){.night-privacy{max-width:none}}
.night-privacy .i{display:inline;margin-right:4px;vertical-align:middle;transform:translateY(-1px)}
.night-mark{position:relative;margin-top:auto;width:100%;display:flex;justify-content:center;padding-top:40px}
.night-halo{position:absolute;bottom:8%;left:50%;height:70%;width:min(520px,90%);transform:translateX(-50%);border-radius:999px;background:rgba(109,104,240,.4);filter:blur(60px)}
.night-cubes{position:relative;height:clamp(140px,26vh,260px);width:auto;aspect-ratio:1;margin-bottom:clamp(24px,5vh,56px);filter:drop-shadow(0 20px 50px rgba(90,83,227,.55))}
@media(prefers-reduced-motion:reduce){.night-gh{transition:none}}`

function avatarHtml(who, size, cls = '') {
  const label = esc(nameOf(who))
  if (who?.avatar && /^https:\/\/avatars\.githubusercontent\.com\//.test(who.avatar)) return `<img class="av s${size} ${cls}" src="${esc(who.avatar)}" alt="" title="${label}" width="${size}" height="${size}" referrerpolicy="no-referrer">`
  return `<span class="av s${size} t${tintOf(who?.login || who?.name)} ${cls}" title="${label}" aria-hidden="true">${esc(nameOf(who).slice(0, 1).toUpperCase())}</span>`
}

function header(me) {
  return `<header class="top"><a class="brand" href="/">${logo({ tile: true, cls: 'brand-logo' })}Prototype</a>
<span class="who"><span class="login">@${esc(me.login)}</span>
<span class="menu-wrap"><button type="button" class="avatar-btn" data-act="menu" aria-haspopup="menu" aria-expanded="false" aria-label="Account">${me.avatar ? avatarHtml({ avatar: me.avatar, name: me.name, login: me.login }, 28) : `<span class="av s28 me-av" aria-hidden="true">${esc((me.name || me.login || '?').slice(0, 1).toUpperCase())}</span>`}</button>
<span class="menu" role="menu" hidden><button type="button" role="menuitem" data-act="signout">${icon('signOut', 16)}Sign out</button></span></span></span></header>`
}

async function mePage(req, env, url) {
  const me = await meOf(req, env, url)
  if (!me) return signedOut(env, url)
  if (me.state !== 'owner') {
    const [head, text] = me.state === 'banned' ? [`@${me.login} can't share here`, 'This account was blocked on this host.']
      : me.state === 'pending' ? [`No links for @${me.login} yet`, 'Sharing opens once the maintainer approves your account.']
        : [`No links for @${me.login} yet`, 'Share a prototype from the Share button on its page, and it shows up here.']
    return shell({ title: 'Your links', body: header(me) + quiet(head, text), script: clientJs() })
  }
  const now = Date.now()
  const [list, notes] = [await sharesOf(env, me.ids), await latestComments(env, me.ids, NOTES)]
  const origin = `${url.protocol}//${env.BASE}`
  const ctx = { origin, base: env.BASE, now, owner: me }
  const links = list.map(s => shape(s, notes.get(s.id) ?? [], now))
  const fresh = links.reduce((n, l) => n + l.comments.new, 0)
  const soon = links.filter(l => !l.off && l.daysLeft !== null && l.daysLeft > 0 && l.daysLeft <= 7).length
  // The days-left bars: one rule each in the page's own (nonce'd) style, since style="" is refused.
  const extraCss = links.map(l => l.daysLeft === null ? '' : `#trk-${l.id}{width:${Math.max(3, Math.min(100, (Math.max(0, l.daysLeft) / 30) * 100)).toFixed(1)}%}`).join('')
  const summary = `<span data-count>${plural(links.length, 'link')}</span> from every project and Mac<span class="fresh" data-fresh${fresh ? '' : ' hidden'}>, <span data-fresh-n>${fresh}</span> new comments</span>${soon ? `, ${soon} expire this week` : ''}`
  const body = `${header(me)}
<div class="panes" data-origin="${esc(origin)}" data-base="${esc(env.BASE)}">
<aside class="list"><div class="list-head"><h2>Your links</h2><p class="summary">${summary}</p></div>
<ul class="rows">${links.map((l, i) => row(l, i === 0)).join('')}</ul></aside>
<main class="room-pane">${links.map((l, i) => room(l, ctx, i === 0)).join('')}
<div class="empty"${links.length ? ' hidden' : ''}>No live links. Share a prototype from the Share button on its page, and it shows up here.</div></main>
</div><div class="toast" role="status" aria-live="polite" hidden></div>`
  return shell({ title: 'Your links', body, extraCss, script: clientJs() })
}

function shape(s, notes, now) {
  const viewers = s.viewers || []
  const nowFace = viewers.find(v => v.at > now - NOW_MS) || null
  const daysLeft = daysLeftOf(s.expiresAt, now)
  return {
    ...s, notes: notes.map(n => ({ ...n, ago: agoWords(n.created_at, now) })), off: s.disabled,
    daysLeft,
    now: nowFace,
    last: viewers[0] || null,
    latest: notes[0]?.created_at ?? 0,
    // Words, as of this answer: the list's expiry, "updated …", "looked last, …", the exact date.
    words: {
      expiry: expiryWords(daysLeft),
      updated: agoWords(s.updatedAt, now),
      last: viewers[0] ? agoWords(viewers[0].at, now) : null,
      exact: s.expiresAt ? new Date(s.expiresAt).toUTCString().slice(0, 16) : '',
    },
  }
}

function row(l, active) {
  const d = l.daysLeft
  const soon = d !== null && d <= 7
  return `<li data-row="${l.id}"${l.off ? ' data-off' : ''}><button type="button" class="row" data-act="pick" data-id="${l.id}"${active ? ' aria-current="true"' : ''} data-shoot="row-${l.id}">
<span class="row-main"><span class="row-title"><span class="t">${esc(l.title)}</span><span class="pill-off">Off</span></span>
<span class="row-project mono">${esc(l.project || 'No project')}</span>
<span class="row-meta"><span class="ic">${icon('eye', 13)}${l.views}</span><span class="ic">${icon('chat', 13)}${l.comments.total}</span>
${l.now ? `<span class="in-now on-only"><span class="dot"></span>${esc(nameOf(l.now))} is in it</span>` : `<span class="on-only${soon ? ' amber' : ''}">${esc(expiryWords(d))}</span>`}<span class="off-only">Turned off</span></span></span>
<span class="badge" data-badge${l.comments.new ? '' : ' hidden'} aria-label="${l.comments.new} new comments" data-latest="${l.latest}">${l.comments.new}</span>
${icon('right', 16, 'chev')}</button></li>`
}

function room(l, ctx, active) {
  const link = `${ctx.origin}/${l.id}`
  const d = l.daysLeft
  const soon = d !== null && d <= 7
  const exact = l.expiresAt ? new Date(l.expiresAt).toUTCString().slice(0, 16) : ''
  const editCmd = `/prototype edit ${link}`
  const message = l.message || ''
  const by = ctx.owner.name || ctx.owner.login
  const numbers = `<p><b>${l.views}</b> views, <b>${l.comments.total}</b> comments<span class="new-words" data-new-words${l.comments.new ? '' : ' hidden'}>, <span data-new-n>${l.comments.new}</span> new</span>.</p>
<p class="who-line">${l.now ? `${avatarHtml(l.now, 20)}<span class="green on-only">${esc(nameOf(l.now))} is in it now.</span><span class="off-only">${esc(nameOf(l.now))} looked last, just now.</span>`
    : l.last ? `${avatarHtml(l.last, 20)}<span>${esc(nameOf(l.last))} looked last, ${esc(agoWords(l.last.at, ctx.now))}.</span>`
      : '<span>Nobody has opened it yet.</span>'}</p>
${d === null ? '<p class="note">No expiry. An update from the Mac gives it 30 days.</p>' : `<div class="track-wrap"><div class="track${soon ? ' soon' : ''}" data-shoot="track" title="${esc(exact)}"><div class="bar"><div class="fill" id="trk-${l.id}"></div></div><span class="days">${d <= 0 ? 'Expired' : d === 1 ? '1 day' : `${d} days`}</span></div>
<p class="note"><span class="on-only">${soon ? `${esc(expiryWords(d))}. An update from the Mac gives it 30 more.` : 'An update from the Mac gives it 30 more days.'}</span><span class="off-only">Turned off. The page and its comments are kept.</span></p></div>`}`
  const cardImg = l.card ? `<img class="card-img" src="/me/api/shares/${l.id}/card" alt="" loading="lazy">` : `<div class="card-bg"></div>${logo({ cls: 'card-logo' })}`
  return `<article class="room" data-room="${l.id}"${l.off ? ' data-off' : ''}${active ? '' : ' hidden'} data-saved="${esc(message)}" data-total="${l.comments.total}">
<button type="button" class="back" data-act="back" data-shoot="back">${icon('left', 16)}Your links</button>
<p class="crumbs"><span class="mono">${esc(l.project || 'No project')}</span> · v${l.version}${l.designs ? ` · ${plural(l.designs, 'design')}` : ''} · updated ${esc(agoWords(l.updatedAt, ctx.now))}</p>
<h1>${esc(l.title)}</h1>
<div class="address" data-shoot="address"><p class="addr mono"><span class="host">${esc(ctx.base)}/</span><span class="id">${l.id}</span></p>
<span class="tools"><button type="button" class="icon-btn" data-act="copy-link" data-text="${esc(link)}" aria-label="Copy the link" title="Copy the link">${icon('copy', 18, 'idle')}${icon('checkBold', 18, 'done')}</button>
<a class="icon-btn" href="${esc(link)}" target="_blank" rel="noreferrer" aria-label="Open the link" title="Open the link">${icon('out')}</a>
<button type="button" class="icon-btn" data-act="edit" data-shoot="edit" aria-label="Edit on your Mac" title="Edit on your Mac" aria-expanded="false">${icon('terminal')}</button>
<div class="pop" role="dialog" aria-label="Edit on your Mac" hidden><p class="pop-title">Edit on your Mac</p>
<p class="pop-text">The designs live on the Mac you shared from. Paste this into Claude Code there, then update the link.</p>
<div class="cmd"><code class="mono">${esc(editCmd)}</code><button type="button" class="cmd-copy" data-act="copy-cmd" data-text="${esc(editCmd)}" aria-label="Copy the command" title="Copy the command">${icon('copy', 16, 'idle')}${icon('check', 16, 'done')}</button></div>
<p class="pop-done" aria-live="polite"></p></div></span></div>
<div class="glance"><figure class="card" aria-label="How the link looks when pasted"><div class="card-pic">${cardImg}<span class="card-off off-only">Turned off</span></div>
<figcaption><span class="cap"><span class="cap-host mono">${esc(ctx.base)}</span><span class="cap-title">${esc(l.title)}</span><span class="cap-msg" data-cap-msg data-fallback="${esc(`A prototype shared by ${by}`)}">${esc(message || `A prototype shared by ${by}`)}</span></span>${avatarHtml({ avatar: ctx.owner.avatar, name: ctx.owner.name, login: ctx.owner.login }, 24)}</figcaption></figure>
<div class="numbers">${numbers}</div></div>
<div class="sections">
<section class="msg"><h2 id="msg-${l.id}">Message for viewers</h2><p class="sub">Shown above the designs when someone opens the link.</p>
<textarea class="field" data-shoot="message" rows="2" maxlength="${MAX_MESSAGE}" placeholder="What should viewers look at first?" aria-labelledby="msg-${l.id}">${esc(message)}</textarea>
<div class="msg-row"><span class="counter"><span data-n>${message.length}</span>/${MAX_MESSAGE}</span><span class="saved" hidden>${icon('check', 14)}Saved</span>
<span class="msg-btns"><button type="button" class="btn-ghost" data-act="msg-cancel" hidden>Cancel</button><button type="button" class="btn-primary sm" data-act="msg-save" data-shoot="save" disabled>Save</button></span></div></section>
<section class="comments"><h2>Comments <span class="dim">${l.comments.total}<span data-new-words${l.comments.new ? '' : ' hidden'}>, <span data-new-n>${l.comments.new}</span> new</span></span></h2>
${l.notes.length ? `<ul class="notes">${l.notes.map(n => note(n, l, ctx)).join('')}</ul>` : '<p class="none">No comments yet. Viewers can leave one on any design.</p>'}
${l.comments.total > l.notes.length ? `<p class="more">The latest ${l.notes.length}. Open the link to see all ${l.comments.total} on their designs.</p>` : ''}</section>
<footer class="foot"><button type="button" class="btn-line" data-act="toggle" data-shoot="off">${icon('power', 16)}<span class="on-only">Turn off</span><span class="off-only">Turn on</span></button>
<button type="button" class="btn-remove" data-act="ask" data-shoot="remove">${icon('trash', 16)}Remove</button>
<span class="confirm" data-shoot="confirm" hidden><span class="confirm-q">${l.comments.total ? `Remove it and its ${plural(l.comments.total, 'comment')} for good?` : 'Remove it for good?'}</span><button type="button" class="btn-danger" data-act="remove">Remove</button><button type="button" class="btn-ghost h36" data-act="keep">Keep it</button></span>
<p class="foot-note"><span class="on-only">Turn off stops viewers and keeps everything. Remove deletes the page and its comments.</span><span class="off-only">Viewers see “This link is turned off”. Turn it on and it is back as it was.</span></p></footer>
</div></article>`
}

function note(n, l, ctx) {
  const who = n.author
  const name = nameOf(who)
  const at = `${ctx.origin}/${l.id}${n.variant ? `#/${n.variant}` : ''}`
  return `<li class="note-item" data-comment="${esc(n.id)}" data-share="${l.id}"${n.hidden ? ' data-hidden' : ''} data-at="${n.created_at}"${n.status === 'new' ? ' data-new' : ''}>
<div class="hid-row">${icon('eyeSlash', 16)}<span>Hidden from viewers: ${esc(name)}</span><button type="button" class="btn-link" data-act="show">Show again</button></div>
<div class="shown">${avatarHtml(who, 30)}<div class="note-body"><p class="note-head"><span class="note-name">${esc(name)}</span><span>${esc(agoWords(n.created_at, ctx.now))}</span>${n.status === 'new' ? '<span class="pill-new">New</span>' : ''}</p>
<p class="note-text">${esc(n.body)}</p>
<p class="reply-line"${n.owner_reply ? '' : ' hidden'}><span class="you">You</span><span data-reply>${esc(n.owner_reply || '')}</span></p>
<form class="reply-form" hidden><textarea class="field" rows="2" maxlength="4000" placeholder="Reply to ${esc(name)}" aria-label="Reply to ${esc(name)}"></textarea>
<div class="reply-btns"><button type="button" class="btn-ghost" data-act="reply-cancel">Cancel</button><button type="submit" class="btn-primary sm" disabled>Reply</button></div></form>
<div class="acts"><button type="button" class="act" data-act="reply" aria-label="Reply to ${esc(name)}" title="Reply"${n.owner_reply ? ' hidden' : ''}>${icon('reply', 17)}</button>
<button type="button" class="act" data-act="hide" aria-label="Hide from viewers" title="Hide from viewers">${icon('eyeSlash', 17)}</button>
<a class="act" href="${esc(at)}" target="_blank" rel="noreferrer" data-shoot="see-in-design" aria-label="See it in the design" title="See it in the design">${icon('out', 17)}</a></div></div></div></li>`
}

// ---------- the page's script: runs in the browser, as its source (no closure over this module) ----------

/* eslint-disable no-undef */
// The page's script is client()'s own source. The deploy's bundler (esbuild, keep_names) wraps the
// functions in it in __name(fn, "name"), a helper that exists only in the Worker: the page defines a
// stand-in first, or the script stops at its first line in the browser.
const clientJs = () => `(() => { const __name = f => f; (${client.toString()})() })()`

function client() {
  const $ = (s, el = document) => el.querySelector(s)
  const $$ = (s, el = document) => [...el.querySelectorAll(s)]
  const panes = $('.panes')
  const toast = $('.toast')
  let toastTimer = 0
  const say = text => { if (!toast) return; toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true }, 2600) }
  const send = async (method, path, body) => {
    const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
    if (r.status === 401) { location.href = '/me'; throw new Error('signed out') }
    if (!r.ok) throw new Error(String(r.status))
    return r.json().catch(() => ({}))
  }
  const failed = () => say('That didn’t go through. Try again.')

  // The account menu: Sign out.
  const menuBtn = $('[data-act=menu]'), menu = $('.menu')
  const closeMenu = () => { if (menu) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false') } }

  // Read: a link's room marks its comments read here (the Mac's status stays the Mac's). What was
  // read is kept in this browser, by the newest comment seen on each link.
  const KEY = 'proto-me-read'
  let read = {}
  try { read = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { read = {} }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(read)) } catch { /* private window: this visit only */ } }
  const setNew = (id, n) => {
    const r = $(`[data-row="${id}"]`), room = $(`[data-room="${id}"]`)
    const b = r && $('[data-badge]', r)
    if (b) { b.textContent = String(n); b.hidden = !n; b.dataset.n = String(n) }
    if (room) for (const w of $$('[data-new-words]', room)) { w.hidden = !n; const x = $('[data-new-n]', w); if (x) x.textContent = String(n) }
    let total = 0
    for (const x of $$('[data-badge]')) total += Number(x.dataset.n ?? x.textContent) || 0
    const f = $('[data-fresh]')
    if (f) { f.hidden = !total; $('[data-fresh-n]', f).textContent = String(total) }
  }
  for (const b of $$('[data-badge]')) {
    const id = b.closest('[data-row]').dataset.row
    b.dataset.n = b.textContent.trim()
    const latest = Number(b.dataset.latest) || 0
    if (latest && (read[id] || 0) >= latest) setNew(id, 0)
    const room = $(`[data-room="${id}"]`)
    if (room) for (const n of $$('[data-new]', room)) if (Number(n.dataset.at) <= (read[id] || 0)) { const p = $('.pill-new', n); if (p) p.remove() }
  }
  let readTimer = 0
  const markRead = id => {
    clearTimeout(readTimer)
    readTimer = setTimeout(() => {
      const b = $(`[data-row="${id}"] [data-badge]`)
      const latest = Number(b?.dataset.latest) || 0
      if (latest) { read[id] = Math.max(read[id] || 0, latest); keep() }
      setNew(id, 0)
    }, 1200)
  }

  // Choosing a link: its room on the right; on a phone, the room alone with a way back.
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const pick = (id, { open = true, focus = false } = {}) => {
    const room = $(`[data-room="${id}"]`)
    if (!room) return
    for (const r of $$('[data-room]')) r.hidden = r !== room
    for (const b of $$('.row')) { if (b.dataset.id === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current') }
    closePops()
    if (open) document.body.classList.add('open')
    if (!reduce) room.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' })
    if (document.body.classList.contains('open') && matchMedia('(max-width: 767px)').matches) scrollTo(0, 0)
    try { history.replaceState(null, '', `#${id}`) } catch { /* fine */ }
    if (focus) $('h1', room)?.focus?.()
    markRead(id)
  }
  // A link named in the address opens (and is read); else the first is shown, unread until picked,
  // and on a phone the list comes first.
  const wanted = location.hash.slice(1)
  if (wanted && $(`[data-room="${wanted}"]`)) pick(wanted, { open: true })

  // Copying, with a check for a moment.
  const copied = (btn, ms = 1600) => { btn.classList.add('is-done'); const t = btn.title; if (btn.dataset.act === 'copy-link') btn.title = 'Copied'; setTimeout(() => { btn.classList.remove('is-done'); btn.title = t }, ms) }
  const copy = (btn, text) => {
    const ok = () => {
      copied(btn)
      if (btn.dataset.act === 'copy-cmd') { const p = btn.closest('.pop').querySelector('.pop-done'); p.textContent = 'Copied. Paste it into Claude Code.'; setTimeout(() => { p.textContent = '' }, 1600) }
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, ok)
    else ok()
  }

  // The Edit popover: below the button, its end edge on the button's, kept inside the window.
  const closePops = () => { for (const p of $$('.pop')) if (!p.hidden) { p.hidden = true; p.parentElement.querySelector('[data-act=edit]').setAttribute('aria-expanded', 'false') } }
  const place = (btn, pop) => {
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth
    const left = Math.max(12, Math.min(r.right - w, innerWidth - 12 - w))
    pop.style.left = `${left}px`
    pop.style.top = `${r.bottom + 8}px`
  }
  addEventListener('resize', () => { for (const p of $$('.pop')) if (!p.hidden) place(p.parentElement.querySelector('[data-act=edit]'), p) })
  addEventListener('scroll', () => { for (const p of $$('.pop')) if (!p.hidden) place(p.parentElement.querySelector('[data-act=edit]'), p) }, { passive: true })

  // The message for viewers.
  const msgState = room => {
    const ta = $('.msg textarea', room), saved = room.dataset.saved || ''
    const n = ta.value.length
    const c = $('.counter', room)
    $('[data-n]', c).textContent = String(n)
    c.classList.toggle('amber', n > 260)
    const changed = ta.value.trim() !== saved
    $('[data-act=msg-cancel]', room).hidden = !changed
    $('[data-act=msg-save]', room).disabled = !changed
    if (changed) $('.saved', room).hidden = true
  }
  document.addEventListener('input', e => {
    const ta = e.target
    if (!(ta instanceof HTMLTextAreaElement)) return
    const room = ta.closest('[data-room]')
    if (ta.closest('.msg')) msgState(room)
    const form = ta.closest('.reply-form')
    if (form) form.querySelector('[type=submit]').disabled = !ta.value.trim()
  })

  document.addEventListener('submit', async e => {
    const form = e.target.closest('.reply-form')
    if (!form) return
    e.preventDefault()
    const li = form.closest('[data-comment]'), ta = $('textarea', form), text = ta.value.trim()
    if (!text) return
    const btn = $('[type=submit]', form)
    btn.disabled = true
    try {
      await send('PATCH', `/me/api/comments/${li.dataset.comment}`, { share: li.dataset.share, reply: text })
      const line = $('.reply-line', li)
      $('[data-reply]', line).textContent = text
      line.hidden = false
      form.hidden = true
      $('.acts', li).hidden = false
      $('[data-act=reply]', li).hidden = true
      ta.value = ''
    } catch { failed(); btn.disabled = false }
  })

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    closePops(); closeMenu()
  })

  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-act]')
    if (!e.target.closest('.pop') && !(t && t.dataset.act === 'edit')) closePops()
    if (!e.target.closest('.menu-wrap')) closeMenu()
    if (!t) return
    const act = t.dataset.act
    const room = t.closest('[data-room]'), id = room?.dataset.room
    const li = t.closest('[data-comment]')
    if (act === 'menu') { const open = menu.hidden; menu.hidden = !open; t.setAttribute('aria-expanded', String(open)); return }
    if (act === 'signout') { try { await send('POST', '/me/api/signout') } catch { /* gone anyway */ } location.href = '/me'; return }
    if (act === 'pick') return pick(t.dataset.id)
    if (act === 'back') { document.body.classList.remove('open'); try { history.replaceState(null, '', location.pathname) } catch { /* fine */ } return }
    if (act === 'copy-link' || act === 'copy-cmd') return copy(t, t.dataset.text)
    if (act === 'edit') {
      const pop = t.parentElement.querySelector('.pop')
      const open = pop.hidden
      closePops()
      if (open) { pop.hidden = false; t.setAttribute('aria-expanded', 'true'); place(t, pop); if (!reduce) pop.animate([{ opacity: 0, transform: 'scale(.95)' }, { opacity: 1, transform: 'none' }], { duration: 150, easing: 'ease-out' }) }
      return
    }
    if (act === 'msg-cancel') { $('.msg textarea', room).value = room.dataset.saved || ''; msgState(room); return }
    if (act === 'msg-save') {
      const ta = $('.msg textarea', room), text = ta.value.trim()
      t.disabled = true
      try {
        const r = await send('PATCH', `/me/api/shares/${id}`, { message: text || null })
        room.dataset.saved = r.message || ''
        ta.value = r.message || ''
        const cap = $('[data-cap-msg]', room)
        cap.textContent = r.message || cap.dataset.fallback
        msgState(room)
        $('.saved', room).hidden = false
      } catch { failed(); msgState(room) }
      return
    }
    if (act === 'reply') { const f = $('.reply-form', li); f.hidden = false; $('.acts', li).hidden = true; $('textarea', f).focus(); return }
    if (act === 'reply-cancel') { const f = $('.reply-form', li); f.hidden = true; $('textarea', f).value = ''; $('.acts', li).hidden = false; return }
    if (act === 'hide' || act === 'show') {
      const hidden = act === 'hide'
      try { await send('PATCH', `/me/api/comments/${li.dataset.comment}`, { share: li.dataset.share, hidden }); li.toggleAttribute('data-hidden', hidden) } catch { failed() }
      return
    }
    if (act === 'toggle') {
      const off = !room.hasAttribute('data-off')
      t.disabled = true
      try {
        await send('PATCH', `/me/api/shares/${id}`, { disabled: off })
        room.toggleAttribute('data-off', off)
        $(`[data-row="${id}"]`).toggleAttribute('data-off', off)
      } catch { failed() }
      t.disabled = false
      return
    }
    if (act === 'ask') { t.hidden = true; const c = $('.confirm', room); c.hidden = false; $('[data-act=remove]', c).focus(); return }
    if (act === 'keep') { $('.confirm', room).hidden = true; $('[data-act=ask]', room).hidden = false; return }
    if (act === 'remove') {
      t.disabled = true
      try {
        await send('DELETE', `/me/api/shares/${id}`)
        const rows = $$('[data-row]'), i = rows.findIndex(r => r.dataset.row === id)
        rows[i]?.remove()
        room.remove()
        const rest = $$('[data-row]')
        const c = $('[data-count]')
        if (c) c.textContent = `${rest.length} ${rest.length === 1 ? 'link' : 'links'}`
        setNew('', 0)
        document.body.classList.remove('open')
        const next = rest[Math.min(i, rest.length - 1)]
        if (next) pick(next.dataset.row, { open: false })
        else $('.empty').hidden = false
      } catch { failed(); t.disabled = false }
    }
  })
  if (panes) panes.dataset.ready = '1'
}

// ---------- the styles: D's Tailwind values, by hand ----------

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{color-scheme:light;--ink:#121019;--ink2:#4a4760;--dim:#5b5870;--faint:#9b98b0;--brand:#5a53e3;--line:#e6e4fc;--soft:#efedfb;--tint:#f3f2fe;--page:#fbfbfe;--amber:#b4541a;--amber2:#e0832f;--green:#0f7a5f;
--sans:'Google Sans',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;--mono:'Google Sans Code',ui-monospace,'SF Mono',Menlo,Consolas,monospace}
html,body{margin:0;background:var(--page)}
body{min-height:100vh;display:flex;flex-direction:column;font:13px/1.5 var(--sans);color:var(--ink);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
[hidden]{display:none!important}
button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer}
button:disabled{cursor:default}
a{color:inherit;text-decoration:none}
h1,h2,p,ul,figure{margin:0;padding:0}
ul{list-style:none}
.mono{font-family:var(--mono)}
.i{display:block;flex-shrink:0}
.top{height:56px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--soft);background:#fff;padding:0 16px}
@media(min-width:640px){.top{padding:0 20px}}
.brand{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;letter-spacing:-.01em}
.brand-logo{width:28px;height:28px}
.who{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2)}
@media(max-width:639px){.login{display:none}}
.menu-wrap{position:relative;display:flex}
.avatar-btn{display:flex;border-radius:999px}
.menu{position:absolute;right:0;top:calc(100% + 8px);z-index:60;min-width:160px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:4px;box-shadow:0 12px 40px -8px rgba(18,16,25,.18)}
.menu button{display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:0 10px;border-radius:8px;font-size:13px;color:var(--ink2)}
.menu button:hover{background:var(--tint);color:var(--ink)}
.av{display:inline-grid;place-items:center;flex-shrink:0;border-radius:999px;color:#fff;font-weight:600;object-fit:cover;background:#121019}
.s20{width:20px;height:20px;font-size:9px}.s24{width:24px;height:24px;font-size:11px}.s28{width:28px;height:28px;font-size:12px}.s30{width:30px;height:30px;font-size:13.5px}
.t0{background:#0f9d7a}.t1{background:#d97706}.t2{background:#db2777}.t3{background:#2563eb}.t4{background:#7c3aed}.t5{background:#0891b2}.t6{background:#65a30d}.t7{background:#c2410c}
.me-av{background:#121019}
.panes{display:flex;flex:1;min-height:0}
.list{width:100%;flex-shrink:0;background:#f6f5fd}
@media(min-width:768px){.list{width:320px;border-right:1px solid var(--soft)}}
.list-head{padding:20px 20px 12px}
.list-head h2{font-size:22px;line-height:1.5;font-weight:700;letter-spacing:-.02em}
.summary{margin-top:2px;font-size:12.5px;color:var(--dim)}
.summary .fresh{color:var(--dim)}.summary [data-fresh-n],.summary .fresh{color:var(--brand)}
.rows{padding:0 8px 24px;display:flex;flex-direction:column;gap:4px}
.row{display:flex;width:100%;align-items:flex-start;gap:12px;border-radius:12px;padding:12px;text-align:start}
.row:hover{background:rgba(239,237,251,.7)}
@media(min-width:768px){.row[aria-current]{background:#fff;box-shadow:0 1px 2px rgba(18,16,25,.06),0 0 0 1px var(--line)}.row[aria-current]:hover{background:#fff}}
.row-main{min-width:0;flex:1}
.row-title{display:flex;min-width:0;align-items:center;gap:8px}
.row-title .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14.5px;line-height:1.5;font-weight:600;letter-spacing:-.01em;color:var(--ink)}
[data-off] .row-title .t{color:#8a87a0}
.pill-off{display:none;flex-shrink:0;border-radius:999px;background:var(--line);padding:1px 6px;font-size:10.5px;line-height:1.5;font-weight:500;color:var(--ink2)}
[data-off] .pill-off{display:inline}
.row-project{margin-top:2px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.5;color:var(--dim)}
.row-meta{margin-top:6px;display:flex;align-items:center;gap:12px;font-size:12px;line-height:1.5;color:var(--dim)}
.ic{display:inline-flex;align-items:center;gap:4px}
.in-now{display:inline-flex;align-items:center;gap:6px;color:var(--green)}
.dot{width:6px;height:6px;border-radius:999px;background:#12b886}
.amber{color:var(--amber)}
.off-only{display:none}
[data-off] .off-only{display:inline}
[data-off] .on-only{display:none}
.badge{margin-top:2px;display:grid;place-items:center;height:20px;min-width:20px;border-radius:999px;background:var(--brand);padding:0 6px;font-size:11px;font-weight:600;color:#fff}
.chev{align-self:center;margin-top:2px;color:var(--faint)}
@media(min-width:768px){.chev{display:none}}
.room-pane{min-width:0;flex:1}
@media(max-width:767px){body.open .list{display:none}body:not(.open) .room-pane{display:none}}
.empty{display:grid;place-items:center;height:100%;padding:40px;text-align:center;font-size:14px;color:var(--ink2)}
.room{max-width:768px;margin:0 auto;padding:16px 20px 64px}
@media(min-width:640px){.room{padding:40px 40px 64px}}
.back{display:inline-flex;align-items:center;gap:4px;height:36px;margin:0 0 12px -8px;padding:0 8px;border-radius:8px;font-size:13px;font-weight:500;color:var(--ink2)}
.back:hover{background:var(--tint)}
@media(min-width:768px){.back{display:none}}
.crumbs{font-size:12.5px;line-height:1.5;color:var(--dim)}
.room h1{margin-top:4px;font-size:22px;line-height:1.5;font-weight:600;letter-spacing:-.02em}
.address{margin-top:16px;display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px 16px}
.addr{min-width:0;font-size:22px;line-height:1.25;letter-spacing:-.02em;color:var(--ink)}
@media(min-width:400px){.addr{font-size:26px}}
@media(min-width:640px){.addr{font-size:34px}}
.addr .host{color:var(--faint)}.addr .id{word-break:break-all}
[data-off] .addr{color:var(--faint);text-decoration:line-through;text-decoration-color:#c9c6f5;text-decoration-thickness:2px}
.tools{display:flex;flex-shrink:0;align-items:center;gap:2px;border:1px solid var(--line);background:#fff;border-radius:12px;padding:2px}
.icon-btn{display:grid;place-items:center;width:36px;height:36px;flex-shrink:0;border-radius:9px;color:var(--ink2)}
.icon-btn:hover,.icon-btn[aria-expanded=true]{background:var(--tint);color:var(--ink)}
.icon-btn .done,.cmd-copy .done{display:none}
.is-done .idle{display:none}.is-done .done{display:block}
.icon-btn.is-done{color:var(--green)!important}
.pop{position:fixed;z-index:50;width:min(360px,calc(100vw - 24px));border-radius:16px;border:1px solid var(--line);background:#fff;padding:16px;color:var(--ink);box-shadow:0 12px 40px -8px rgba(18,16,25,.18);transform-origin:top right}
.pop-title{font-size:14px;line-height:1.5;font-weight:600}
.pop-text{margin-top:4px;font-size:13px;line-height:1.375;color:var(--ink2)}
.cmd{margin-top:12px;display:flex;align-items:center;gap:4px;border-radius:12px;background:var(--tint);padding:4px 4px 4px 12px}
.cmd code{min-width:0;flex:1;word-break:break-all;padding:6px 0;font-size:12.5px;line-height:1.375}
.cmd-copy{display:grid;place-items:center;width:32px;height:32px;flex-shrink:0;border-radius:8px;color:var(--ink2)}
.cmd-copy:hover{background:#fff;color:var(--ink)}
.pop-done{margin-top:8px;font-size:12px;color:var(--green)}
.pop-done:empty{display:none}
.glance{margin-top:28px;display:flex;flex-direction:column;gap:20px}
.card{width:100%;overflow:hidden;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(18,16,25,.06),0 10px 28px -14px rgba(42,36,120,.3),0 0 0 1px var(--line)}
.card-pic{position:relative;aspect-ratio:1200/630;overflow:hidden;background:#121019}
.card-img,.card-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.card-bg{background:radial-gradient(120% 80% at 50% 120%,#4a42d4 0%,#1c1830 45%,#121019 75%)}
.card-logo{position:absolute;left:50%;top:50%;height:46%;transform:translate(-50%,-50%)}
[data-off] .card-img,[data-off] .card-bg,[data-off] .card-logo{opacity:.35;filter:grayscale(1)}
.card-off{position:absolute;left:50%;top:80%;transform:translateX(-50%);white-space:nowrap;font-size:11px;font-weight:500;color:rgba(255,255,255,.7)}
.card figcaption{display:flex;gap:10px;padding:10px 12px 12px}
.cap{min-width:0;flex:1}
.cap-host{display:block;font-size:10.5px;line-height:1.5;color:var(--dim)}
.cap-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;line-height:1.5;font-weight:600;letter-spacing:-.01em}
[data-off] .cap-title{color:#8d8aa3}
.cap-msg{margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:11.5px;line-height:1.375;color:var(--ink2)}
.card figcaption .av{margin-top:2px;background:#121019}
.numbers{min-width:0;flex:1;display:flex;flex-direction:column;gap:10px;font-size:14px;line-height:1.375;color:var(--ink2)}
.numbers b{font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}
.new-words{color:var(--brand)}
.who-line{display:flex;align-items:center;gap:8px}
.green{color:var(--green)}
.track-wrap{padding-top:4px}
.track{display:flex;max-width:320px;align-items:center;gap:10px}
.bar{height:3px;flex:1;overflow:hidden;border-radius:999px;background:var(--soft)}
.fill{height:100%;border-radius:999px;background:#bdbacd}
.track.soon .fill{background:var(--amber2)}
.days{flex-shrink:0;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dim)}
.track.soon .days{font-weight:500;color:var(--amber)}
[data-off] .track.soon .fill{background:#bdbacd}[data-off] .track.soon .days{font-weight:400;color:var(--dim)}
.note{margin-top:6px;font-size:12.5px;color:var(--dim)}
.sections{margin-top:40px;display:flex;flex-direction:column;gap:40px}
.sections h2{font-size:15px;line-height:1.5;font-weight:600}
.sub{margin-top:2px;font-size:12.5px;color:var(--dim)}
.field{display:block;width:100%;resize:none;border-radius:12px;border:1px solid var(--line);background:#fff;padding:10px 12px;font:14px/1.375 var(--sans);color:var(--ink);outline:none}
.field::placeholder{color:var(--faint)}
.field:focus-visible{border-color:#6d68f0;box-shadow:0 0 0 4px rgba(109,104,240,.15)}
.msg .field{margin-top:10px}
.msg-row{margin-top:6px;display:flex;height:32px;align-items:center;gap:12px;font-size:12px;color:var(--dim)}
.counter{font-variant-numeric:tabular-nums}
.saved{display:inline-flex;align-items:center;gap:4px;color:var(--green)}
.msg-btns{margin-left:auto;display:flex;gap:6px}
.btn-primary{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;border-radius:10px;background:var(--brand);color:#fff;font-size:14px;font-weight:500}
.btn-primary:hover{background:#4a42d4}
.btn-primary.sm{height:32px;padding:0 12px;border-radius:8px;font-size:13px}
.msg .btn-primary:disabled{background:var(--line);color:#8a87a0}
.reply-form .btn-primary:disabled{opacity:.4;background:var(--brand)}
.btn-ghost{height:32px;padding:0 10px;border-radius:8px;font-size:13px;font-weight:500;color:var(--ink2)}
.btn-ghost:hover{background:var(--tint)}
.btn-ghost.h36{height:36px}
.dim{font-weight:400;color:var(--dim)}
.notes{margin-top:4px}
.note-item+.note-item{border-top:1px solid var(--soft)}
.shown{display:flex;gap:12px;padding:16px 0}
.hid-row{display:none;align-items:center;gap:8px;padding:12px 0;font-size:13px;color:var(--dim)}
[data-hidden] .hid-row{display:flex}[data-hidden] .shown{display:none}
.btn-link{margin-left:auto;height:32px;padding:0 10px;border-radius:8px;font-weight:500;color:var(--brand)}
.btn-link:hover{background:var(--tint)}
.note-body{min-width:0;flex:1}
.note-head{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:8px;font-size:12.5px;color:var(--dim)}
.note-name{font-size:14px;font-weight:600;color:var(--ink)}
.pill-new{border-radius:999px;background:var(--tint);padding:0 6px;font-size:11px;font-weight:500;color:var(--brand)}
.note-text{margin-top:4px;font-size:14.5px;line-height:1.375;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}
.reply-line{margin-top:10px;display:flex;gap:8px;border-left:2px solid var(--line);padding-left:12px;font-size:13.5px;line-height:1.375;color:var(--ink2);white-space:pre-wrap;overflow-wrap:anywhere}
.you{font-weight:600;color:var(--ink)}
.reply-form{margin-top:12px}
.reply-btns{margin-top:8px;display:flex;justify-content:flex-end;gap:6px}
.acts{margin:4px 0 0 -8px;display:flex;gap:2px}
.act{display:grid;place-items:center;width:32px;height:32px;border-radius:8px;color:var(--dim)}
.act:hover{background:var(--tint);color:var(--ink)}
.none{margin-top:8px;font-size:13.5px;color:var(--ink2)}
.more{margin-top:4px;font-size:12.5px;color:var(--dim)}
.foot{display:flex;flex-wrap:wrap;align-items:center;gap:12px 8px;border-top:1px solid var(--soft);padding-top:20px}
.btn-line{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:#fff;font-size:13px;font-weight:500}
.btn-line:hover{background:#f6f5fd}
.btn-remove{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:8px;font-size:13px;font-weight:500;color:var(--dim)}
.btn-remove:hover{background:#fde8e8;color:#b42318}
.confirm{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.confirm-q{font-size:13px;color:var(--ink2)}
.btn-danger{height:36px;padding:0 12px;border-radius:8px;background:#b42318;color:#fff;font-size:13px;font-weight:500}
.btn-danger:hover{background:#9a1d14}
.foot-note{flex-basis:100%;font-size:12.5px;color:var(--dim)}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:70;max-width:calc(100vw - 32px);background:#121019;color:#fff;font-size:13px;padding:10px 14px;border-radius:10px;box-shadow:0 12px 40px -8px rgba(18,16,25,.3)}
.quiet{flex:1;display:grid;place-items:center;padding:24px 16px}
.quiet-box{max-width:28rem;text-align:center;display:flex;flex-direction:column;align-items:center}
.quiet-logo{width:48px;height:48px;margin-bottom:20px}
.quiet h1{font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-.02em}
.quiet p{margin-top:8px;font-size:14px;color:var(--ink2)}
.quiet .btn-primary{margin-top:24px}
.gh{background:#121019}.gh:hover{background:#2a2738}
`
