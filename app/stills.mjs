// The map's stills (shell/map), taken by the dev server in headless Chrome: each screen at its own
// size and 2x, with reduced motion, once its entrance has settled, kept on disk until its prototype's
// files change. The page only shows images, so a map of hundreds of boards costs its tab nothing to
// fill, and a reload (or another device) gets them at once. A share is static and has no server: its
// map still takes them in the tab.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Bump when a capture would come out different for the same files: every still is taken again. */
const VERSION = 1
const DPR = 2, THUMB = 0.25
/** Chrome stops after this long with nothing to take; the next still starts it again. */
const IDLE_MS = 60_000
/** The folder keeps at most this many files (a full and a small one per still), the oldest go first. */
const KEEP = 800
const ROUTE = /^[a-z0-9][a-z0-9-]*\/[A-Z]{1,2}$/

// The newest change under a path (a folder is walked; a missing one is 0).
function newest(path) {
  let st
  try { st = statSync(path) } catch { return 0 }
  if (!st.isDirectory()) return st.mtimeMs
  let t = st.mtimeMs
  for (const name of readdirSync(path)) if (!name.startsWith('.')) t = Math.max(t, newest(join(path, name)))
  return t
}

// A map asks for every board at once: each prototype's folders are walked once a second at most.
const walked = new Map()
const changed = (src, slug) => {
  const was = walked.get(`${src}|${slug}`)
  if (was && Date.now() - was.at < 1000) return was.t
  const t = Math.max(...[join(src, 'protos', slug), join(src, 'theme.css'), join(src, 'designs'), join(src, 'assets')].map(newest))
  walked.set(`${src}|${slug}`, { t, at: Date.now() })
  return t
}

/** What the still of a route depends on: its prototype's folder and the app's shared files. */
export function stillKey(root, { route, w, h, theme }) {
  const t = changed(join(root, 'src'), route.split('/')[0])
  return createHash('sha1').update(JSON.stringify([VERSION, route, w, h, theme, DPR, t])).digest('hex').slice(0, 20)
}

/**
 * root: the app's folder. origin(): where Chrome opens the page (the dev server's own address).
 * skill: the skill's folder, for its Chrome launcher (PROTO_SKILL); without one stills are unavailable
 * and the page takes them itself. emit(data): tells the page a still is ready (or failed).
 */
export function stillServer({ root, origin, skill = process.env.PROTO_SKILL, emit }) {
  const dir = join(root, '.proto', 'stills')
  const queue = [], queued = new Set()
  let chrome = null, starting = null, running = false, idle = null, closed = false

  const files = hash => ({ full: join(dir, `${hash}.webp`), thumb: join(dir, `${hash}-s.webp`) })
  const urls = hash => ({ url: `/__proto/stills/${hash}.webp`, thumb: `/__proto/stills/${hash}-s.webp` })
  const has = hash => { try { statSync(files(hash).full); statSync(files(hash).thumb); return true } catch { return false } }

  async function launch() {
    const { startChrome, stopChrome, waitReady } = await import(join(skill, 'scripts', 'chrome.mjs'))
    const profile = mkdtempSync(join(tmpdir(), 'proto-stills-'))
    const proc = startChrome([`--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--mute-audio'])
    const wsUrl = await new Promise((ok, no) => {
      let b = ''
      const timer = setTimeout(() => no(new Error('Chrome did not start')), 15_000)
      proc.stderr.on('data', d => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); ok(m[1]) } })
      proc.on('exit', () => { clearTimeout(timer); no(new Error('Chrome exited')) })
    })
    const ws = new WebSocket(wsUrl)
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
    let id = 0
    const wait = new Map()
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id) } }
    ws.onclose = () => { for (const r of wait.values()) r({ error: { message: 'closed' } }); wait.clear(); if (chrome?.ws === ws) chrome = null }
    const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
      const i = ++id
      wait.set(i, m => m.error ? no(new Error(m.error.message)) : ok(m.result))
      ws.send(JSON.stringify({ id: i, method, params, sessionId }))
    })
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.enable', {}, sessionId)
    await send('Runtime.enable', {}, sessionId)
    const run = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId))?.result?.value
    return { proc, ws, send: (m, p) => send(m, p, sessionId), run, waitReady, stop: () => { try { ws.close() } catch { /* gone */ } stopChrome(proc) } }
  }

  async function take({ hash, route, w, h, theme }) {
    if (!chrome) chrome = await (starting ??= launch().finally(() => { starting = null }))
    const { send, run, waitReady } = chrome
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: DPR, mobile: false })
    await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: theme }] })
    await send('Page.navigate', { url: `${origin()}/${route}?dv=1&theme=${theme}&shot=1` })
    if (!await waitReady(run)) throw new Error('the page never said it was ready')
    // The design alone: the shell's own controls and Vite's error overlay are hidden. Then its entrance
    // plays out: a floor for motion driven by script, then until no finite animation runs.
    await run(`(async () => {
      const s = document.createElement('style'); s.textContent = '[data-proto-ui], vite-error-overlay { display: none !important }'; document.head.append(s)
      const sleep = ms => new Promise(r => setTimeout(r, ms)), t0 = performance.now()
      await sleep(1200)
      while (performance.now() - t0 < 5000 && document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)) await sleep(120)
      await document.fonts.ready
      await Promise.all([...document.images].map(i => i.decode().catch(() => {})))
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    })()`)
    const shot = async scale => Buffer.from((await send('Page.captureScreenshot', { format: 'webp', quality: 86, clip: { x: 0, y: 0, width: w, height: h, scale } })).data, 'base64')
    const full = await shot(1), small = await shot(THUMB)
    mkdirSync(dir, { recursive: true })
    const f = files(hash)
    writeFileSync(f.thumb, small); writeFileSync(f.full, full)
  }

  function prune() {
    try {
      const all = readdirSync(dir).map(n => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t)
      for (const { n } of all.slice(KEEP)) rmSync(join(dir, n), { force: true })
    } catch { /* no folder yet */ }
  }

  async function drain() {
    if (running) return
    running = true
    clearTimeout(idle)
    while (queue.length && !closed) {
      const job = queue.shift()
      try { await take(job); emit({ hash: job.hash, ...urls(job.hash), tw: Math.round(job.w * DPR * THUMB) }) }
      catch (e) {
        emit({ hash: job.hash, error: String(e?.message || e).slice(0, 200) })
        // A Chrome that broke mid-way is started again for the next one.
        if (chrome) { chrome.stop(); chrome = null }
      }
      finally { queued.delete(job.hash) }
    }
    running = false
    prune()
    idle = setTimeout(() => { if (!running && chrome) { chrome.stop(); chrome = null } }, IDLE_MS)
  }

  return {
    /** A still now ({url, thumb, tw}), or once it's taken ({pending, hash}, then the page hears `proto:still`). */
    ask(data) {
      const { route, theme = 'light' } = data
      const w = Math.round(Number(data.w)), h = Math.round(Number(data.h))
      if (typeof route !== 'string' || !ROUTE.test(route)) throw Object.assign(new Error('route is <slug>/<letter>'), { status: 400 })
      if (!(w >= 100 && w <= 4000 && h >= 100 && h <= 4000)) throw Object.assign(new Error('w and h are 100 to 4000'), { status: 400 })
      if (theme !== 'light' && theme !== 'dark') throw Object.assign(new Error('theme is light or dark'), { status: 400 })
      const hash = stillKey(root, { route, w, h, theme })
      const tw = Math.round(w * DPR * THUMB)
      if (has(hash)) return { hash, ...urls(hash), tw }
      if (!skill) return { unavailable: true }
      if (!queued.has(hash)) { queued.add(hash); queue.push({ hash, route, w, h, theme }) }
      void drain()
      return { hash, pending: true }
    },
    /** The file behind a /__proto/stills/<name> URL, or null. */
    file(name) {
      if (!/^[0-9a-f]{20}(-s)?\.webp$/.test(name)) return null
      try { const path = join(dir, name); statSync(path); return path } catch { return null }
    },
    close() { closed = true; clearTimeout(idle); queue.length = 0; if (chrome) { chrome.stop(); chrome = null } },
  }
}
