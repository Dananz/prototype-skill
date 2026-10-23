#!/usr/bin/env node
// How close a variant is to a screenshot of the real thing, as numbers: the share of pixels off by
// more than 32 (in any channel, of 255) and the mean error, overall, per column band and per third,
// plus one image to read (reference, build, difference x4). It is the stopping signal for a build:
// iterate until the number is under the target, or until two tries in a row stop improving it.
// Usage: compare.mjs <app-url> <out-dir> <route> --ref=<png> [--el=<css>] [--size=<w>x<h>] [--click=<css>]...
// Normally run through `proto compare`, which fills in the URL and folder.
//
// The page is laid out at --size (CSS px, default 1440x900: the width the reference was taken at,
// so the same breakpoints and wrapping apply), and the element (--el, inside the design; default
// the variant's root) is shot at the pixel density that makes it as wide as the reference, so a
// 1:1 screenshot compares at 1x and a 2x one at 2x. Layout and density are separate: a wider
// viewport would switch breakpoints (a layout matching its 1440 px reference scored 100 % off at
// 2400 px). Pixels the reference left transparent (rounded corners, a cut-out) are left out.
//
// Why (measured 2026-10-12, 11 timed rebuilds of two regions of a plugin UI): builders given this
// score finished in 0.5-8 minutes at or beyond the fidelity of earlier builders that took 8-23
// minutes without it, and wrote no throwaway pixel-measuring scripts; builders told only "an empty
// one scores N%" stopped after their first try, short of what they could reach.
// Runs in headless Chrome and compares in a canvas there, so it needs nothing installed.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startChrome, stopChrome, waitReady } from './chrome.mjs'

const argv = process.argv.slice(2)
const flags = Object.fromEntries(argv.filter(a => a.startsWith('--') && !a.startsWith('--click=')).map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')] }))
const clicks = argv.filter(a => a.startsWith('--click=')).map(a => a.slice(8))
const [rawUrl, outDir, route] = argv.filter(a => !a.startsWith('--'))
if (!rawUrl || !outDir || !route || !flags.ref) { console.error('usage: compare.mjs <app-url> <out-dir> <route> --ref=<png> [--el=<css>] [--click=<css>]'); process.exit(1) }
const refB64 = readFileSync(flags.ref).toString('base64')
// PNG width and height sit at fixed offsets of the IHDR chunk.
const refBuf = Buffer.from(refB64, 'base64')
const [RW, RH] = [refBuf.readUInt32BE(16), refBuf.readUInt32BE(20)]
const [VW, VH] = String(flags.size || '1440x900').split('x').map(Number)

const profile = mkdtempSync(join(tmpdir(), 'proto-compare-'))
const chrome = startChrome([`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--window-size=${VW},${VH}`])
const cleanup = () => { stopChrome(chrome); try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* temp dir */ } }
const timer = setTimeout(() => { console.error('compare: timed out'); cleanup(); process.exit(1) }, 90_000)
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
  const pending = new Map()
  ws.onmessage = e => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) { const { ok, fail } = pending.get(msg.id); pending.delete(msg.id); msg.error ? fail(new Error(msg.error.message)) : ok(msg.result) }
  }
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => { const id = ++nextId; pending.set(id, { ok, fail }); ws.send(JSON.stringify({ id, method, params, sessionId })) })
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const tab = async (scale) => {
    // Its own window, with focus: headless Chrome holds back frames in a tab that is not in front.
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
    await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: scale, mobile: VW < 640 }, sessionId)
    // Below 640 px a phone, with touch, as shoot's phone shots are: (pointer: coarse) and
    // navigator.maxTouchPoints then match the reference shot at that size.
    if (VW < 640) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
    const ev = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
      return r.result.value
    }
    return { targetId, sessionId, ev }
  }
  const open = async scale => {
    const t = await tab(scale)
    const url = new URL(rawUrl)
    url.pathname = '/' + route.replace(/^\/+/, '')
    // As proto shoot: no artboard frame (the page's design in its own iframe since the stage's
    // artboard), so --click, --drag and the measured element are the design that shows.
    url.searchParams.set('hints', '0')
    await send('Page.navigate', { url: url.href }, t.sessionId)
    await waitReady(t.ev)
    await t.ev('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 400)))')
    for (const sel of clicks) {
      if (!await t.ev(`(() => { const el = document.querySelector('[data-layers]')?.querySelector(${JSON.stringify(sel)}); el?.click(); return !!el })()`)) console.error(`compare: nothing matches --click ${sel} on ${route}`)
      await sleep(400)
    }
    return t
  }
  const el = flags.el ? JSON.stringify(flags.el) : null
  const box = `(() => { document.querySelector('[data-overlay]')?.style.setProperty('display', 'none')
    const root = document.querySelector('[data-layers] [data-mount]'), e = ${el ? `root?.querySelector(${el})` : 'root?.firstElementChild'}
    if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`

  // The element's CSS width at scale 1 sets the scale that makes it as wide as the reference.
  let t = await open(1)
  let r = await t.ev(box)
  if (!r) throw new Error(flags.el ? `nothing matches --el ${flags.el} in ${route}` : `no design mounted at ${route}`)
  const scale = RW / r.width
  if (Math.abs(scale - 1) > 0.01) { await send('Target.closeTarget', { targetId: t.targetId }); t = await open(scale); r = await t.ev(box) }
  const shot = (await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 }, captureBeyondViewport: true }, t.sessionId)).data
  await send('Target.closeTarget', { targetId: t.targetId })

  // Compare in a blank tab's canvas: both images decoded there, the numbers and the sheet out.
  const c = await tab(1)
  const res = await c.ev(`(async () => {
    const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src })
    const [ri, bi] = await Promise.all([load('data:image/png;base64,${refB64}'), load('data:image/png;base64,${shot}')])
    const W = ri.width, H = ri.height
    const px = img => { const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d'); g.drawImage(img, 0, 0, W, H); return g.getImageData(0, 0, W, H).data }
    const a = px(ri), b = px(bi), N = W * H
    const off = new Uint8Array(N), seen = new Uint8Array(N), diff = new Uint8ClampedArray(N * 4)
    let sum = 0, cnt = 0, bad = 0
    for (let i = 0; i < N; i++) {
      const k = i * 4
      diff[k + 3] = 255
      if (a[k + 3] < 255) continue
      seen[i] = 1; cnt++
      let mx = 0
      for (let ch = 0; ch < 3; ch++) { const d = Math.abs(a[k + ch] - b[k + ch]); sum += d; if (d > mx) mx = d; diff[k + ch] = Math.min(255, d * 4) }
      if (mx > 32) { off[i] = 1; bad++ }
    }
    const share = (x0, x1, y0, y1) => { let o = 0, s = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; o += off[i]; s += seen[i] } return s ? Math.round(100 * o / s) : 0 }
    const COLS = 8, cw = Math.ceil(W / COLS)
    const cols = Array.from({ length: COLS }, (_, j) => [Math.round(j * cw / ${scale}), share(j * cw, Math.min(W, (j + 1) * cw), 0, H)])
    const thirds = [0, 1, 2].map(j => share(0, W, Math.floor(j * H / 3), Math.floor((j + 1) * H / 3)))
    // The sheet: reference, build, difference x4, with a 6 px rule between.
    const sheet = new OffscreenCanvas(W, H * 3 + 12), g = sheet.getContext('2d')
    g.fillStyle = '#3c3c3c'; g.fillRect(0, 0, W, H * 3 + 12)
    g.drawImage(ri, 0, 0, W, H); g.drawImage(bi, 0, H + 6, W, H)
    g.putImageData(new ImageData(diff, W, H), 0, 2 * H + 12)
    const blob = await sheet.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { off: 100 * bad / Math.max(1, cnt), mean: sum / Math.max(1, cnt * 3), cols, thirds, size: [bi.width, bi.height], sheet: btoa(bin) }
  })()`)

  const name = route.replace(/^\/+/, '').replace(/\//g, '-') + (flags.el ? '-' + flags.el.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') : '')
  mkdirSync(outDir, { recursive: true })
  const file = resolve(outDir, `${name}-compare.png`)
  writeFileSync(file, Buffer.from(res.sheet, 'base64'))
  if (Math.abs(res.size[0] - RW) > 2 || Math.abs(res.size[1] - RH) > 2) console.error(`compare: the build is ${res.size.join('x')} px and the reference ${RW}x${RH}: the element's shape differs, so the numbers compare a stretched build`)
  console.log(`${route}${flags.el ? ` ${flags.el}` : ''}: ${res.off.toFixed(2)}% of pixels off by >32, mean error ${res.mean.toFixed(2)} (of 255), at ${scale.toFixed(2)}x`)
  console.log(`  per column (css x: % off): ${res.cols.map(([x, v]) => `${x}:${v}`).join(' ')}   per third (top mid bottom): ${res.thirds.join(' ')}`)
  console.log(`  ${file}  (rows: reference, build, difference x4)`)
  clearTimeout(timer)
  cleanup()
  process.exit(0)
} catch (e) {
  console.error(`compare: ${e.message}`)
  cleanup()
  process.exit(1)
}
