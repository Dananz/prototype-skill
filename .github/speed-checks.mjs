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
  proto(['add', 'speedfx', '--title', 'Speed fixtures', '--variants', 'A:Busy,B:Idle,C:Breakpoint'])
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
  return <div data-shoot="root" className="h-full bg-emerald-500 min-[1600px]:bg-rose-500" />
}
`)
  await sleep(1500)

  // proto perf
  const idle = proto(['perf', 'speedfx/B', '--seconds', '2'])
  if (!/\n {2}smooth\n/.test(idle)) fail(`proto perf should call an idle design smooth: ${idle}`)
  const busy = proto(['perf', 'speedfx/A', '--seconds', '2'])
  if (!/drops frames/.test(busy) || /\n {2}smooth\n/.test(busy)) fail(`proto perf should say a design doing 45 ms of work every frame drops frames: ${busy}`)
  proto(['perf', 'speedfx/B', '--drag', '.absent', '--seconds', '1'], { ok: false })
  proto(['perf', 'speedfx/B', '--click', '.absent', '--seconds', '1'], { ok: false })

  // proto compare: the reference is a desktop shot of the same variant (its stage at 1440 x 900)
  proto(['shoot', 'speedfx/C', '--size', '1440x900'])
  const ref = join(app, '.proto', 'shots', 'speedfx-C-1440x900.png')
  const same = proto(['compare', 'speedfx/C', '--ref', ref])
  const pct = s => Number((s.match(/: ([\d.]+)% of pixels off/) || [])[1])
  if (!(pct(same) < 1)) fail(`proto compare should score the variant against its own shot near 0 %: ${same}`)
  const wide = proto(['compare', 'speedfx/C', '--ref', ref, '--size', '2400x1600'])
  if (!(pct(wide) > 50)) fail(`proto compare at a 2400 px layout, past the 1600 px breakpoint, should differ: ${wide}`)
  proto(['compare', 'speedfx/C', '--ref', ref, '--size', '2400'], { ok: false })

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
  const add = async words => {
    const at = await page.run(`(async () => {
      if (!document.querySelector('[data-composer]')) document.querySelector('[data-act="comment:toggle"]').click()
      await new Promise(r => setTimeout(r, 300))
      const r = document.querySelector('[data-layers] [data-mount] [data-shoot=box]').getBoundingClientRect()
      return [r.left + r.width / 2, r.top + r.height / 2]
    })()`)
    await page.press(...at)
    const r = await page.run(`(async () => {
      const until = async (f, ms = 4000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const v = f(); if (v) return v } return null }
      const ed = await until(() => document.querySelector('[data-composer] [role=textbox]'))
      if (!ed) return 'a press on the design opened no composer'
      ed.textContent = ${JSON.stringify(words)}
      ed.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 100))
      ;[...document.querySelectorAll('[data-composer] button')].find(b => /Add/.test(b.textContent)).click()
      return 'ok'
    })()`)
    if (r !== 'ok') fail(`adding a comment: ${r}`)
  }
  const setLive = async on => {
    const r = await page.run(`(async () => {
      const box = document.querySelector('[data-shoot=send-live] input')
      if (!box) return 'no Send each comment as you add it switch under Send'
      if (box.checked !== ${on}) box.click()
      await new Promise(r => setTimeout(r, 100))
      return box.checked === ${on} ? 'ok' : 'the switch did not turn ' + (${on} ? 'on' : 'off')
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
  await add('Live two')
  await add('Live three')
  const both = await waitFor(/Live three/)
  const two = both + (/Live two/.test(both) ? '' : await waitFor(/Live two/, 3000))
  if (!/Live two/.test(two) || !/Live three/.test(both + two)) fail(`two comments added back to back should both arrive: ${both}${two}`)
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
