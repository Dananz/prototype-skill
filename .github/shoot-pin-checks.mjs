// `proto shoot --pin` shoots what a comment from the page is on, as its writer saw it: the batch's
// page size and theme at 2x, the way to the element opened (a click-opened panel), the element
// shown (it only shows on hover), its box plus a margin, a wider crop around it, and the comment's
// pasted picture beside the shot. Comments go in through the server, as the page sends them.
// Runs in the smoke suite, or on its own (it starts a session of its own): node .github/shoot-pin-checks.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { crc32, deflateSync, inflateSync } from 'node:zlib'

// A PNG of one colour, and a PNG read back to its pixels (8-bit RGB or RGBA, as Chrome writes them).
function solidPng(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data])
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
function readPng(file) {
  const buf = readFileSync(file)
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), type = buf[25], bpp = type === 6 ? 4 : type === 2 ? 3 : 0
  if (buf[24] !== 8 || !bpp || buf[28]) throw new Error(`${file}: not an 8-bit RGB(A) PNG`)
  const parts = []
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at), kind = buf.toString('latin1', at + 4, at + 8)
    if (kind === 'IDAT') parts.push(buf.subarray(at + 8, at + 8 + len))
    at += 12 + len
  }
  const raw = inflateSync(Buffer.concat(parts)), stride = w * bpp, px = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[o - stride + x] : 0, c = x >= bpp && y ? px[o - stride + x - bpp] : 0
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      px[o + x] = (src[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255
    }
  }
  return { w, h, at: (x, y) => [...px.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)] }
}
const near = (rgb, want, d = 24) => rgb.every((v, i) => Math.abs(v - want[i]) <= d)

export async function shootPinChecks({ proto, app, local, fail }) {
  // A Settings button opens a panel (marked data-opened-by, as SKILL.md asks); in it, a row whose
  // red Edit button is transparent until the row is hovered. Beside it: a readout whose panel opens
  // while the pointer is on it and closes when it leaves (a green swatch inside, with no data-shoot
  // or words of its own); a row of band dots, of which a fresh page has band 1 only, each opening
  // its card; and a box as tall as the design's saved setting says (localStorage), 40 px without it.
  proto(['add', 'pinfx', '--title', 'Pins', '--variants', 'A:Panel'])
  writeFileSync(join(app, 'src', 'protos', 'pinfx', 'A.tsx'), `import { useState } from 'react'
const grow = (() => { try { return Number(localStorage.getItem('pinfx-grow')) || 40 } catch { return 40 } })()
export default function Panel() {
  const [open, setOpen] = useState(false)
  const [fly, setFly] = useState(false)
  const [band, setBand] = useState(0)
  return <main style={{ padding: 80, minHeight: '100%', background: '#0b0b0f', color: '#fff' }}>
    <style>{'.pinfx-row .pinfx-act { opacity: 0 } .pinfx-row:hover .pinfx-act { opacity: 1 }'}</style>
    <button data-shoot="pinfx-open" onClick={() => setOpen(o => !o)} style={{ width: 120, height: 40 }}>Settings</button>
    {open && <div data-shoot="pinfx-panel" data-opened-by="[data-shoot=pinfx-open]" style={{ marginTop: 16, padding: 24, width: 360, background: '#1f2937', borderRadius: 12 }}>
      <div className="pinfx-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
        <span>Grid</span>
        <button className="pinfx-act" data-shoot="pinfx-act" style={{ width: 96, height: 32, background: '#ff0040', color: '#fff', border: 0 }}>Edit</button>
      </div>
    </div>}
    <div style={{ position: 'absolute', left: 600, top: 80, width: 200 }} onMouseLeave={() => setFly(false)}>
      <div data-shoot="pinfx-readout" onMouseEnter={() => setFly(true)} style={{ width: 120, height: 32, background: '#334155' }}>0.0 dB</div>
      {fly && <div data-shoot="pinfx-flyout" data-opened-by="[data-shoot=pinfx-readout]" style={{ padding: 16, background: '#1f2937' }}>
        <div><div style={{ width: 80, height: 48, background: '#00c040' }} /></div>
      </div>}
    </div>
    <div style={{ position: 'absolute', left: 600, top: 300, display: 'flex', gap: 8 }}>
      {[1].map(i => <button key={i} data-shoot={'pinfx-dot-' + i} onClick={() => setBand(b => b === i ? 0 : i)} style={{ width: 24, height: 24 }}>{i}</button>)}
    </div>
    {band > 0 && <div data-shoot="pinfx-card" data-opened-by={'[data-shoot=pinfx-dot-' + band + ']'} style={{ position: 'absolute', left: 600, top: 340, width: 200, padding: 12, background: '#1f2937' }}>
      <div data-shoot="pinfx-card-title" style={{ width: 120, height: 30, background: '#ffcc00', color: '#000' }}>Band {band}</div>
    </div>}
    <div data-shoot="pinfx-grow" style={{ position: 'absolute', left: 900, top: 80, width: 100, height: grow, background: '#0040ff' }} />
  </main>
}
`)
  const RED = [255, 0, 64], BLUE = [0, 0, 255]
  const ref = `data:image/png;base64,${solidPng(200, 100, BLUE).toString('base64')}`
  const target = extra => ({ label: 'Element', tag: 'button', text: 'Edit', rect: { x: 128, y: 208, w: 96, h: 32 }, route: ['[data-shoot=pinfx-open]'], ...extra })
  const res = await fetch(`${local}__proto/comments`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ viewport: { w: 2124, h: 890, phone: false }, theme: 'dark', comments: [
      { route: 'pinfx/A', text: 'Edit button like this', target: target({ selector: ':scope [data-shoot=pinfx-act]', shoot: 'pinfx-act' }), images: [{ dataUrl: ref, name: 'pasted by the user' }] },
      { route: 'pinfx/A', text: 'Selector gone, data-shoot kept', target: target({ selector: ':scope > nope', shoot: 'pinfx-act' }) },
      { route: 'pinfx/A', text: 'Only its words left', target: target({ selector: ':scope > nope' }) },
      { route: 'pinfx/A', text: 'A decision', action: 'more' },
      // 5: in the hover-opened panel, by a path from the mount that is not its path now.
      { route: 'pinfx/A', text: 'Green swatch', target: { label: 'Element', tag: 'div', text: '', selector: ':scope > main:nth-child(1) > div:nth-child(7) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1)', within: 'pinfx-flyout', rect: { x: 616, y: 128, w: 80, h: 48 }, route: ['[data-shoot=pinfx-readout]'] } },
      // 6: in band 2's card; the page starts with band 1 only.
      { route: 'pinfx/A', text: 'Card title', target: { label: 'Element', tag: 'div', text: 'Band 2', selector: ':scope [data-shoot=pinfx-card-title]', shoot: 'pinfx-card-title', rect: { x: 612, y: 352, w: 120, h: 30 }, route: ['[data-shoot=pinfx-dot-2]'] } },
      // 7: the box as the user had it, 200 tall (their saved setting), in a stage of their size.
      { route: 'pinfx/A', text: 'Tall box', target: { label: 'Element', tag: 'div', text: '', selector: ':scope [data-shoot=pinfx-grow]', shoot: 'pinfx-grow', rect: { x: 900, y: 80, w: 100, h: 200 }, stage: { w: 1500, h: 700 } } },
      // 8: an element of another shape than the one recorded.
      { route: 'pinfx/A', text: 'Wrong shape', target: { label: 'Element', tag: 'div', text: '', selector: ':scope [data-shoot=pinfx-readout]', shoot: 'pinfx-readout', rect: { x: 600, y: 80, w: 32, h: 120 } } },
      // 9: an element taken out since: what it was in is shot.
      { route: 'pinfx/A', text: 'A line that was there', target: { label: 'Element', tag: 'div', text: '', selector: ':scope > main:nth-child(1) > div:nth-child(9) > div:nth-child(2) > div:nth-child(1) > div:nth-child(5)', within: 'pinfx-flyout', rect: { x: 616, y: 128, w: 80, h: 1 }, route: ['[data-shoot=pinfx-readout]'] } },
    ], storage: { 'pinfx-grow': '200' } }),
  })
  const sent = await res.json()
  if (!res.ok || !sent.sent) fail(`shoot --pin: posting the comments answered ${res.status}: ${JSON.stringify(sent)}`)
  const batch = sent.sent
  proto(['inbox'])
  const shots = join(app, '.proto', 'shots'), file = (n, sfx = '') => join(shots, `pin-${batch}-${n}${sfx}.png`)

  // One comment: the panel opened by its control, the button shown by hovering, owner-sized at 2x.
  let t0 = Date.now()
  const one = proto(['shoot', '--pin', `${batch}/1`], { stdout: true })
  const took = (Date.now() - t0) / 1000
  if (!one.includes(`pin ${batch}/1 · pinfx/A · page 2124x890 · dark`)) fail(`shoot --pin should shoot at the batch's page size and theme: ${one}`)
  if (!/opened by: \[data-shoot=pinfx-open\] \((clicked|hovered|clicked in script|pressed in script)\)/.test(one)) fail(`shoot --pin should open the panel through its control: ${one}`)
  if (!/shown by: the pointer on /.test(one)) fail(`shoot --pin should hover the row so its hover-only button shows: ${one}`)
  if (!/element: <button> \[data-shoot=pinfx-act\] "Edit" \(by its selector\)/.test(one)) fail(`shoot --pin should find the element by its selector: ${one}`)
  const box = one.match(/box: (-?\d+),(-?\d+) (\d+)x(\d+) page px/)
  if (!box) fail(`shoot --pin should print the element's box: ${one}`)
  const [bw, bh] = [+box[3], +box[4]]
  if (bw !== 96 || bh !== 32) fail(`the element's box should be 96x32, it is ${bw}x${bh}`)
  if (!/scale: 2x/.test(one)) fail(`shoot --pin should say the scale: ${one}`)
  for (const f of [file(1), file(1, '-context'), file(1, '-vs-ref')]) if (!existsSync(f)) fail(`shoot --pin should write ${f}`)
  const shot = readPng(file(1))
  // The box and 24 px around it, in whole px, at 2 image px per page px.
  if (Math.abs(shot.w - (bw + 48) * 2) > 4 || Math.abs(shot.h - (bh + 48) * 2) > 4) fail(`the shot should be (${bw}+48)x(${bh}+48) at 2x, it is ${shot.w}x${shot.h}`)
  if (!near(shot.at(shot.w >> 1, shot.h >> 1), RED)) fail(`the shot's middle should be the red button (the panel open, the button shown), it is ${shot.at(shot.w >> 1, shot.h >> 1)}`)
  const ctx = readPng(file(1, '-context'))
  if (ctx.w <= shot.w || ctx.h <= shot.h) fail(`the context shot should be wider than the shot: ${ctx.w}x${ctx.h} vs ${shot.w}x${shot.h}`)
  // The sheet: the shot (its red) left of the reference (its blue), at one height.
  const sheet = readPng(file(1, '-vs-ref'))
  const reds = [], blues = []
  for (let y = 0; y < sheet.h; y += 2) for (let x = 0; x < sheet.w; x += 2) {
    const c = sheet.at(x, y)
    if (near(c, RED, 30)) reds.push([x, y]); else if (near(c, BLUE, 30)) blues.push([x, y])
  }
  if (!reds.length || !blues.length) fail(`the vs-ref sheet should hold the shot and the reference: ${reds.length} red, ${blues.length} blue samples`)
  const span = pts => [Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[1]))]
  if (Math.max(...reds.map(p => p[0])) >= Math.min(...blues.map(p => p[0]))) fail('the vs-ref sheet should have the shot left of the reference')
  const [b0, b1] = span(blues)
  if (b1 - b0 < 100) fail(`the reference should be drawn at the shot's height (${shot.h} px), its blue spans ${b1 - b0} px`)

  // The whole batch: every comment on an element, the decision left out, the selector fallbacks named.
  const all = proto(['shoot', '--pin', batch])
  if (!/4 is not on an element/.test(all)) fail(`shoot --pin <batch> should say the decision is not shot: ${all}`)
  if (!/its selector no longer matches; found by its \[data-shoot=pinfx-act\]/.test(all)) fail(`shoot --pin should say it found comment 2 by its data-shoot: ${all}`)
  if (!/its selector no longer matches; found by its words/.test(all)) fail(`shoot --pin should say it found comment 3 by its words: ${all}`)
  for (const n of [2, 3]) if (!existsSync(file(n))) fail(`shoot --pin <batch> should write ${file(n)}`)
  if (existsSync(file(4))) fail('shoot --pin <batch> should not shoot a decision')

  // A panel open only while the pointer is on its control: kept open while its element, found by its
  // path inside the panel, is shot.
  const hov = proto(['shoot', '--pin', `${batch}/5`], { stdout: true })
  if (!/opened by: \[data-shoot=pinfx-readout\] \(hovered\)/.test(hov)) fail(`shoot --pin should open the readout's panel by hovering it: ${hov}`)
  if (!/found by its path inside \[data-shoot=pinfx-flyout\]/.test(hov)) fail(`shoot --pin should find the swatch by its path inside the panel: ${hov}`)
  const sw = readPng(file(5))
  if (!near(sw.at(sw.w >> 1, sw.h >> 1), [0, 192, 64])) fail(`the hover-opened panel's swatch should be in the shot (the panel kept open), the middle is ${sw.at(sw.w >> 1, sw.h >> 1)}`)
  if (/WARNING/.test(hov)) fail(`the swatch has its recorded shape: ${hov}`)
  // A band the user added and the page does not have: the nearest band stands in, and it says so.
  const dot = proto(['shoot', '--pin', `${batch}/6`], { stdout: true })
  if (!/pinfx-dot-2 is not on the page; used pinfx-dot-1, (clicked|hovered|clicked in script|pressed in script)/.test(dot)) fail(`shoot --pin should open band 1's card in place of band 2's, and say so: ${dot}`)
  if (!/stand-in: \[data-shoot=pinfx-dot-2\] is not on this page/.test(dot)) fail(`shoot --pin should say the card is band 1's, not the user's: ${dot}`)
  if (!/element: <div> \[data-shoot=pinfx-card-title\] "Band 1" \(by its selector\)/.test(dot)) fail(`shoot --pin should shoot the card's title: ${dot}`)
  // The design's saved settings and the user's stage, restored.
  const grown = proto(['shoot', '--pin', `${batch}/7`], { stdout: true })
  if (!/its saved settings: 1 localStorage key of the design restored/.test(grown)) fail(`shoot --pin should restore the design's localStorage: ${grown}`)
  if (!/box: \S+ 100x200 page px/.test(grown)) fail(`the box should be 200 tall, as the saved setting says: ${grown}`)
  if (!/stage: \d+x\d+ at the batch's page size, the user's was 1500x700; shot at \d+x\d+ so it is theirs\n/.test(grown)) fail(`shoot --pin should size the window so the stage is the user's 1500x700: ${grown}`)
  // Another shape than the comment's box: said loudly.
  const shape = proto(['shoot', '--pin', `${batch}/8`], { stdout: true })
  if (!/WARNING: its shape is not the one the comment recorded \(32x120 then, 120x32 now/.test(shape)) fail(`shoot --pin should warn when the element has another shape than the one recorded: ${shape}`)
  // Gone: what it was in, said so.
  const gone = proto(['shoot', '--pin', `${batch}/9`], { stdout: true })
  if (!/found by what it was in/.test(gone) || !/NOTE: the element itself is not on the page any more/.test(gone)) fail(`shoot --pin should shoot what a removed element was in, and say so: ${gone}`)

  // A page's own keys (proto-) are never kept as the design's.
  const bad = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ viewport: { w: 1440, h: 900 }, storage: { 'proto-side': '1', a: 'b' }, comments: [{ route: 'pinfx/A', text: 'x', target: target({ selector: ':scope [data-shoot=pinfx-act]', shoot: 'pinfx-act' }) }] }) })
  const badId = (await bad.json()).sent
  const kept = JSON.parse(readFileSync(join(app, '.proto', 'inbox', 'new', badId, 'batch.json'), 'utf8'))
  if (kept.storage) fail(`a batch whose storage has a page key (proto-) should keep none of it: ${JSON.stringify(kept.storage)}`)
  proto(['inbox'])
  proto(['reply', badId, 'checked', '--done'])

  // --margin, and the refusals.
  t0 = Date.now()
  proto(['shoot', '--pin', `${batch}/2`, '--margin', '8', '--hover'])
  const tight = readPng(file(2))
  if (Math.abs(tight.w - (bw + 16) * 2) > 4) fail(`--margin 8 should make the shot (${bw}+16) px wide at 2x, it is ${tight.w}`)
  proto(['shoot', '--pin', `${batch}/4`], { ok: false })
  proto(['shoot', '--pin', `${batch}/99`], { ok: false })
  proto(['shoot', '--pin', `${batch}/1`, '--sheet'], { ok: false })
  proto(['shoot', '--pin', `${batch}/1`, '--state', 'nosuch'], { ok: false })
  proto(['reply', batch, 'checked', '--done'])
  proto(['archive', 'pinfx'])
  console.log(`\nOK: proto shoot --pin shoots a pinned element as its writer saw it (one pin in ${took.toFixed(1)} s)`)
}

// On its own: a session of its own (the project reached directly, not through smoke's link), at
// its long path: on Windows the temp folder can be an 8.3 short name (C:\Users\THEARC~1\…), and a
// session app under one never says it is ready, for any proto shoot.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const skill = dirname(dirname(fileURLToPath(import.meta.url)))
  const project = realpathSync.native(mkdtempSync(join(tmpdir(), 'proto-pin-')))
  const app = join(project, '.prototypes', 'pinchk')
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'proto-pin', private: true, dependencies: { react: '^19.2.0' } }))
  let up = false
  const proto = (args, { ok = true, stdout = false } = {}) => {
    console.log(`\n$ proto ${args.join(' ')}`)
    const r = spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), ...args, '--project', project, '--session', 'pinchk'], { encoding: 'utf8', timeout: 600_000 })
    process.stdout.write(r.stdout || '')
    process.stderr.write(r.stderr || '')
    if (ok && r.status !== 0) fail(`proto ${args[0]} exited ${r.status}`)
    if (!ok && r.status === 0) fail(`proto ${args.join(' ')} should have been refused`)
    return stdout ? r.stdout || '' : (r.stdout || '') + (r.stderr || '')
  }
  const end = () => {
    if (up) spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), 'rm', '--project', project, '--session', 'pinchk'], { stdio: 'ignore', timeout: 60_000 })
    try { rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* temp dir */ }
  }
  function fail(msg) { console.error(`\nFAILED: ${msg}`); end(); process.exit(1) }
  const out = proto(['up', '--name', 'Pins'])
  up = true
  const local = (out.match(/^local (\S+)/m) || out.match(/^url (\S+)/m) || [])[1]
  if (!local) fail(`proto up printed no local URL: ${out}`)
  mkdirSync(join(app, 'src', 'protos'), { recursive: true })
  await shootPinChecks({ proto, app, local, fail })
  end()
}
