// Frame-exact recording of one example to PNG frames, using the playground's
// ?record route (virtual clock, stepped one frame at a time).
//
//   node scripts/record.mjs <name> --ms 14000 --fps 30 --out frames/<name> [--theme dark] [--scale 2]
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync } from 'node:fs'

const args = process.argv.slice(2)
const name = args[0]
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? args[i + 1] : d
}
const ms = Number(opt('ms', 14000))
const fps = Number(opt('fps', 30))
const out = opt('out', `frames/${name}`)
const theme = opt('theme', 'light')
const scale = Number(opt('scale', 2))
const base = opt('url', 'http://127.0.0.1:5193')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: scale })
await page.goto(`${base}/?record=${name}&fps=${fps}&theme=${theme}`)
for (let i = 0; !(await page.evaluate(() => window.__recordReady === true)); i++) {
  if (i > 300) throw new Error('record route never became ready')
  await new Promise((r) => setTimeout(r, 100))
}
await page.evaluate(() => document.fonts.ready)
const stage = page.locator('.ss-stage').first()
// Let layout settle on frame 0 without moving time.
await page.evaluate(async () => {
  const c = window.__stageshow.clock
  for (let i = 0; i < 5; i++) await c.flushLayout()
})
const total = Math.round((ms / 1000) * fps)
const until = opt('until', null)
const step = () => page.evaluate(async () => {
  const c = window.__stageshow.clock
  await c.step(1)
  while (c.layoutPending) await c.flushLayout()
})
await page.evaluate(() => {
  window.__marks = []
  const el = document.querySelector('.ss-stage')
  new MutationObserver(() => { const m = el.getAttribute('data-mark'); if (m) window.__marks.push(m) }).observe(el, { attributes: true, attributeFilter: ['data-mark'] })
})
const marks = () => page.evaluate(() => window.__marks.splice(0))
let seen = []
const saw = async (m) => { seen.push(...(await marks())); const i = seen.indexOf(m); if (i < 0) return false; seen = seen.slice(i + 1); return true }
if (args.includes('--warm') && until) {
  // Play one whole loop unseen, then start at the next loop's first frame,
  // so the recording is a steady-state loop.
  let n = 0
  while (!(await saw(until))) { await step(); if (++n > total * 2) throw new Error('warm-up never reached the end mark') }
  while (!(await saw(opt('from', 'start')))) { await step(); if (++n > total * 3) throw new Error('next loop never began') }
  console.log(`warmed up ${n} frames`)
}
for (let f = 0; f < total; f++) {
  if (until && f > 0 && (await saw(until))) { console.log(`hit mark ${until} at frame ${f}`); break }
  await page.evaluate(async () => {
    const c = window.__stageshow.clock
    await c.step(1)
    while (c.layoutPending) await c.flushLayout()
  })
  await stage.screenshot({ path: `${out}/f${String(f).padStart(4, '0')}.png`, animations: 'allow' })
  if (f % 60 === 0) process.stdout.write(`${f}/${total}\n`)
}
await browser.close()
console.log(`frames -> ${out}`)
