// Share links, part 4: comments in the viewer, against a real host under wrangler dev on a port of
// its own (never the owner's 8787), with its own state folder and a fake GitHub. Signed out, the
// bar's comment row is "Sign in with GitHub to comment", which goes through the host's whole
// sign-in. Signed in: a comment on the whole design from the bar's field, a pinned one placed in
// the full view's pin mode (the design does not get the click), both still there after a reload
// and the pin on its element at another device size and on the desk; the owner's status and reply
// come back by the poll; the viewer deletes their own while it is new; a comment over the cap is
// refused with the host's reason and the words stay; viewer text is text. Then the same on a phone.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { startFakeGitHub } from './fake-github.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(get, ms = 10_000) {
  for (const end = Date.now() + ms; ; await sleep(100)) {
    const v = await get()
    if (v || Date.now() > end) return v
  }
}
// A port nobody listens on, from 8796 to 8799 (8787 is the owner's host; others may be in use).
const free = port => new Promise(ok => { const s = createServer().once('error', () => ok(false)).listen(port, '127.0.0.1', () => s.close(() => ok(true))) })

export async function shareCommentsChecks({ app, openPage, fail, buildShare, tools }) {
  const protos = join(app, 'src/protos')
  const cFile = join(protos, 'share-link/C.tsx'), cBefore = readFileSync(cFile, 'utf8')
  // C gets a button that counts its clicks (pin mode must keep them from it), placed lower on a
  // wide screen than on a phone, so a pin has to follow it.
  writeFileSync(cFile, cBefore.replace('<h1>MARK-C</h1>', '<h1>MARK-C</h1><div className="h-10 md:h-72" /><button data-count onClick={() => { document.body.dataset.clicks = String(Number(document.body.dataset.clicks || 0) + 1) }} style={{ fontSize: 40, padding: 24 }}>COUNT-ME</button>'))
  let html
  try {
    html = (await buildShare({ sessionDir: app, scope: { protos: [{ id: 'share-link', variants: ['B', 'C'] }], start: 'share-link/C' }, info: { title: 'Comments smoke', owner: 'Smoke', version: 1 } })).html
  } catch (e) { fail(`share comments: buildShare threw: ${e?.stack || e}`) } finally { writeFileSync(cFile, cBefore) }

  let port = 0
  for (const p of [8796, 8797, 8798, 8799]) if (await free(p)) { port = p; break }
  if (!port) fail('share comments: no free port from 8796 to 8799')
  const W = join(tools, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  const dir = mkdtempSync(join(tmpdir(), 'proto-share-comments-')), state = join(dir, 'state'), cfg = join(dir, 'wrangler.jsonc')
  const hostDir = new URL('../host/', import.meta.url).pathname
  writeFileSync(cfg, JSON.stringify({ name: 'proto-share-comments-smoke', main: join(hostDir, 'worker.mjs'), compatibility_date: '2026-10-01', kv_namespaces: [{ binding: 'KV', id: 'k' }], d1_databases: [{ binding: 'DB', database_name: 'proto-share', database_id: 'd' }], vars: { BASE: `localhost:${port}`, PATH_MODE: '0' } }))
  const gh = await startFakeGitHub()
  writeFileSync(join(dir, '.dev.vars'), `GITHUB_CLIENT_ID=${gh.clientId}\nGITHUB_CLIENT_SECRET=${gh.clientSecret}\nVIEWER_KEY=k-${randomUUID()}\nGITHUB_OAUTH=${gh.url}\nGITHUB_API=${gh.url}\n`)
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
  const d1 = args => { const r = spawnSync(process.execPath, [W, 'd1', 'execute', 'DB', '--local', '--persist-to', state, '-c', cfg, ...args], { cwd: dir, env, encoding: 'utf8' }); if (r.status) fail(`share comments: d1 execute: ${r.stderr || r.stdout}`) }
  d1(['--file', join(hostDir, 'schema.sql')])
  const TOKEN = 'tok-' + randomUUID()
  d1(['--command', `INSERT INTO owners (id, name, created_at) VALUES ('o1','Smoke',1); INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES ('${createHash('sha256').update(TOKEN).digest('hex')}','o1','t',1)`])
  const child = spawn(process.execPath, [W, 'dev', '-c', cfg, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0', '--persist-to', state, '--show-interactive-dev-session=false'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', d => { log += d }); child.stderr.on('data', d => { log += d })
  const cleanup = () => { try { child.kill('SIGINT') } catch { /* gone */ } gh.close(); try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp */ } }
  process.once('exit', cleanup)
  const assert = (ok, why) => { if (!ok) { console.log(log.slice(-2000)); cleanup(); fail(`share comments: ${why}`) } }

  try {
    const origin = `http://127.0.0.1:${port}`
    assert(await until(async () => { try { return (await fetch(`${origin}/_health`)).ok } catch { return false } }, 60_000), `the host on ${port} did not start`)
    const A = { authorization: `Bearer ${TOKEN}` }
    const { id } = await (await fetch(`${origin}/api/shares`, { method: 'POST', headers: A })).json()
    const meta = Buffer.from(JSON.stringify({ title: 'Comments smoke', session: 'smoke', projectLabel: 'smoke', lang: 'en', scope: { protos: [{ id: 'share-link', variants: ['B', 'C'] }], start: 'share-link/C' } })).toString('base64url')
    assert((await fetch(`${origin}/api/shares/${id}`, { method: 'PUT', headers: { ...A, 'x-share-meta': meta }, body: gzipSync(html) })).status === 200, 'publish failed')
    const link = `${origin}/s/${id}/`
    const owned = async () => (await (await fetch(`${origin}/api/owner/comments`, { headers: A })).json()).comments
    const patch = (cid, body) => fetch(`${origin}/api/owner/comments/${cid}`, { method: 'PATCH', headers: { ...A, 'content-type': 'application/json' }, body: JSON.stringify(body) })

    const page = await openPage(link, { errors: true })
    try {
      const at = sel => page.run(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null })()`)
      const fill = (sel, text) => page.run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      const cards = () => page.run(`[...document.querySelectorAll('[data-comment-card]')].map(c => c.querySelector('[data-comment-body]')?.textContent ?? '')`)
      // Every POST the page makes, with its start and end in the page's clock, so a slow run shows
      // whether the time went in the page or on the host. __dropNext: the next POST reaches the host
      // and its answer is lost on the way back (the page sees a network error).
      const trace = () => page.run(`(() => { if (window.__posts) return true; window.__posts = []; const f = window.fetch.bind(window); window.fetch = async (u, i) => { if (!i || i.method !== 'POST') return f(u, i); const e = { url: String(u).replace(/^.*\\/api\\//, 'api/'), start: Math.round(performance.now()) }; window.__posts.push(e); try { const r = await f(u, i); e.end = Math.round(performance.now()); e.status = r.status; if (window.__dropNext) { window.__dropNext = false; e.dropped = true; throw new TypeError('Failed to fetch') } return r } catch (x) { e.end = e.end ?? Math.round(performance.now()); e.error = String(x); throw x } }; return true })()`)
      const posts = () => page.run(`JSON.stringify(window.__posts || [])`)

      // Signed out: the bar's comment row asks for GitHub, and goes through the host's sign-in.
      const signin = await until(() => page.run(`document.querySelector('[data-viewer-bar] [data-comment-signin]')?.textContent ?? ''`), 8000)
      assert(signin.includes('Sign in with GitHub to comment'), `signed out: the bar's comment row reads ${JSON.stringify(signin)}`)
      assert(await page.run(`!document.querySelector('[data-comment-field]')`), 'signed out: the comment field is there')
      await page.press(...await at('[data-comment-signin]'))
      const who = await until(() => page.run(`document.querySelector('[data-account]')?.textContent ?? ''`), 15_000)
      assert(who?.includes('dana-test'), `sign in: after the round trip the header shows ${JSON.stringify(who)}`)
      await trace()
      assert(await until(() => page.run(`!!document.querySelector('[data-comment-field]')`), 5000), 'signed in: no comment field in the bar')

      // A comment on the whole design, from the bar's field. Its words are text, never markup.
      await page.press(...await at('[data-comment-field]'))
      assert(await until(() => page.run(`document.querySelector('[data-viewer-bar]')?.hasAttribute('data-open')`), 3000), 'whole comment: the field did not grow the bar into the comments')
      const told = await page.run(`document.querySelector('[data-told]')?.textContent ?? ''`)
      assert(told.includes('Everyone with this link sees your name and comments.'), `first comment: the bar does not say who sees it (${JSON.stringify(told)})`)
      const markup = 'WHOLE-NOTE <img src=x onerror="document.body.dataset.xss=1">'
      await fill('[data-comment-field]', markup)
      await page.key('Enter')
      assert(await until(async () => (await cards()).includes(markup), 5000), `whole comment: the list shows ${JSON.stringify(await cards())}`)
      await sleep(800)
      assert(await page.run(`!document.querySelector('[data-comment-card] img:not([data-face])') && !document.body.dataset.xss`), 'viewer text: a comment body became markup')
      let mine = await owned()
      const whole = mine.find(c => c.body === markup)
      assert(whole && whole.target === null && whole.variant === 'share-link/C' && whole.status === 'new', `whole comment: the host has ${JSON.stringify(mine)}`)
      assert(!await page.run(`!!document.querySelector('[data-told]')`), 'first comment: the note shows again after the first comment')

      // Esc folds the grown bar.
      await page.run(`document.activeElement?.blur()`)
      await page.key('Escape')
      assert(await until(() => page.run(`!document.querySelector('[data-viewer-bar]')?.hasAttribute('data-open')`), 2000), 'Esc did not fold the comments')

      // Full view: the Comment toggle (here the C key) turns pin mode on; the element under the
      // pointer is outlined; a click places a pin there, the design never gets it, and the composer opens.
      await page.press(...await at('[data-board="share-link/C"] [data-frame]'))
      const frameReady = () => page.run(`document.querySelector('[data-full] iframe')?.contentDocument?.documentElement.dataset.ready === '1'`)
      assert(await until(frameReady, 8000), 'full view: the design did not open')
      await sleep(600)
      // Where an element of the design is on the page: the frame's box, its zoom, the element's box in it.
      const inFrame = sel => page.run(`(() => { const f = document.querySelector('[data-full] iframe'); const el = f?.contentDocument?.querySelector(${JSON.stringify(sel)}); if (!el) return null; const o = f.getBoundingClientRect(), z = o.width / f.offsetWidth, r = el.getBoundingClientRect(); return [o.left + r.left * z, o.top + r.top * z, r.width * z, r.height * z] })()`)
      let btn = await inFrame('[data-count]')
      assert(btn, 'full view: no COUNT-ME button in the design')
      await page.run(`document.activeElement?.blur(); document.body.focus()`)
      await page.key('c')
      assert(await until(() => page.run(`!!document.querySelector('[data-pin-mode]') && document.querySelector('[data-pin-toggle]')?.getAttribute('aria-pressed') === 'true'`), 3000), 'pin mode: C did not turn it on')
      // A key in the design does nothing there in pin mode: Enter on its focused button neither clicks it nor pins.
      await page.run(`(() => { const f = document.querySelector('[data-full] iframe'); f.contentWindow.focus(); f.contentDocument.querySelector('[data-count]').focus(); return true })()`)
      await page.key('Enter')
      await sleep(300)
      assert(await page.run(`!document.querySelector('[data-full] iframe').contentDocument.body.dataset.clicks && !document.querySelector('[data-pin-composer]')`), 'pin mode: Enter on a focused button in the design clicked it, or placed a pin')
      await page.hover(btn[0] + btn[2] / 2, btn[1] + btn[3] / 2)
      await sleep(250)
      const outline = await page.run(`(() => { const r = document.querySelector('[data-pin-outline]')?.getBoundingClientRect(); return r ? [r.left, r.top, r.width, r.height] : null })()`)
      assert(outline && Math.abs(outline[0] - btn[0]) < 4 && Math.abs(outline[2] - btn[2]) < 6, `pin mode: the outline is ${JSON.stringify(outline)}, the button ${JSON.stringify(btn)}`)
      await page.press(btn[0] + btn[2] * 0.25, btn[1] + btn[3] * 0.5)
      assert(await until(() => page.run(`!!document.querySelector('[data-pin-composer] textarea')`), 3000), 'pin mode: a click did not open the composer at the pin')
      assert(await page.run(`!document.querySelector('[data-full] iframe').contentDocument.body.dataset.clicks`), 'pin mode: the design got the click')
      assert(await page.run(`document.querySelectorAll('[data-pin-composer]').length === 1 && document.querySelectorAll('[data-pin-new]').length === 1`), 'pin mode: the pin being written shows more than once (the desk under the full view too)')
      await fill('[data-pin-composer] textarea', 'PINNED-NOTE')
      await page.key('Enter')
      assert(await until(async () => (await owned()).some(c => c.body === 'PINNED-NOTE'), 12_000), `pinned comment: the host never got it (posts ${await posts()}; composer: ${await page.run(`JSON.stringify([document.querySelector('[data-pin-composer] textarea')?.value, document.querySelector('[data-pin-composer] [data-comment-error]')?.textContent, document.activeElement?.tagName, document.querySelector('[data-pin-composer] button:last-child')?.disabled, [...document.querySelectorAll('[data-comment-card] [data-comment-body]')].map(e => e.textContent)])`)})`)
      mine = await owned()
      const pinned = mine.find(c => c.body === 'PINNED-NOTE')
      const t = pinned.target
      assert(t && /^share-link\/C\.tsx:\d+$/.test(t.src || '') && typeof t.path === 'string' && t.path.length > 0 && t.x > 15 && t.x < 35 && t.y > 30 && t.y < 70
        && t.view?.size === 'desktop' && t.view.w === 1440 && t.view.h === 900, `pinned comment: the target is ${JSON.stringify(t)}`)
      // The pin's tip is on the button.
      const pinIn = async (pin, box) => {
        // The pin's tip: its bottom, or its top when it hangs below the point.
        const p = await page.run(`(() => { const el = document.querySelector(${JSON.stringify(pin)}), r = el?.getBoundingClientRect(); return r && r.width ? [r.left + r.width / 2, el.className.includes('rounded-tl-none') ? r.top : r.bottom] : null })()`)
        return !!p && !!box && p[0] >= box[0] - 2 && p[0] <= box[0] + box[2] + 2 && p[1] >= box[1] - 2 && p[1] <= box[1] + box[3] + 2 ? p : null
      }
      assert(await until(() => pinIn(`[data-full] [data-pin="${pinned.id}"]`, btn), 3000), 'pinned comment: its pin in the full view is not on the button')
      assert(await until(() => page.run(`!document.querySelector('[data-pin-composer]')`), 3000), 'pinned comment: the composer stayed open after the host took it')
      await page.key('Escape')
      assert(await until(() => page.run(`!document.querySelector('[data-pin-mode]')`), 2000) && await page.run(`!!document.querySelector('[data-full]')`), 'pin mode: Esc did not leave pin mode alone (or left the full view)')

      // After a reload: the pin on the desk's preview and in the full view, and on a phone's layout.
      console.log(`share comments: POSTs so far ${await posts()}`)
      // A pin whose element is gone (another design version): drawn dimmed, and its card says so.
      const gone = await page.run(`fetch('api/comments', { method: 'POST', headers: { 'X-Proto': '1', 'content-type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), variant: 'share-link/C', body: 'GONE-SPOT', target: { src: 'share-link/C.tsx:9999', path: ':scope > div:nth-child(42)', x: 50, y: 50, view: { size: 'desktop', w: 1440, h: 900 } } }) }).then(r => r.json()).then(c => c.id)`)
      await page.run(`location.reload()`)
      await sleep(500)
      assert(await until(() => page.run(`document.documentElement.dataset.ready === '1' && !!document.querySelector('[data-comment-field]')`), 15_000), 'reload: the viewer did not come back signed in')
      await trace()
      const badge = await until(() => page.run(`document.querySelector('[data-board="share-link/C"] [data-count-badge]')?.textContent ?? ''`), 5000)
      assert(badge.includes('3'), `desk: the label's count badge reads ${JSON.stringify(badge)}`)
      const deskBtn = await page.run(`(() => { const r = document.querySelector('[data-board="share-link/C"] [data-count]')?.getBoundingClientRect(); return r ? [r.left, r.top, r.width, r.height] : null })()`)
      assert(await until(() => pinIn(`[data-board="share-link/C"] [data-pin="${pinned.id}"]`, deskBtn), 5000), `desk: the pin is not on the button in the preview (${JSON.stringify(deskBtn)})`)
      assert(await until(() => page.run(`!!document.querySelector('[data-board="share-link/C"] [data-pin="${gone}"][data-pin-lost]')`), 5000), 'lost pin: a pin whose element is gone is not drawn as lost')
      await page.press(...await at('[data-comments-toggle]'))
      const lostLine = await until(() => page.run(`document.querySelector('[data-comment-card="${gone}"] [data-lost]')?.textContent ?? ''`), 3000)
      assert(lostLine === 'The spot changed', `lost pin: its card reads ${JSON.stringify(lostLine)}`)
      await page.key('Escape')
      await sleep(400)
      await page.press(...await at('[data-board="share-link/C"] [data-frame]'))
      assert(await until(frameReady, 8000), 'reload: the design did not open')
      await sleep(600)
      btn = await inFrame('[data-count]')
      assert(await until(() => pinIn(`[data-full] [data-pin="${pinned.id}"]`, btn), 4000), 'reload: the pin in the full view is not on the button')
      await page.press(...await at('[data-viewer-bar] [data-device]'))
      const row = await until(() => at('[data-size="phone"]'), 3000)
      await page.press(...row)
      assert(await until(async () => (await page.run(`document.querySelector('[data-full] iframe')?.contentWindow.innerWidth`)) === 390, 4000), 'phone size: the frame is not 390 wide')
      await sleep(600)
      const phoneBtn = await inFrame('[data-count]')
      assert(phoneBtn && Math.abs(phoneBtn[1] - btn[1]) > 20, `phone size: the button did not move (${JSON.stringify(btn)} → ${JSON.stringify(phoneBtn)}), so the check proves nothing`)
      assert(await until(() => pinIn(`[data-full] [data-pin="${pinned.id}"]`, phoneBtn), 4000), 'phone size: the pin did not follow the button')

      // The owner's status and reply come back with the poll.
      assert((await patch(pinned.id, { status: 'sent' })).status === 200 && (await patch(pinned.id, { status: 'working', reply: 'OWNER-REPLY' })).status === 200, 'owner PATCH failed')
      await page.run(`window.dispatchEvent(new Event('focus'))`)
      await page.press(...await at('[data-comments-toggle]'))
      const card = sel => page.run(`document.querySelector('[data-comment-card="${pinned.id}"] ${sel}')?.textContent ?? ''`)
      assert(await until(async () => (await card('[data-status]')) === 'In progress', 5000), `status: the pinned comment reads ${JSON.stringify(await card('[data-status]'))}`)
      assert((await card('[data-owner-reply]')).includes('OWNER-REPLY'), `status: the owner's reply reads ${JSON.stringify(await card('[data-owner-reply]'))}`)
      assert(await page.run(`!document.querySelector('[data-comment-card="${pinned.id}"] [data-delete]')`), 'delete: a sent comment offers Delete')

      // Esc with the comments open folds them and stays in the full view.
      await page.key('Escape')
      assert(await until(() => page.run(`!document.querySelector('[data-viewer-bar]')?.hasAttribute('data-open')`), 2000) && await page.run(`!!document.querySelector('[data-full]')`), 'Esc: with the comments open it did not only fold them')

      // Delete own while new.
      await page.press(...await at('[data-viewer-bar] [data-back]'))
      await until(() => page.run(`!document.querySelector('[data-full]')`), 3000)
      await page.press(...await at('[data-comments-toggle]'))
      await sleep(500) // the bar grows for 230 ms: the button moves until it has
      const del = await until(() => at(`[data-comment-card="${whole.id}"] [data-delete]`), 3000)
      assert(del, 'delete: the new comment offers no Delete')
      await page.press(...del)
      assert(await until(async () => !(await cards()).includes(markup), 3000), 'delete: the comment is still listed')
      assert(await until(async () => (await owned()).find(c => c.id === whole.id)?.deleted === true, 3000), 'delete: the host did not delete it')

      // Over the cap: the host's reason, and the words stay in the field.
      const long = 'L'.repeat(4001)
      await fill('[data-comment-field]', long)
      await page.key('Enter')
      const err = await until(() => page.run(`document.querySelector('[data-comment-error]')?.textContent ?? ''`), 5000)
      assert(err.includes('at most 4,000 characters'), `caps: the message reads ${JSON.stringify(err)}`)
      assert(await page.run(`document.querySelector('[data-comment-field]').value.length`) === 4001, 'caps: the refused words left the field')

      // The answer lost on the way back: the comment stays, not sent, with Retry; Retry sends the same
      // id, and the host has it once.
      await page.run(`window.__dropNext = true`)
      await fill('[data-comment-field]', 'RETRY-NOTE')
      await page.key('Enter')
      const notSent = await until(() => page.run(`(() => { const c = [...document.querySelectorAll('[data-comment-card]')].find(c => c.querySelector('[data-comment-body]')?.textContent === 'RETRY-NOTE'); return c && c.querySelector('[data-retry]') ? c.dataset.commentCard : '' })()`), 5000)
      assert(notSent && await page.run(`document.querySelector('[data-comment-card="${notSent}"] [data-status]')?.textContent`) === 'Not sent', `lost answer: the comment is not kept as not sent with Retry (posts ${await posts()})`)
      await sleep(700) // the list follows a new comment down (smooth): the button moves until it has
      await page.press(...await at(`[data-comment-card="${notSent}"] [data-retry]`))
      assert(await until(async () => (await page.run(`document.querySelector('[data-comment-card="${notSent}"] [data-status]')?.textContent`)) === 'Sent', 5000), `lost answer: Retry did not send it (status ${await page.run(`document.querySelector('[data-comment-card="${notSent}"] [data-status]')?.textContent`)}, retry at ${JSON.stringify(await at(`[data-comment-card="${notSent}"] [data-retry]`))}, open ${await page.run(`document.querySelector('[data-viewer-bar]').hasAttribute('data-open')`)}, hit ${await page.run(`(() => { const b = document.querySelector('[data-comment-card="${notSent}"] [data-retry]').getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return e?.outerHTML.slice(0, 120) })()`)}, posts ${await posts()})`)
      const copies = (await owned()).filter(c => c.body === 'RETRY-NOTE')
      assert(copies.length === 1 && copies[0].id === notSent, `lost answer: the host has ${copies.length} copies (posts ${await posts()})`)
      console.log(`share comments: POSTs ${await posts()}`)
      // The refused post above is Chrome's one expected network error (429).
      const errors = page.errors().filter(e => !/status of 429 .*api\/comments/.test(e))
      assert(!errors.length, `the page reported ${JSON.stringify(errors)}`)
    } finally { page.close() }

    // A phone: the bar is the comment row, the Comment button turns pin mode on, a tap pins.
    const phone = await openPage(link, { width: 390, height: 844, phone: true })
    try {
      const at = sel => phone.run(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null })()`)
      await phone.press(...await until(() => at('[data-comment-signin]'), 8000))
      assert(await until(() => phone.run(`!!document.querySelector('[data-comment-field]') && !!document.querySelector('[data-switcher]')`), 15_000), 'phone: signed in, no comment field or no switcher')
      const sw = await at('[data-switcher]'), bar = await phone.run(`document.querySelector('[data-viewer-bar]').getBoundingClientRect().top`)
      assert(sw && sw[1] < bar, 'phone: the switcher is not above the bar')
      await phone.press(...await at('[data-pin-toggle]'))
      assert(await until(() => phone.run(`!!document.querySelector('[data-pin-mode]')`), 3000), 'phone: the Comment button did not turn pin mode on')
      const b = await phone.run(`(() => { const r = document.querySelector('[data-live] [data-count]')?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null })()`)
      assert(b, 'phone: no COUNT-ME on the phone')
      // A real finger: the tap pins, the design gets no click, and nothing of the design takes the focus.
      await phone.touch('touchStart', [b])
      await phone.touch('touchEnd', [])
      assert(await until(() => phone.run(`!!document.querySelector('[data-pin-composer] textarea')`), 3000), 'phone: a tap in pin mode did not open the composer')
      assert(await phone.run(`!document.body.dataset.clicks && !document.activeElement?.closest('[data-live]')`), 'phone: the design got the tap, or the focus')
      await phone.run(`(() => { const el = document.querySelector('[data-pin-composer] textarea'); el.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'PHONE-PIN'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
      await phone.key('Enter')
      assert(await until(async () => (await owned()).find(c => c.body === 'PHONE-PIN')?.target?.view?.size === 'phone', 5000), `phone: the pinned comment's target is ${JSON.stringify((await owned()).find(c => c.body === 'PHONE-PIN')?.target)}`)
    } finally { phone.close() }
  } finally {
    process.removeListener('exit', cleanup)
    cleanup()
  }
  console.log('share comments: checks passed')
}
