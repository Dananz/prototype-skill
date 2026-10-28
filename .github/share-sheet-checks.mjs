// Share links in the owner's page (phase 1, Task 5): the Share sheet and the "From links" tray, driven
// in a real Chrome against a real local host under wrangler dev with a fake GitHub. The sheet first
// says there is no host; once one is set up it makes a link for two variants, lists it in Your links,
// says it changed since shared, updates it and removes it. A viewer's comment reaches the tray within
// a poll; Reply shows on the viewer's side; Send to Claude, and Send n for several picked together,
// make inbox batches. It leaves screenshots of both, wide and on a phone, light and dark, in English
// and Hebrew, in PROTO_SHARE_SHEET_SHOTS (else <shots>/share-sheet).
//
// As in share-tray-checks, everything runs under a temporary HOME, and the session's server is
// restarted under it and restarted as before afterwards: nothing reads the real ~/.config/prototype
// or Keychain, nor reaches the owner's own host.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { signOwnerIn, startFakeGitHub } from './fake-github.mjs'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
const tools = process.env.PROTO_SHARE_TOOLS || join(homedir(), '.prototypes', 'share-tools')
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(get, ms = 15_000) {
  for (const end = Date.now() + ms; ; await sleep(200)) {
    const v = await get()
    if (v || Date.now() > end) return v
  }
}

export async function shareSheetChecks({ proto, app, openPage, fail, shots }) {
  const project = dirname(dirname(app))
  const home = mkdtempSync(join(tmpdir(), 'proto-share-sheet-home-'))
  const env = { ...process.env, HOME: home, PROTO_SHARE_TOKEN_STORE: 'file', PROTO_SHARE_TOOLS: tools }
  delete env.PROTO_SHARE_NO_START
  const port = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).port
  const local = `http://127.0.0.1:${port}/`
  const sharesFile = join(app, '.proto', 'shares.json')
  const sharesBefore = existsSync(sharesFile) ? readFileSync(sharesFile, 'utf8') : null
  const inboxDir = join(app, '.proto', 'inbox')
  const batchesBefore = new Set(['new', 'taken'].flatMap(sub => existsSync(join(inboxDir, sub)) ? readdirSync(join(inboxDir, sub)) : []))
  const realHosts = join(homedir(), '.config', 'prototype', 'hosts.json')
  const keychain = () => process.platform === 'darwin' && spawnSync('security', ['find-generic-password', '-s', 'prototype-share-local'], { stdio: 'ignore' }).status === 0
  const before = { keychain: keychain(), hosts: existsSync(realHosts) ? readFileSync(realHosts, 'utf8') : null }
  shots ||= process.env.PROTO_SHARE_SHEET_SHOTS || join(tmpdir(), 'proto-shots', 'share-sheet')
  mkdirSync(shots, { recursive: true })

  const share = args => {
    console.log(`\n$ proto share ${args.join(' ')}`)
    const r = spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), 'share', ...args, '--project', project, '--session', 'smoke'], { env, encoding: 'utf8', timeout: 600_000 })
    process.stdout.write(r.stdout || '')
    process.stderr.write(r.stderr || '')
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }

  let gh = null, vite = null
  const pages = []
  const cleanup = () => {
    for (const p of pages.splice(0)) { try { p.close() } catch { /* gone */ } }
    if (vite && vite.exitCode === null) { try { process.kill(vite.pid, 'SIGTERM') } catch { /* gone */ } }
    spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), 'share', 'stop', '--project', project, '--session', 'smoke'], { env, stdio: 'ignore', timeout: 60_000 })
    gh?.close()
    rmSync(home, { recursive: true, force: true })
  }
  process.once('exit', cleanup)
  const assert = (ok, why) => { if (!ok) { cleanup(); fail(`share sheet: ${why}`) } }

  // GitHub sign-in on, as in the tray checks; the host itself is set up only after the first look.
  gh = await startFakeGitHub()
  mkdirSync(join(home, '.prototypes', 'host'), { recursive: true })
  writeFileSync(join(home, '.prototypes', 'host', '.dev.vars'), `GITHUB_CLIENT_ID=${gh.clientId}\nGITHUB_CLIENT_SECRET=${gh.clientSecret}\nVIEWER_KEY=k-${randomUUID()}\nGITHUB_OAUTH=${gh.url}\nGITHUB_API=${gh.url}\n`)

  // The session's server under this HOME, polling every second.
  proto(['stop'])
  vite = spawn(process.execPath, [join(app, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: app, env: { ...env, PROTO_SHARE_POLL_MS: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let viteLog = ''
  vite.stdout.on('data', d => { viteLog += d }); vite.stderr.on('data', d => { viteLog += d })
  const up = await until(async () => { try { return (await fetch(`${local}__proto/status`, { signal: AbortSignal.timeout(1000) })).ok } catch { return false } }, 30_000)
  assert(up, `the session server did not start under the temporary HOME:\n${viteLog.slice(-2000)}`)

  const open = async (path, o = {}) => { const p = await openPage(`${local}${path}`, { errors: true, ...o }); pages.push(p); return p }
  const waitFor = async (page, expression, why, ms = 20_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await page.run(expression)) return
    assert(false, why)
  }
  const click = (page, s) => page.run(`(()=>{const e=document.querySelector(${JSON.stringify(s)});if(!e)return false;e.click();return true})()`)
  const type = (page, s, text) => page.run(`(()=>{const e=document.querySelector(${JSON.stringify(s)});if(!e)return false;const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  const shot = async (page, name) => { await sleep(500); await page.screenshot(join(shots, `owner-${name}.png`)) }
  const sheetOpen = async page => {
    await click(page, '[data-shoot=more]')
    await waitFor(page, '!!document.querySelector("[data-act=share-link]")', 'the ⋯ menu has no Share link… row')
    await click(page, '[data-act=share-link]')
    await waitFor(page, '!!document.querySelector("[data-share-link]")', 'Share link… did not open the sheet')
    await waitFor(page, '!!document.querySelector("[data-link-tab], [data-link-nohost], [data-link-error]")', 'the sheet did not finish looking for the host')
  }

  // 1. No hosts.json: the built-in online host, with no token, so the New link view is the GitHub
  // sign-in (nothing is asked of prtype.dev until it is pressed).
  // A design with colour, so the Opens on preview has something to show (put back at the end).
  const fileA = join(app, 'src', 'protos', 'share-link', 'A.tsx'), designA = readFileSync(fileA, 'utf8')
  writeFileSync(fileA, `export default function A() { return <main style={{ minHeight: '100vh', background: '#2563eb', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 64 }}><h1>MARK-A</h1></main> }\n`)
  let page = await open('share-link/A?theme=light')
  await sheetOpen(page)
  await waitFor(page, '!!document.querySelector("[data-share-link] [data-link-gate] [data-link-signin]")', 'no hosts.json: the sheet does not ask to sign in with GitHub')
  assert(await page.run('!document.querySelector("[data-link-nohost]")'), 'no hosts.json: the sheet says there is no host')
  await shot(page, 'sheet-signin-desktop-light')

  // 2. A host on this Mac: the page opened again finds it, and the New link view shows the prototypes and their variants.
  assert(share(['setup', '--local', '--name', 'Smoke']).status === 0, 'setup --local failed')
  const host = JSON.parse(readFileSync(join(home, '.config', 'prototype', 'hosts.json'), 'utf8'))[0]
  const hostPort = Number(new URL(host.url).port)
  // A new link goes out under the owner's GitHub name: the fake GitHub signs the owner in.
  const ownerToken = readFileSync(join(home, '.config', 'prototype', 'token-local'), 'utf8').trim()
  const signed = await signOwnerIn(`http://127.0.0.1:${hostPort}`, ownerToken)
  assert(signed.status === 200 && signed.text.includes('Signed in as dana-test'), `owner sign-in: ${signed.status} ${signed.text.slice(0, 200)}`)
  page.close(); pages.splice(pages.indexOf(page), 1)
  page = await open('share-link/A?theme=light')
  await sheetOpen(page)
  await waitFor(page, '!!document.querySelector("[data-link-what=proto]")', 'with a host: the New link view does not show')
  assert(await page.run('document.querySelector("[data-link-what=proto]").getAttribute("aria-checked")==="true"'), 'This prototype is not the default')
  // The preview of the variant the link opens on: drawn, and blue like the design.
  await waitFor(page, `(()=>{const c=document.querySelector('[data-link-preview] canvas.opacity-100');if(!c||!c.width)return false;const d=c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height*0.8),1,1).data;return d[2]>180&&d[0]<120})()`, 'Opens on: the preview is not drawn, or not the design', 40_000)
  assert(await page.run('(()=>{const all=document.querySelectorAll("input[data-link-variant^=\'share-link/\']");return all.length>=3&&[...all].every(e=>e.checked)})()'), 'This prototype does not check every variant of it')
  await click(page, '[data-link-what=variant]')
  assert(await page.run('[...document.querySelectorAll("input[data-link-variant]:checked")].map(e=>e.dataset.linkVariant).join()==="share-link/A"'), 'This variant does not check only the variant on the page')
  await click(page, 'input[data-link-variant="share-link/C"]')
  assert(await page.run('[...document.querySelectorAll("input[data-link-variant]:checked")].map(e=>e.dataset.linkVariant).join()==="share-link/A,share-link/C"'), 'checking a second variant did not add it')
  await shot(page, 'sheet-new-desktop-light')

  // 3. Create link: the review (when there is something to say), then the link with Copy, Open and its QR.
  await click(page, '[data-link-create]')
  await waitFor(page, '!!document.querySelector("[data-link-url]") || !!document.querySelector("[data-link-anyway]") || !!document.querySelector("[data-link-error]")', 'create: nothing came back', 300_000)
  if (await page.run('!!document.querySelector("[data-link-anyway]")')) {
    await shot(page, 'sheet-review-desktop-light')
    await click(page, '[data-link-anyway]')
  }
  await waitFor(page, '!!document.querySelector("[data-link-url]")', `create: no link (${await page.run('document.querySelector("[data-link-error]")?.textContent||""')})`, 300_000)
  const link = await page.run('document.querySelector("[data-link-url]").value')
  assert(/^http:\/\/127\.0\.0\.1:\d+\/s\/\w+\/$|^http:\/\/\w+\.localhost:\d+\/$/.test(link), `create: the link is ${link}`)
  assert((await fetch(link)).status === 200, `create: ${link} does not answer`)
  assert(await page.run(`document.querySelector("[data-link-open]").href===${JSON.stringify(link)} && !!document.querySelector("[data-link-copy]")`), 'create: no Open or Copy')
  const qr = await page.run(`(async()=>{const c=document.querySelector('canvas[data-link-qr]');if(!c)return 'none';if('BarcodeDetector' in window){try{const r=await new BarcodeDetector({formats:['qr_code']}).detect(c);if(r.length)return r[0].rawValue}catch{}}const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<d.length;i+=4)if(d[i]<80)dark++;return dark>50?'drawn':'blank'})()`)
  assert(qr === link || qr === 'drawn', `QR: ${qr}`)
  await shot(page, 'sheet-created-desktop-light')
  const shares = JSON.parse(readFileSync(sharesFile, 'utf8'))
  const entry = shares.find(s => link.includes(s.id))
  assert(entry && entry.scope.protos[0].variants.join() === 'A,C', `create: the share's scope is ${JSON.stringify(entry?.scope)}`)
  const id = entry.id

  // A viewer signs in with (the fake) GitHub and comments on v1, before the link is updated.
  const S = `http://127.0.0.1:${hostPort}/s/${id}`
  let r = await fetch(`${S}/_in/start?back=${encodeURIComponent(`/s/${id}/`)}`, { redirect: 'manual' })
  const nonce = (r.headers.getSetCookie().find(c => c.startsWith('vn=')) || '').split(';')[0]
  r = await fetch(r.headers.get('location'), { redirect: 'manual' })
  const state = (r.headers.getSetCookie()[0] || '').split(';')[0]
  r = await fetch(r.headers.get('location'), { redirect: 'manual' })
  r = await fetch(r.headers.get('location'), { redirect: 'manual', headers: { cookie: state } })
  r = await fetch(r.headers.get('location'), { redirect: 'manual', headers: { cookie: nonce } })
  const jar = (r.headers.getSetCookie().find(c => c.startsWith('v=')) || '').split(';')[0]
  assert(jar, `sign-in: no viewer cookie (${r.status} ${r.headers.get('location')})`)
  const XP = { 'x-proto': '1', cookie: jar }
  const viewerList = async () => (await (await fetch(`${S}/api/comments`, { headers: XP })).json()).comments
  const comment = async (body, variant = 'share-link/C', target = null) => {
    const cid = randomUUID()
    const res = await fetch(`${S}/api/comments`, { method: 'POST', headers: { ...XP, 'content-type': 'application/json' }, body: JSON.stringify({ id: cid, variant, body, target }) })
    assert(res.status === 201, `viewer comment: ${res.status} ${await res.text()}`)
    return cid
  }
  const first = await comment('The monthly toggle is easy to miss, I didn\'t see it at first.\n<b>not bold</b>', 'share-link/C', { src: 'share-link/C.tsx:1', component: 'C', path: 'main > h1', x: 10, y: 20, view: { size: 'desktop', w: 1280, h: 800 } })

  // 4. Your links: the row, then Changed since shared after an edit, and Update link.
  await click(page, '[data-link-tab=mine]')
  await waitFor(page, `!!document.querySelector('[data-link-row="${id}"]')`, 'Your links: the new link is not listed')
  writeFileSync(join(app, 'src', 'protos', 'share-link', 'C.tsx'), readFileSync(join(app, 'src', 'protos', 'share-link', 'C.tsx'), 'utf8') + '\n// changed after sharing\n')
  await click(page, '[data-link-tab=new]')
  await click(page, '[data-link-tab=mine]')
  await waitFor(page, `!!document.querySelector('[data-link-row="${id}"] [data-link-changed]')`, 'Your links: Changed since shared is not shown after an edit')
  await shot(page, 'sheet-links-desktop-light')
  await click(page, `[data-link-row="${id}"] [data-link-update]`)
  await waitFor(page, `!!document.querySelector('[data-link-row="${id}"] [data-link-anyway]') || (document.querySelector('[data-link-row="${id}"]')?.dataset.version==='2')`, 'update: nothing came back', 300_000)
  await click(page, `[data-link-row="${id}"] [data-link-anyway]`)
  await waitFor(page, `document.querySelector('[data-link-row="${id}"]')?.dataset.version==='2' && !document.querySelector('[data-link-row="${id}"] [data-link-changed]')`, 'update: the row is not at v2', 300_000)
  assert(JSON.parse(readFileSync(sharesFile, 'utf8')).find(s => s.id === id)?.version === 2, 'update: shares.json is not at v2')

  // The same in dark, in a page of its own (the shell's theme is its own, chosen as the page loads).
  {
    const dark = await open('share-link/A?theme=dark')
    await sheetOpen(dark)
    await click(dark, '[data-link-tab=mine]')
    await waitFor(dark, `!!document.querySelector('[data-link-row="${id}"]')`, 'dark: Your links is empty')
    await shot(dark, 'sheet-links-desktop-dark')
    dark.close(); pages.splice(pages.indexOf(dark), 1)
  }
  await page.key('Escape')
  await waitFor(page, '!document.querySelector("[data-share-link]")', 'Esc did not close the sheet')

  // 5. The tray has the viewer's comment within a poll, and the island's count says so.
  if (!await until(() => page.run(`!!document.querySelector('[data-link-badge]')`), 30_000)) {
    // Say what the server's tray and the page held, so a miss shows which side lost it.
    const tray = await (await fetch(`${local}__proto/share/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"refresh":false}' })).json().catch(e => String(e))
    const seen = await page.run(`JSON.stringify({ path: location.pathname, island: !!document.querySelector('[data-island]'), open: document.querySelector('[data-shoot=island-open]')?.textContent })`)
    assert(false, `the island's count has no badge for the new comment: server tray ${JSON.stringify(tray).slice(0, 400)}, page ${seen}`)
  }
  await click(page, '[data-shoot=island-open]')
  await waitFor(page, `!!document.querySelector('[data-link-card="${first}"]')`, 'tray: the viewer comment did not arrive within the poll', 20_000)
  const card = await page.run(`(()=>{const c=document.querySelector('[data-link-card="${first}"]');return {text:c.textContent,bold:!!c.querySelector('b'),avatar:!!c.querySelector('[data-link-avatar]')}})()`)
  assert(['dana-test', 'share-link/3', 'v1', '<b>not bold</b>'].every(w => card.text.includes(w)) && !card.bold && card.avatar, `tray: the card lacks its login, route, version or text, or rendered the body as HTML: ${JSON.stringify(card)}`)
  assert(await page.run(`!!document.querySelector('[data-link-card="${first}"] [data-link-changed]')`), 'tray: a comment on v1 of a v2 link does not say it has changed since')

  // Reply shows on the viewer's side.
  await click(page, `[data-link-card="${first}"] [data-link-reply]`)
  await waitFor(page, `!!document.querySelector('[data-link-card="${first}"] [data-link-reply-box]')`, 'reply: no box')
  await type(page, `[data-link-card="${first}"] [data-link-reply-box]`, 'OWNER-REPLY thanks, bigger now')
  await click(page, `[data-link-card="${first}"] [data-link-reply-send]`)
  assert(await until(async () => (await viewerList()).find(c => c.id === first)?.owner_reply === 'OWNER-REPLY thanks, bigger now', 15_000), 'reply: the viewer does not see the owner\'s reply')
  await waitFor(page, `document.querySelector('[data-link-card="${first}"]').textContent.includes('OWNER-REPLY')`, 'reply: the card does not show the reply')

  // Hide takes it off the link for viewers and keeps it here; Unhide brings it back.
  await click(page, `[data-link-card="${first}"] [data-link-hide]`)
  assert(await until(async () => !(await viewerList()).some(c => c.id === first), 15_000), 'hide: the viewer still sees the comment')
  await waitFor(page, `document.querySelector('[data-link-card="${first}"] [data-link-hide]')?.textContent==='Unhide' && !document.querySelector('[data-link-card="${first}"] [data-link-hide]').disabled`, 'hide: the card does not offer Unhide')
  await click(page, `[data-link-card="${first}"] [data-link-hide]`)
  assert(await until(async () => (await viewerList()).some(c => c.id === first), 15_000), 'unhide: the viewer does not see the comment again')
  await waitFor(page, `document.querySelector('[data-link-card="${first}"] [data-link-hide]')?.textContent==='Hide' && !document.querySelector('[data-link-card="${first}"] [data-link-hide]').disabled`, 'unhide: the card does not offer Hide')
  // Dismiss takes it out of the tray; the ⋯ menu's Dismissed shows it again, with Undo.
  await click(page, `[data-link-card="${first}"] [data-link-dismiss]`)
  await waitFor(page, `!document.querySelector('[data-link-card="${first}"]')`, 'dismiss: the card is still in the tray')
  await click(page, '[data-link-tray-menu]')
  await waitFor(page, '!!document.querySelector("[data-link-show-dismissed]")', 'the tray\'s ⋯ menu did not open')
  await click(page, '[data-link-show-dismissed]')
  await waitFor(page, `document.querySelector('[data-link-card="${first}"] [data-link-dismiss]')?.textContent==='Undo dismiss' && !document.querySelector('[data-link-card="${first}"] [data-link-dismiss]').disabled`, 'Dismissed: the dismissed card is not shown with Undo')
  await click(page, `[data-link-card="${first}"] [data-link-dismiss]`)
  await waitFor(page, `document.querySelector('[data-link-card="${first}"] [data-link-dismiss]')?.textContent==='Dismiss' && !document.querySelector('[data-link-card="${first}"] [data-link-dismiss]').disabled`, 'undo dismiss: the card is still dismissed')

  // Two more, picked together: the tray in its full state for the screenshots first.
  const second = await comment('Could the price be bigger on the phone?', 'share-link/A')
  const third = await comment('I like the plain one.', 'share-link/A')
  await waitFor(page, `!!document.querySelector('[data-link-card="${second}"]') && !!document.querySelector('[data-link-card="${third}"]')`, 'tray: the later comments did not arrive', 20_000)
  await click(page, `[data-link-card="${second}"] [data-link-select]`)
  await click(page, `[data-link-card="${third}"] [data-link-select]`)
  await waitFor(page, `document.querySelector('[data-link-send-many]')?.textContent.includes('2')`, 'select several: no Send 2')
  await shot(page, 'tray-desktop-light')
  {
    const dark = await open('share-link/A?theme=dark')
    await click(dark, '[data-shoot=island-open]')
    await waitFor(dark, `!!document.querySelector('[data-link-card="${third}"]')`, 'dark: the tray is empty')
    await click(dark, `[data-link-card="${second}"] [data-link-select]`)
    await click(dark, `[data-link-card="${third}"] [data-link-select]`)
    await shot(dark, 'tray-desktop-dark')
    dark.close(); pages.splice(pages.indexOf(dark), 1)
  }

  // Send one, then the two picked: two batches, every comment carrying where it came from.
  const newBatches = () => existsSync(join(inboxDir, 'new')) ? readdirSync(join(inboxDir, 'new')).filter(b => !batchesBefore.has(b) && !b.startsWith('.')) : []
  await click(page, `[data-link-card="${first}"] [data-link-send]`)
  assert(await until(() => newBatches().length === 1, 15_000), 'Send to Claude: no batch in the inbox')
  await click(page, '[data-link-send-many]')
  assert(await until(() => newBatches().length === 2, 15_000), 'Send 2 to Claude: no second batch')
  const sentFrom = newBatches().flatMap(b => JSON.parse(readFileSync(join(inboxDir, 'new', b, 'batch.json'), 'utf8')).comments.map(c => c.from?.comment)).sort()
  assert(sentFrom.join() === [first, second, third].sort().join(), `send: the batches carry ${sentFrom.join()}`)
  assert(await until(async () => (await viewerList()).filter(c => [first, second, third].includes(c.id)).every(c => c.status === 'sent'), 10_000), 'send: the host rows are not sent')
  await waitFor(page, `!document.querySelector('[data-link-card="${first}"] [data-link-send]')`, 'send: the card still offers Send')
  // The errors a page reports would show a broken sheet or tray even when the checks above pass.
  const reported = page.errors().filter(e => !/favicon|ERR_|WebSocket/.test(e))
  assert(!reported.length, `the page reported errors: ${reported.join(' | ').slice(0, 600)}`)
  page.close(); pages.splice(pages.indexOf(page), 1)

  // 6. The same in Hebrew, and on a phone: the sheet is a drawer from the pill's menu.
  page = await open('share-link/A?lang=he&theme=light')
  await sheetOpen(page)
  await waitFor(page, '!!document.querySelector("[data-link-what=proto]")', 'Hebrew: no New link view')
  assert(await page.run('document.documentElement.dir==="rtl"'), 'Hebrew: the page is not right to left')
  await shot(page, 'sheet-new-desktop-light-he')
  await click(page, '[data-link-tab=mine]')
  await waitFor(page, `!!document.querySelector('[data-link-row="${id}"]')`, 'Hebrew: Your links is empty')
  await shot(page, 'sheet-links-desktop-light-he')
  await page.key('Escape')
  await click(page, '[data-shoot=island-open]')
  await waitFor(page, `!!document.querySelector('[data-link-card="${first}"]')`, 'Hebrew: the tray is empty')
  // An English comment in the Hebrew page keeps its own side.
  assert(await page.run(`(()=>{const b=document.querySelector('[data-link-card="${first}"] [data-link-body]'),c=getComputedStyle(b),r=b.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(b);const t=range.getClientRects()[0];return c.direction==='ltr'&&t.left-r.left<4})()`), 'Hebrew: an English comment is not on its own (left) side')
  await shot(page, 'tray-desktop-light-he')
  page.close(); pages.splice(pages.indexOf(page), 1)

  for (const [theme, lang] of [['light', ''], ['dark', ''], ['light', 'he']]) {
    page = await open(`share-link/A?${lang ? `lang=${lang}&` : ''}theme=${theme}`, { width: 390, height: 844, phone: true })
    const name = `${theme}${lang ? `-${lang}` : ''}`
    await click(page, '[data-shoot=menu]')
    await waitFor(page, '!!document.querySelector("[data-menu-card] [data-act=share-link]")', 'phone: the pill\'s menu has no Share link row')
    await click(page, '[data-menu-card] [data-act=share-link]')
    await waitFor(page, '!!document.querySelector("[data-share-link][data-phone]")', 'phone: the sheet is not the drawer')
    await waitFor(page, '!!document.querySelector("[data-link-what=proto]")', 'phone: no New link view')
    await shot(page, `sheet-new-phone-${name}`)
    await click(page, '[data-link-tab=mine]')
    await waitFor(page, `!!document.querySelector('[data-link-row="${id}"]')`, 'phone: Your links is empty')
    await shot(page, `sheet-links-phone-${name}`)
    await page.key('Escape')
    await waitFor(page, '!document.querySelector("[data-share-link]")', 'phone: the drawer did not close')
    await click(page, '[data-island] [data-shoot=island-open]')
    await waitFor(page, `!!document.querySelector('[data-link-card="${first}"]')`, 'phone: the tray is empty')
    await shot(page, `tray-phone-${name}`)
    page.close(); pages.splice(pages.indexOf(page), 1)
  }

  // 7. Remove, from the variant's own menu this time: it asks once, then the link is gone.
  page = await open('share-link/A?theme=light')
  await page.run(`document.querySelector('[data-act="vm:share-link:A"]')?.click()`)
  await waitFor(page, '!!document.querySelector("[data-shoot=ctx-share-link]")', 'the variant menu has no Share link… row')
  await click(page, '[data-shoot=ctx-share-link]')
  await waitFor(page, '!!document.querySelector("[data-link-what=variant]")', 'variant menu: no New link view')
  assert(await page.run('[...document.querySelectorAll("input[data-link-variant]:checked")].map(e=>e.dataset.linkVariant).join()==="share-link/A"'), 'variant menu: Share link… does not preselect that variant')
  await click(page, '[data-link-tab=mine]')
  await waitFor(page, `!!document.querySelector('[data-link-row="${id}"] [data-link-remove]')`, 'remove: no Remove')
  await click(page, `[data-link-row="${id}"] [data-link-remove]`)
  await waitFor(page, `/\\b3\\b/.test(document.querySelector('[data-link-row="${id}"] [data-link-remove]')?.textContent||'')`, 'remove: it does not ask once, naming the comment count')
  await click(page, `[data-link-row="${id}"] [data-link-remove]`)
  await waitFor(page, `!document.querySelector('[data-link-row="${id}"]')`, 'remove: the row is still listed', 60_000)
  assert((await fetch(link)).status === 410, 'remove: the link still answers')
  page.close(); pages.splice(pages.indexOf(page), 1)

  // Back as it was.
  writeFileSync(fileA, designA)
  process.kill(vite.pid, 'SIGTERM')
  await until(() => vite.exitCode !== null, 10_000)
  process.removeListener('exit', cleanup)
  cleanup()
  if (sharesBefore === null) rmSync(sharesFile, { force: true })
  else writeFileSync(sharesFile, sharesBefore)
  for (const f of ['tray.json', 'outbox.jsonl']) rmSync(join(app, '.proto', 'shares', f), { force: true })
  for (const sub of ['new', 'taken']) for (const b of existsSync(join(inboxDir, sub)) ? readdirSync(join(inboxDir, sub)) : []) if (!batchesBefore.has(b)) rmSync(join(inboxDir, sub, b), { recursive: true, force: true })
  proto(['up', '--name', 'Smoke'])
  assert(keychain() === before.keychain, 'isolation: the login Keychain gained a prototype-share-local item')
  assert((existsSync(realHosts) ? readFileSync(realHosts, 'utf8') : null) === before.hosts, 'isolation: the real ~/.config/prototype/hosts.json changed')
  console.log(`share sheet: checks passed (screenshots in ${shots})`)
}
