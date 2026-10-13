#!/usr/bin/env node
// How smoothly a variant runs: frames per second while it sits still or while something in it is
// dragged, how busy the page's main thread and the GPU thread are, and which of the design's own
// functions take the time. A design that animates (an analyser, a canvas, a ticker) or that is
// judged by how it feels under the pointer is measured here before the user sees it.
// Usage: perf.mjs <app-url> <route> [--seconds=3] [--size=<w>x<h>] [--dpr=2] [--hz=<n>] [--drag=<css>] [--click=<css>]...
// Normally run through `proto perf`, which fills in the URL.
//
// Why these numbers (measured 2026-10-12 on a whole-plugin prototype): at rest everything held
// the screen's rate, but dragging a band dot at DPR 1.5 fell to 57-68 fps with the main thread
// half idle. The GPU thread was saturated (GPUTask ~990 ms/s): one 1155-point canvas path filled
// and stroked per frame is rasterised as a canvas-sized job. Frame rate alone hides which side
// is short, so both threads are reported, and the verdict names the one that is full.
//
// Headless Chrome, so nothing opens on the user's screen; it reproduced the same drop (68 fps
// before the fix, 99 after) as a visible window did (60 and 98). DPR defaults to 2, the density
// of a Retina or 200 % screen: GPU raster grows with it, so a design that is smooth at 2 is
// smooth on the common screens below it.
//
// The frame budget is the screen's, measured on a blank tab before the design loads (or --hz):
// taken from the design's own frames, a page slow on every frame set its own budget and read as
// smooth (45 ms of work per frame: 22 fps against "20 Hz", nothing dropped). Frames missed are
// the ones the screen had time for and the page did not draw.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startChrome, stopChrome, waitReady } from './chrome.mjs'

const argv = process.argv.slice(2)
const flags = Object.fromEntries(argv.filter(a => a.startsWith('--') && !a.startsWith('--click=')).map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')] }))
const clicks = argv.filter(a => a.startsWith('--click=')).map(a => a.slice(8))
const [rawUrl, route] = argv.filter(a => !a.startsWith('--'))
if (!rawUrl || !route) { console.error('usage: perf.mjs <app-url> <route> [--seconds=3] [--size=<w>x<h>] [--dpr=2] [--hz=<n>] [--drag=<css>] [--click=<css>]'); process.exit(1) }
const hz = flags.hz ? Number(flags.hz) : 0
if (flags.hz && !(hz >= 20 && hz <= 500)) { console.error('perf: --hz is the screen\'s refresh rate, 20 to 500'); process.exit(1) }
const secs = Math.min(20, Math.max(1, +(flags.seconds || 3)))
const [W, H] = (flags.size || '1440x900').split('x').map(Number)
const dpr = +(flags.dpr || 2)

const profile = mkdtempSync(join(tmpdir(), 'proto-perf-'))
const chrome = startChrome([`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--window-size=${W},${H}`])
const cleanup = () => { stopChrome(chrome); try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* temp dir */ } }
const timer = setTimeout(() => { console.error('perf: timed out'); cleanup(); process.exit(1) }, 60_000 + secs * 1000)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(1) })

try {
  const wsUrl = await new Promise((ok, fail) => {
    let buf = ''
    chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]) })
    chrome.on('exit', () => fail(new Error('Chrome exited before DevTools was ready')))
  })
  const ws = new WebSocket(wsUrl)
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
  let nextId = 0
  const pending = new Map(), events = []
  let traced = () => {}
  ws.onmessage = e => {
    const msg = JSON.parse(e.data)
    if (msg.method === 'Tracing.dataCollected') events.push(...msg.params.value)
    else if (msg.method === 'Tracing.tracingComplete') traced()
    else if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result)
    }
  }
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const id = ++nextId
    pending.set(id, { ok, fail })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  // A window of its own, told it has focus: headless Chrome holds back the frames of a tab that is
  // not in front, which would read as the design dropping them.
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true })
  const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, s)
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dpr, mobile: W < 640 }, s)
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  // The screen's frame interval, from the blank tab with nothing to draw (the median of a second).
  const screen = hz ? 1000 / hz : await ev(`new Promise(r => { const d = []; let last = 0
    const f = t => { if (last) d.push(t - last); last = t; if (d.length < 60) requestAnimationFrame(f); else { d.sort((a, b) => a - b); r(d[d.length >> 1]) } }
    requestAnimationFrame(f) })`)
  const url = new URL(rawUrl)
  url.hash = '/' + route.replace(/^\/+/, '')
  // As proto shoot: no artboard frame (the page's design in its own iframe since the stage's
  // artboard), so --click, --drag and the measured element are the design that shows.
  url.searchParams.set('hints', '0')
  await send('Page.navigate', { url: url.href }, s)
  await waitReady(ev)
  await sleep(1500)   // past the design's entrance and first layout
  const inStage = sel => `document.querySelector('[data-layers]')?.querySelector(${JSON.stringify(sel)})`
  // A step that can't be taken means the state to measure was never reached: an error, not a
  // measurement of something else.
  for (const sel of clicks) {
    if (!await ev(`(() => { const el = ${inStage(sel)}; el?.click(); return !!el })()`)) throw new Error(`nothing matches --click ${sel} on ${route}, so the state to measure was never reached`)
    await sleep(400)
  }
  if (flags.drag && !await ev(`!!${inStage(flags.drag)}`)) throw new Error(`nothing matches --drag ${flags.drag} on ${route}, so there is nothing to drag`)

  // Measure: frame intervals from requestAnimationFrame, main-thread time (Performance metrics),
  // GPU-thread time (a trace), the design's own functions (a sampling profile).
  await send('Performance.enable', {}, s)
  await send('Profiler.enable', {}, s)
  await send('Profiler.setSamplingInterval', { interval: 250 }, s)
  const metric = async () => Object.fromEntries((await send('Performance.getMetrics', {}, s)).metrics.map(m => [m.name, m.value]))
  const m0 = await metric()
  await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['gpu', 'disabled-by-default-devtools.timeline'] } })
  await send('Profiler.start', {}, s)
  let drag = null
  if (flags.drag) {
    const c = await ev(`(() => { const el = ${inStage(flags.drag)}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    if (!c) throw new Error(`--drag ${flags.drag} left ${route} before the measurement began`)
    else {
      const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' }, s)
      await mouse('mousePressed', c.x, c.y)
      // An unhurried loop, 160 x 90 px, about one and a half turns per two seconds: a hand moving a control.
      drag = (async () => {
        const t0 = performance.now()
        while (performance.now() - t0 < secs * 1000) {
          const a = (performance.now() - t0) / 1000 * Math.PI * 1.4
          await mouse('mouseMoved', c.x + 160 * Math.sin(a), c.y + 90 * (1 - Math.cos(a)))
          await sleep(4)
        }
        await mouse('mouseReleased', c.x, c.y)
      })()
    }
  }
  const frames = await ev(`new Promise(r => { const t0 = performance.now(), d = []; let last = t0
    const f = t => { d.push(t - last); last = t; if (t - t0 < ${secs * 1000}) requestAnimationFrame(f); else r({ d, wall: t - t0 }) }
    requestAnimationFrame(f) })`)
  await drag
  const { profile: prof } = await send('Profiler.stop', {}, s)
  await new Promise(ok => { traced = ok; send('Tracing.end') })
  const m1 = await metric()

  // Frames: against the screen's budget (measured on the blank tab, or --hz), the frames the screen
  // had time for in the measured span and the page did not draw are dropped ones.
  const d = frames.d.slice(1), sorted = [...d].sort((a, b) => a - b)
  const budget = screen || 16.7
  const span = d.reduce((a, b) => a + b, 0)
  const expected = Math.max(d.length, Math.round(span / budget))
  const dropped = expected - d.length
  const fps = d.length / (frames.wall / 1000), p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
  const pct = (k, src = m1, from = m0) => (100 * ((src[k] ?? 0) - (from[k] ?? 0)) / (frames.wall / 1000))
  const main = pct('TaskDuration'), script = pct('ScriptDuration')
  let gpuUs = 0, rasterUs = 0
  for (const e of events) if (e.ph === 'X' && e.dur) { if (e.name === 'GPUTask') gpuUs += e.dur; else if (e.name === 'RasterDecoderImpl::DoRasterCHROMIUM') rasterUs += e.dur }
  // µs of work over ms of wall time, as a percentage of the thread
  const gpu = gpuUs / frames.wall / 10, raster = rasterUs / frames.wall / 10

  // The design's own functions (and the shell's), by self time; the browser's and the
  // framework's internals are summed into one line, since they are not the design's to fix.
  const byId = new Map(prof.nodes.map(n => [n.id, n])), self = new Map()
  prof.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (prof.timeDeltas[i] ?? 0)))
  const mine = new Map()
  let other = 0
  for (const [id, us] of self) {
    const cf = byId.get(id).callFrame
    const m = (cf.url || '').match(/\/(src\/(?!main|mount|registry|hints|copy|motion)[^?]+)/)
    if (!m || /^\((idle|program|garbage collector)\)$/.test(cf.functionName)) { if (!/^\(idle\)$/.test(cf.functionName)) other += us; continue }
    const k = `${cf.functionName || '(anonymous)'}  ${m[1]}:${cf.lineNumber + 1}`
    mine.set(k, (mine.get(k) ?? 0) + us)
  }
  const ms = us => us / 1000 / (frames.wall / 1000)
  const top = [...mine].sort((a, b) => b[1] - a[1]).slice(0, 6).filter(([, us]) => ms(us) >= 0.5)

  const label = `${route}  ${W}x${H} @${dpr}x  ${(frames.wall / 1000).toFixed(0)} s ${flags.drag ? `dragging ${flags.drag}` : 'at rest'}`
  const verdict = dropped <= Math.max(2, expected * 0.02) && fps >= 0.95 * (1000 / budget)
    ? 'smooth'
    : gpu >= 85 ? 'drops frames: the GPU thread is full. Something big is repainted every frame: a long canvas path (split it into short clipped pieces), a large canvas or blur redrawn whole (draw what does not move once, on a layer of its own), or a large blurred or shadowed element that moves.'
      : main >= 70 ? 'drops frames: the main thread is full. The functions below are where; also look for a whole tree re-rendering on every pointer move or animation frame.'
        : 'drops frames, with neither thread full: look for a long task (a heavy handler, a big re-render) in the functions below.'
  console.log(label)
  console.log(`  ${fps.toFixed(1)} fps  (screen ${(1000 / budget).toFixed(0)} Hz${hz ? ', from --hz' : ''}; p95 frame ${p95.toFixed(1)} ms; ${dropped} of ${expected} frames dropped)`)
  console.log(`  main thread ${Math.min(100, main).toFixed(0)}% busy (script ${script.toFixed(0)}%)   GPU thread ${gpu.toFixed(0)}% busy (raster ${raster.toFixed(0)}%)`)
  console.log(`  ${verdict}`)
  if (top.length) console.log(top.map(([k, us]) => `  ${ms(us).toFixed(1).padStart(5)} ms/s  ${k}`).join('\n'))
  console.log(`  ${ms(other).toFixed(1).padStart(5)} ms/s  the browser and the framework`)
  clearTimeout(timer)
  cleanup()
  process.exit(0)
} catch (e) {
  console.error(`perf: ${e.message}`)
  cleanup()
  process.exit(1)
}
