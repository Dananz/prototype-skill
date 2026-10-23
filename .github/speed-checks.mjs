// The speed commands and the batch path, end to end on the smoke session:
// - proto perf: an idle design reads smooth, one busy on every frame reads as dropping frames (the
//   budget is the screen's, not the design's own), and a --drag that matches nothing fails;
// - proto compare: the same layout scores near 0 % at the reference's width, and a wider --size
//   that crosses a breakpoint does not;
// - a batch on two variants: proto ask --to … --each files each ask under its own variant, the
//   inbox prints the source around a comment's line, and one proto reply answers both;
// - Send each comment as you add it: a comment reaches the inbox on Add with no Send, two added
//   back to back both arrive, and with the switch off a comment waits for Send.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

// A solid w x h PNG of one colour: the reference for a box whose colour is known exactly.
function solidPng(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))])
}

export async function speedChecks({ proto, app, openPage, fail }) {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  // The session's own address now: a check before this one may have restarted the server elsewhere.
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  // One retry on a reset: fetch reuses a pooled keep-alive connection the server may just have
  // closed after the checks before this one (ECONNRESET, before the request is read).
  const post = (path, body) => fetch(`${local}__proto/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const postJson = (path, body) => post(path, body)
    .catch(e => e.cause?.code === 'ECONNRESET' ? post(path, body) : Promise.reject(e))
    .catch(e => fail(`posting to ${local}__proto/${path}: ${e.message} (${e.cause?.code || ''} ${e.cause?.message || ''})`))
  const dir = join(app, 'src', 'protos', 'speedfx')
  proto(['add', 'speedfx', '--title', 'Speed fixtures', '--variants', 'A:Busy,B:Idle,C:Breakpoint,D:Touch,E:Click'])
  writeFileSync(join(dir, 'A.tsx'), `import { useEffect, useState } from 'react'
export default function Busy() {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf = 0
    const f = () => { const end = performance.now() + 45; while (performance.now() < end) {} setN(v => v + 1); raf = requestAnimationFrame(f) }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <div data-shoot="box" className="grid h-full place-items-center">frame {n}</div>
}
`)
  writeFileSync(join(dir, 'B.tsx'), `export default function Idle() {
  return <div className="grid h-full place-items-center"><h1 data-shoot="box" className="text-4xl font-semibold">Idle</h1></div>
}
`)
  writeFileSync(join(dir, 'C.tsx'), `export default function Breakpoint() {
  return (
    <div className="grid h-full place-items-center">
      <style>{'.bp { width: 320px; height: 160px; background: #10b981 } @media (min-width: 1600px) { .bp { background: #f43f5e } }'}</style>
      <div data-shoot="box" className="bp" />
    </div>
  )
}
`)
  writeFileSync(join(dir, 'D.tsx'), `export default function Touch() {
  return (
    <div className="grid h-full place-items-center">
      <style>{'.tp { width: 200px; height: 100px; background: #f43f5e } @media (pointer: coarse) { .tp { background: #10b981 } }'}</style>
      <div data-shoot="box" className="tp" />
    </div>
  )
}
`)
  // A box that turns from green to red when clicked: what --click reaches is what is measured.
  writeFileSync(join(dir, 'E.tsx'), `import { useState } from 'react'
export default function Click() {
  const [on, setOn] = useState(false)
  return (
    <div className="grid h-full place-items-center">
      <button data-shoot="box" onClick={() => setOn(true)} style={{ width: 200, height: 100, border: 0, background: on ? '#f43f5e' : '#10b981' }} />
    </div>
  )
}
`)
  await sleep(1500)

  // proto perf
  // Absolute rates depend on the machine (a CI runner can draw an idle page at 21 fps against a
  // 60 Hz screen), so the busy design is judged against the idle one measured on the same machine.
  const fpsOf = out => Number((out.match(/^ {2}([\d.]+) fps/m) || [])[1])
  const idle = proto(['perf', 'speedfx/B', '--seconds', '2'])
  const busy = proto(['perf', 'speedfx/A', '--seconds', '2'])
  if (!/drops frames/.test(busy) || /\n {2}smooth\n/.test(busy)) fail(`proto perf should say a design doing 45 ms of work every frame drops frames: ${busy}`)
  if (!(fpsOf(busy) < 0.7 * fpsOf(idle))) fail(`proto perf should measure the busy design well below the idle one: ${fpsOf(busy)} vs ${fpsOf(idle)} fps`)
  proto(['perf', 'speedfx/B', '--drag', '.absent', '--seconds', '1'], { ok: false })
  proto(['perf', 'speedfx/B', '--click', '.absent', '--seconds', '1'], { ok: false })

  // proto compare: the box is a known colour below the 1600 px breakpoint, so its reference is
  // that colour, drawn here; past the breakpoint it turns another.
  const ref = join(app, '.proto', 'speedfx-box-ref.png')
  writeFileSync(ref, solidPng(320, 160, [0x10, 0xb9, 0x81]))
  const same = proto(['compare', 'speedfx/C', '--ref', ref, '--el', '[data-shoot=box]'])
  const pct = s => Number((s.match(/: ([\d.]+)% of pixels off/) || [])[1])
  if (!(pct(same) < 1)) fail(`proto compare at the reference's width should score the box near 0 %: ${same}`)
  const wide = proto(['compare', 'speedfx/C', '--ref', ref, '--el', '[data-shoot=box]', '--size', '2400x1600'])
  if (!(pct(wide) > 50)) fail(`proto compare at a 2400 px layout, past the 1600 px breakpoint, should differ: ${wide}`)
  proto(['compare', 'speedfx/C', '--ref', ref, '--size', '2400'], { ok: false })
  // At a phone's size compare is a touch device, as shoot's phone shots are: the box is the
  // (pointer: coarse) colour.
  const touchRef = join(app, '.proto', 'speedfx-touch-ref.png')
  writeFileSync(touchRef, solidPng(200, 100, [0x10, 0xb9, 0x81]))
  const phone = proto(['compare', 'speedfx/D', '--ref', touchRef, '--el', '[data-shoot=box]', '--size', '390x844'])
  if (!(pct(phone) < 1)) fail(`proto compare at a phone's size should be a touch device, as proto shoot is ((pointer: coarse)): ${phone}`)
  // --click reaches the design that shows (not a copy behind the page's artboard frame), so the
  // clicked box is the one captured.
  const redRef = join(app, '.proto', 'speedfx-red-ref.png')
  writeFileSync(redRef, solidPng(200, 100, [0xf4, 0x3f, 0x5e]))
  const clicked = proto(['compare', 'speedfx/E', '--ref', redRef, '--el', '[data-shoot=box]', '--click', '[data-shoot=box]'])
  if (!(pct(clicked) < 1)) fail(`proto compare --click should capture the clicked design (the box turns red): ${clicked}`)

  // A batch on two variants: grouped asks, the source in the inbox, one reply call
  const sent = await postJson('comments', { theme: 'light', viewport: { w: 1440, h: 900, phone: false }, comments: [
    { route: 'speedfx/A', text: 'Slower please', target: { label: 'Box', selector: ':scope', shoot: 'box', src: 'speedfx/A.tsx:10', component: 'Busy', tag: 'div', text: '', rect: { x: 0, y: 0, w: 10, h: 10 } } },
    { route: 'speedfx/B', text: 'Bigger heading' },
  ] })
  if (!sent.ok) fail(`a batch on two variants was refused: ${sent.status}`)
  const heard = proto(['inbox'], { stdout: true })
  const batch = (heard.match(/^batch (\S+)/m) || [])[1]
  if (!batch) fail(`proto inbox should hand out the batch: ${heard}`)
  if (!/^ {3}> +10\| /m.test(heard)) fail(`proto inbox should print the source around the comment's line, marked: ${heard}`)
  const before = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).asks || {}
  proto(['ask', '--to', 'speedfx/A', '--each', 'Slower please'])
  proto(['ask', '--to', 'speedfx/B', '--each', 'Bigger heading', 'And bolder'])
  const asks = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).asks || {}
  const grew = k => (asks[k]?.length || 0) - (before[k]?.length || 0)
  if (grew('speedfx/A') !== 1 || grew('speedfx/B') !== 2) fail(`proto ask --to … --each should file each ask under its own variant: A +${grew('speedfx/A')}, B +${grew('speedfx/B')}`)
  const replied = proto(['reply', batch, '1', 'Slowed to 30 fps', '2', 'Heading is 48 px', '--done'])
  if (!/replied to 1, 2, done \(batch done\)/.test(replied)) fail(`proto reply <batch> 1 "…" 2 "…" --done should answer both: ${replied}`)
  const b = JSON.parse(readFileSync(join(app, '.proto', 'inbox', 'taken', batch, 'batch.json'), 'utf8'))
  if (b.comments[0].reply?.text !== 'Slowed to 30 fps' || b.comments[1].reply?.text !== 'Heading is 48 px' || !b.done) fail(`the paired replies were not written: ${JSON.stringify(b.comments.map(c => c.reply))}`)

  // Send each comment as you add it
  const page = await openPage(`${local}?theme=light#/speedfx/B`)
  const until = 'const until = async (f, ms = 4000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const v = f(); if (v) return v } return null }'
  const add = async words => {
    // Comment mode on (its button says so), then a press on the box; a press that lands before the
    // page is listening opens nothing, so it is tried again.
    let opened = false
    for (let i = 0; i < 4 && !opened; i++) {
      const at = await page.run(`(async () => {
        ${until}
        const t = document.querySelector('[data-act="comment:toggle"]')
        if (!document.querySelector('[data-composer]') && t.getAttribute('aria-pressed') !== 'true') t.click()
        if (!await until(() => document.querySelector('[data-act="comment:toggle"]').getAttribute('aria-pressed') === 'true')) return null
        const el = document.querySelector('[data-layers] [data-mount] [data-shoot=box]')
        el.scrollIntoView({ block: 'center' })
        await new Promise(r => setTimeout(r, 200))
        const r = el.getBoundingClientRect()
        return [r.left + r.width / 2, r.top + r.height / 2]
      })()`)
      if (!at) continue
      await page.press(...at)
      opened = await page.run(`(async () => { ${until}; return !!await until(() => document.querySelector('[data-composer] [role=textbox]'), 2500) })()`)
    }
    if (!opened) fail('adding a comment: comment mode on and a press on the design, four times, opened no composer')
    const r = await page.run(`(async () => {
      ${until}
      const ed = await until(() => document.querySelector('[data-composer] [role=textbox]'))
      if (!ed) return 'the composer went away'
      ed.textContent = ${JSON.stringify(words)}
      ed.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 100))
      document.querySelector('[data-composer] [data-shoot=composer-add]').click()
      return 'ok'
    })()`)
    if (r !== 'ok') fail(`adding a comment: ${r}`)
  }
  const setLive = async on => {
    const r = await page.run(`(async () => {
      document.querySelector('[data-bar] [data-act="open:more"][aria-expanded="false"]')?.click()
      document.querySelector('[data-bar] [data-act="settings"]').click()
      for (let i = 0; i < 60 && !document.querySelector('[data-settings-category=feedback]'); i++) await new Promise(r => setTimeout(r, 25))
      document.querySelector('[data-settings-category=feedback]')?.click()
      for (let i = 0; i < 60 && !document.querySelector('[data-shoot=send-live] input'); i++) await new Promise(r => setTimeout(r, 25))
      const box = document.querySelector('[data-shoot=send-live] input')
      if (!box) return 'no Send each comment as you add it switch in Settings'
      if (box.checked !== ${on}) box.click()
      await new Promise(r => setTimeout(r, 100))
      const ok = box.checked === ${on}
      document.querySelector('[data-settings-close]').click()
      for (let i = 0; i < 60 && document.querySelector('[data-settings-dialog]'); i++) await new Promise(r => setTimeout(r, 25))
      return ok ? 'ok' : 'the switch did not turn ' + (${on} ? 'on' : 'off')
    })()`)
    if (r !== 'ok') fail(`the live switch: ${r}`)
  }
  const waitFor = async (re, ms = 10_000) => {
    let got = ''
    for (const end = Date.now() + ms; Date.now() < end && !re.test(got); await sleep(250)) got += proto(['inbox'], { stdout: true })
    return got
  }
  await setLive(true)
  await add('Live one')
  const one = await waitFor(/Live one/)
  if (!/Live one/.test(one)) fail('with Send each comment as you add it on, a comment should reach the inbox on Add, with no Send')
  // A comment added while the last one is still on its way follows once that send lands: the page's
  // sends are held 1.5 s here, and the second is added inside that window.
  await page.run(`(() => { const f = window.fetch; window.__held = 0
    window.fetch = (u, o) => /__proto\\/comments/.test(String(u)) && o?.method === 'POST' ? (window.__held++, new Promise(r => setTimeout(r, 1500)).then(() => f(u, o))) : f(u, o) })()`)
  await add('Live two')
  const heldNow = await page.run('window.__held')
  await add('Live three')
  const inFlight = await page.run('window.__held')
  if (heldNow !== 1 || inFlight !== 1) fail(`the second comment should be added while the first send is still held (sends started: ${heldNow}, then ${inFlight})`)
  const both = await waitFor(/Live three/)
  const got = both + (/Live two/.test(both) ? '' : await waitFor(/Live two/, 3000))
  if (!/Live two/.test(got) || !/Live three/.test(got)) fail(`a comment added during a send should follow it: ${got}`)
  if ((await page.run('window.__held')) !== 2) fail('the comment added during a send should go in a send of its own, after the first lands')
  await setLive(false)
  await add('Held for Send')
  await sleep(2500)
  if (/Held for Send/.test(proto(['inbox'], { stdout: true }))) fail('with the switch off, a comment should wait for Send')
  const r = await page.run(`(() => { const s = document.querySelector('[data-shoot=send]'); if (!s || s.disabled) return 'Send should be ready with one comment waiting'; s.click(); return 'ok' })()`)
  if (r !== 'ok') fail(`the switch off: ${r}`)
  if (!/Held for Send/.test(await waitFor(/Held for Send/))) fail('the comment held with the switch off should arrive on Send')
  page.close()
  proto(['archive', 'speedfx'])
  console.log('\nOK: proto perf, proto compare, a batch on two variants, and Send each comment as you add it')
}
