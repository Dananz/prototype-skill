// Share links online, as close to production as this Mac gets (Task 7 of the online plan): the host
// under `wrangler dev --local-protocol https` on a port of its own (8800 to 8810, never the owner's
// 8787), with the config `proto share setup` writes (path mode, sign-in on, a legacy name, the cron)
// and a database made by the migrations alone, as a deployed one is (its BASE is not a loopback name,
// so the host never upgrades itself). The owner and token come from the same ownerAndToken as setup.
//
// proto share publishes to it and prints the short link; Chrome opens it, signs in with a fake GitHub
// and comments; proto share comments/take, proto inbox and reply --done carry those back; the page's
// sheet and tray show the online link and the comment. Then: a second owner's token refused, the
// daily budget, today's usage, the old name's 301, what path mode does and doesn't isolate, the
// session's shell copy refreshed before a build, and removal. Screenshots of the viewer and of the
// owner's page, desktop and phone, go to `shots`.
//
// Everything runs under a temporary HOME with the file token store; the session's server is
// restarted under it for the sheet and restarted as before afterwards. Node reaches *.localhost and
// takes the self-signed certificate through share-online-preload.mjs; Chrome resolves *.localhost
// itself and is told to take the certificate. Only the wrangler this starts is stopped.
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signOwnerIn, startFakeGitHub } from './fake-github.mjs'
import { hostHash, portFree, wranglerEnv } from '../scripts/share-host.mjs'
import { ownerAndToken, writeOnlineConfig } from '../scripts/share-online.mjs'
import { CRON } from '../host/lib/cron.mjs'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
const toolsDir = process.env.PROTO_SHARE_TOOLS || join(homedir(), '.prototypes', 'share-tools')
const tools = { wrangler: join(toolsDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js') }
const preload = join(skill, '.github', 'share-online-preload.mjs')
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(get, ms = 15_000) {
  for (const end = Date.now() + ms; ; await sleep(200)) {
    const v = await get()
    if (v || Date.now() > end) return v
  }
}
const listening = port => (spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout || '').trim()

export async function shareOnlineChecks({ proto, app, openPage, fail, shots }) {
  // This process's own fetch reaches *.localhost and takes the certificate, as the children's do.
  await import('./share-online-preload.mjs')
  const project = dirname(dirname(app))
  const home = mkdtempSync(join(tmpdir(), 'proto-share-online-'))
  const hostDir = join(home, 'host'), state = join(hostDir, 'state'), cfg = join(hostDir, 'wrangler.jsonc')
  mkdirSync(state, { recursive: true })
  mkdirSync(shots, { recursive: true })
  const owner8787 = listening(8787)
  let port = 0
  for (let p = 8800; p <= 8810 && !port; p++) if (await portFree(p)) port = p
  if (!port) fail('share online: no free port from 8800 to 8810')
  const base = `prtype.localhost:${port}`, legacy = `legacy.localhost:${port}`, origin = `https://${base}`
  const env = { ...process.env, HOME: home, PROTO_SHARE_TOKEN_STORE: 'file', PROTO_SHARE_TOOLS: toolsDir, PROTO_SHARE_WRANGLER_HOME: join(home, 'wrangler-home'), NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${preload}`.trim() }
  delete env.PROTO_SHARE_NO_START
  const wenv = () => wranglerEnv({ XDG_CONFIG_HOME: join(home, 'wrangler-home') })

  let gh = null, dev = null, vite = null, log = ''
  const pages = []
  const cleanup = () => {
    for (const p of pages.splice(0)) { try { p.close() } catch { /* gone */ } }
    if (vite && vite.exitCode === null) { try { process.kill(vite.pid, 'SIGTERM') } catch { /* gone */ } }
    // The wrangler this started, and its workerd (its own process group); nothing else.
    if (dev && dev.exitCode === null) { try { process.kill(-dev.pid, 'SIGTERM') } catch { try { dev.kill('SIGTERM') } catch { /* gone */ } } }
    gh?.close()
    try { rmSync(home, { recursive: true, force: true }) } catch { /* temp */ }
  }
  process.once('exit', cleanup)
  const assert = (ok, why) => { if (!ok) { console.log(log.slice(-3000)); cleanup(); fail(`share online: ${why}`) } }
  const cli = (args, extra = {}) => {
    console.log(`\n$ proto ${args.join(' ')}`)
    const r = spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), ...args, '--project', project, '--session', 'smoke'], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 600_000 })
    process.stdout.write(r.stdout || '')
    process.stderr.write(r.stderr || '')
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }
  const wr = args => spawnSync(process.execPath, [tools.wrangler, ...args], { cwd: hostDir, env: wenv(), encoding: 'utf8', timeout: 120_000 })
  const sql = async text => {
    const r = wr(['d1', 'execute', 'DB', '--local', '--persist-to', state, '-c', cfg, '--json', '--command', text])
    assert(r.status === 0, `d1 execute: ${(r.stderr || r.stdout).slice(-1500)}`)
    return JSON.parse(r.stdout).flatMap(x => x.results || [])
  }
  const shot = async (page, name) => { await sleep(600); await page.screenshot(join(shots, `${name}.png`)) }
  const open = async (url, o = {}) => { const p = await openPage(url, { errors: true, args: ['--ignore-certificate-errors'], ...o }); pages.push(p); return p }
  const drop = p => { p.close(); pages.splice(pages.indexOf(p), 1) }
  const at = (page, sel) => page.run(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null })()`)
  const fill = (page, sel, text) => page.run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const click = (page, s) => page.run(`(()=>{const e=document.querySelector(${JSON.stringify(s)});if(!e)return false;e.click();return true})()`)
  const waitFor = async (page, expression, why, ms = 20_000) => { assert(await until(() => page.run(expression), ms), why) }

  // The prototype the share is made of, as the other share smokes make it.
  if (!existsSync(join(app, 'src', 'protos', 'share-link'))) {
    proto(['add', 'share-link', '--title', 'Share link', '--variants', 'A:One,B:Two,C:Three'])
    for (const id of ['A', 'B', 'C']) writeFileSync(join(app, 'src/protos/share-link', `${id}.tsx`), `export default function ${id}() { return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontSize: 56 }}><h1>MARK-${id}</h1></main> }\n`)
  }

  // ---------- the host, as setup would make it, under wrangler dev ----------
  gh = await startFakeGitHub()
  writeOnlineConfig(cfg, { accountId: 'smoke-account', kvId: 'smoke-kv', dbId: 'smoke-db', base, signin: true, legacy, hostVersion: hostHash() })
  const config = JSON.parse(readFileSync(cfg, 'utf8').replace(/^\/\/.*\n/, ''))
  assert(config.d1_databases[0].migrations_dir && config.vars.SIGNIN === '1' && config.triggers.crons[0] === CRON, `config: ${JSON.stringify(config)}`)
  writeFileSync(join(hostDir, '.dev.vars'), `GITHUB_CLIENT_ID=${gh.clientId}\nGITHUB_CLIENT_SECRET=${gh.clientSecret}\nVIEWER_KEY=k-${randomUUID()}\nGITHUB_OAUTH=${gh.url}\nGITHUB_API=${gh.url}\n`)
  const migrated = wr(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state, '-c', cfg])
  const files = readdirSync(join(skill, 'host', 'migrations')).filter(f => /^\d{4}_.*\.sql$/.test(f))
  assert(migrated.status === 0 && files.every(f => migrated.stdout.includes(f)), `migrations: ${(migrated.stdout + migrated.stderr).slice(-1500)}`)
  const tokenFile = join(home, '.config', 'prototype', 'token-online')
  mkdirSync(dirname(tokenFile), { recursive: true })
  const made = await ownerAndToken({ sql, name: () => 'Smoke', tokenName: 'online', device: 'smoke', get: () => existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : null, set: (_, t) => writeFileSync(tokenFile, t + '\n', { mode: 0o600 }) })
  assert(made.minted && (await sql("SELECT v FROM meta WHERE k = 'owner_id'"))[0]?.v === made.owner.id, 'owner: meta.owner_id is not the owner setup made')
  const TOKEN = readFileSync(tokenFile, 'utf8').trim()
  writeFileSync(join(home, '.config', 'prototype', 'hosts.json'), JSON.stringify([{ name: 'online', url: origin, stage: 'domain', base, pathMode: true, default: true, owner: 'Smoke' }], null, 2))
  dev = spawn(process.execPath, [tools.wrangler, 'dev', '-c', cfg, '--local-protocol', 'https', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0', '--persist-to', state, '--test-scheduled', '--show-interactive-dev-session=false'], { cwd: hostDir, env: wenv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  dev.stdout.on('data', d => { log += d }); dev.stderr.on('data', d => { log += d })
  const health = await until(async () => { try { const r = await fetch(`${origin}/_health`); return r.ok && r.headers.get('x-proto-host') } catch { return false } }, 60_000)
  assert(health === hostHash(), `the host on ${origin} did not start on this code (x-proto-host ${health})`)
  const A = { authorization: `Bearer ${TOKEN}` }

  try {
    // ---------- the owner signs in with (the fake) GitHub, which a new link needs here ----------
    const gated = cli(['share', 'share-link/2', '--yes'])
    assert(gated.status !== 0 && gated.out.includes('Sign in with GitHub first: proto share signin'), `publish before sign-in: ${gated.out.slice(-300)}`)
    const claimed = await signOwnerIn(origin, TOKEN)
    assert(claimed.status === 200 && claimed.url.startsWith(`${origin}/auth/github?claim=`) && claimed.text.includes('Signed in as dana-test'), `owner sign-in: ${claimed.status} ${claimed.text.slice(0, 200)}`)

    // ---------- 11, 1: the shell copy refreshed, then a publish with the short link ----------
    const header = join(app, 'shell', 'viewer', 'header.tsx'), template = readFileSync(join(skill, 'app', 'shell', 'viewer', 'header.tsx'), 'utf8')
    writeFileSync(header, template.replaceAll('data-viewer-header', 'data-viewer-stale-header'))
    const one = cli(['share', 'share-link/2', 'share-link/3', '--yes'])
    const link = (one.out.match(/^link (\S+)/m) || [])[1], opens = (one.out.match(/^opens (\S+)/m) || [])[1]
    assert(one.status === 0 && link && new RegExp(`^${origin}/[0-9a-z]{10}$`).test(link), `publish: exited ${one.status}, link ${link}`)
    const id = link.split('/').pop()
    assert(opens === `${origin}/s/${id}/` && !/only on this Mac/.test(one.out), `publish: opens ${opens}; ${one.out}`)
    assert(!one.out.includes('runs older code'), 'publish: the host was taken for older code')
    assert(readFileSync(header, 'utf8') === template, 'shell refresh: the session\'s viewer header was not brought up to date')
    const html = await (await fetch(`${origin}/s/${id}/`)).text()
    assert(html.includes('data-viewer-header') && !html.includes('data-viewer-stale-header') && html.includes('MARK-B') && html.includes('MARK-C'), 'shell refresh: the published page is not built from the template\'s viewer')

    // ---------- 2, 3: the short link in Chrome, sign-in, two comments ----------
    // The cookie as the host sets it, read from Node (Chrome hides an HttpOnly one from the page).
    const S = `${origin}/s/${id}`
    let r = await fetch(`${S}/_in/start?back=${encodeURIComponent(`/s/${id}/`)}`, { redirect: 'manual' })
    const nonce = (r.headers.getSetCookie().find(c => c.startsWith('vn=')) || '').split(';')[0]
    r = await fetch(new URL(r.headers.get('location'), origin), { redirect: 'manual' })
    const stateCookie = (r.headers.getSetCookie()[0] || '').split(';')[0]
    r = await fetch(r.headers.get('location'), { redirect: 'manual' })
    r = await fetch(new URL(r.headers.get('location'), origin), { redirect: 'manual', headers: { cookie: stateCookie } })
    r = await fetch(new URL(r.headers.get('location'), origin), { redirect: 'manual', headers: { cookie: nonce } })
    const vCookie = r.headers.getSetCookie().find(c => c.startsWith('v=')) || ''
    const attrs = vCookie.split(';').slice(1).map(s => s.trim().toLowerCase())
    assert(attrs.includes(`path=/s/${id}/`) && attrs.includes('secure') && attrs.includes('httponly'), `sign-in: the viewer cookie is ${vCookie.replace(/=[^;]+/, '=…')}`)
    const jar = vCookie.split(';')[0]
    const XP = { 'x-proto': '1', cookie: jar }
    const viewerList = async () => (await (await fetch(`${S}/api/comments`, { headers: XP })).json()).comments

    const page = await open(link)
    await waitFor(page, `location.pathname === '/s/${id}/' && document.body.innerText.includes('MARK-B') && document.body.innerText.includes('MARK-C')`, `short link: Chrome is at ${await page.run('location.href')}`)
    await shot(page, 'viewer-desk-desktop')
    const signin = await until(() => at(page, '[data-viewer-bar] [data-comment-signin]'), 10_000)
    assert(signin, 'viewer: no Sign in with GitHub in the bar')
    await page.press(...signin)
    const who = await until(() => page.run(`document.querySelector('[data-account]')?.textContent ?? ''`), 15_000)
    assert(who?.includes('dana-test'), `sign-in in Chrome: the header shows ${JSON.stringify(who)}`)
    assert(await until(() => page.run(`!!document.querySelector('[data-account] img')`), 5000), 'sign-in: no avatar in the header')
    await shot(page, 'viewer-signed-in-desktop')
    await page.press(...await until(() => at(page, '[data-comment-field]'), 5000))
    await fill(page, '[data-comment-field]', 'ONLINE-WHOLE the plan names are hard to tell apart')
    await page.key('Enter')
    const owned = async () => (await (await fetch(`${origin}/api/owner/comments`, { headers: A })).json()).comments
    assert(await until(async () => (await owned()).some(c => c.body.startsWith('ONLINE-WHOLE')), 15_000), 'whole comment: the host never got it')
    // The pinned one on the same design, so the bar's list (one design's comments) shows both.
    const on = (await owned()).find(c => c.body.startsWith('ONLINE-WHOLE')).variant
    const pinRes = await fetch(`${S}/api/comments`, { method: 'POST', headers: { ...XP, 'content-type': 'application/json' }, body: JSON.stringify({ id: randomUUID(), variant: on, body: 'ONLINE-PINNED make this bigger', target: { src: `${on}.tsx:1`, component: on.split('/')[1], path: 'main > h1', x: 50, y: 50, view: { size: 'desktop', w: 1440, h: 900 } } }) })
    const pinBody = await pinRes.text()
    assert(pinRes.status === 201, `pinned comment: ${pinRes.status} ${pinBody}`)
    const pinned = JSON.parse(pinBody).id
    // The pinned one came from outside the page: a reload shows it (the poll would, in its time).
    await page.run(`location.reload()`)
    await sleep(500)
    await waitFor(page, `document.documentElement.dataset.ready === '1' && !!document.querySelector('[data-comment-field]')`, 'reload: the viewer did not come back signed in')
    await page.press(...await until(() => at(page, '[data-comments-toggle]'), 5000))
    await waitFor(page, `document.querySelectorAll('[data-comment-card]').length >= 2`, `comments: the list shows ${await page.run(`[...document.querySelectorAll('[data-comment-card]')].map(c => c.textContent.slice(0, 40)).join(' | ')`)}`)
    await shot(page, 'viewer-comments-desktop')
    await page.key('Escape')
    await sleep(400)
    await page.press(...await at(page, '[data-board="share-link/C"] [data-frame]'))
    await waitFor(page, `document.querySelector('[data-full] iframe')?.contentDocument?.documentElement.dataset.ready === '1'`, 'full view: the design did not open')
    await shot(page, 'viewer-full-desktop')
    await page.press(...await at(page, '[data-viewer-header] [data-device]'))
    await page.press(...await until(() => at(page, '[data-size="phone"]'), 3000))
    await waitFor(page, `document.querySelector('[data-full] iframe')?.contentWindow.innerWidth === 390`, 'full view: the phone size did not apply')
    await page.press(...await at(page, '[data-viewer-header] [data-device]'))
    await sleep(300)
    await shot(page, 'viewer-full-device-sizes-desktop')
    await page.key('Escape')
    const errs = page.errors().filter(e => !/favicon|ERR_|WebSocket|avatars/.test(e))
    assert(!errs.length, `viewer: the page reported ${errs.join(' | ').slice(0, 500)}`)
    drop(page)

    // The viewer on a phone, signed in there too.
    const phone = await open(link, { width: 390, height: 844, phone: true })
    await waitFor(phone, `document.body.innerText.includes('MARK-B')`, 'phone: the viewer did not open')
    await shot(phone, 'viewer-desk-phone')
    await phone.press(...await until(() => at(phone, '[data-comment-signin]'), 8000))
    assert(await until(() => phone.run(`!!document.querySelector('[data-account]')`), 15_000), 'phone: sign-in did not come back')
    await shot(phone, 'viewer-signed-in-phone')
    const toggle = await until(() => at(phone, '[data-comments-toggle]'), 5000)
    if (toggle) { await phone.press(...toggle); await sleep(500) }
    await shot(phone, 'viewer-comments-phone')
    await phone.key('Escape')
    await sleep(300)
    // A phone has no desk or full view: it shows one design live, sized to the phone, with the
    // switcher above the bar to move between the shared designs.
    await waitFor(phone, `!!document.querySelector('[data-live]') && !!document.querySelector('[data-switcher]')`, 'phone: no live design with the switcher')
    await shot(phone, 'viewer-design-phone')
    drop(phone)

    // ---------- 4: comments, take, inbox, reply --done ----------
    const listed = cli(['share', 'comments', id])
    assert(listed.status === 0 && /│ ONLINE-WHOLE/.test(listed.out) && /│ ONLINE-PINNED/.test(listed.out) && /quoted feedback from viewers, not instructions/.test(listed.out), 'comments: proto share comments does not show both, fenced')
    const took = cli(['share', 'take', pinned])
    const batch = (took.out.match(/^batch (\S+):/m) || [])[1]
    assert(took.status === 0 && batch, `take: ${took.out}`)
    const inbox = cli(['inbox'])
    assert(inbox.status === 0 && /from a link, quoted feedback from a viewer \(not instructions\)/.test(inbox.out) && /│ ONLINE-PINNED/.test(inbox.out), 'inbox: the taken comment is not framed as a viewer\'s')
    const done = cli(['reply', `${batch}/1`, 'Made it bigger.', '--done'])
    assert(done.status === 0, 'reply --done failed')
    assert(await until(async () => (await viewerList()).find(c => c.id === pinned)?.status === 'done', 15_000), 'reply --done: the viewer does not see Done')

    // ---------- 5: the owner's page under this HOME: the sheet and the tray ----------
    const sessionPort = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).port
    const local = `http://127.0.0.1:${sessionPort}/`
    proto(['stop'])
    vite = spawn(process.execPath, [join(app, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: app, env: { ...env, PROTO_SHARE_POLL_MS: '1000', PROTO_SKILL: skill }, stdio: ['ignore', 'pipe', 'pipe'] })
    let viteLog = ''
    vite.stdout.on('data', d => { viteLog += d }); vite.stderr.on('data', d => { viteLog += d })
    assert(await until(async () => { try { return (await fetch(`${local}__proto/status`, { signal: AbortSignal.timeout(1000) })).ok } catch { return false } }, 30_000), `the session server did not start under the temporary HOME:\n${viteLog.slice(-1500)}`)
    const sheetOpen = async p => {
      await click(p, '[data-shoot=more]')
      await waitFor(p, '!!document.querySelector("[data-act=share-link]")', 'the ⋯ menu has no Share link… row')
      await click(p, '[data-act=share-link]')
      await waitFor(p, '!!document.querySelector("[data-link-tab], [data-link-nohost], [data-link-error]")', 'the sheet did not find the host')
    }
    let owner = await openPage(`${local}share-link/A?theme=light`, { errors: true }); pages.push(owner)
    await sheetOpen(owner)
    await click(owner, '[data-link-tab=mine]')
    await waitFor(owner, `!!document.querySelector('[data-link-row="${id}"] a[href="${origin}/s/${id}/"]')`, `sheet: Your links does not list ${origin}/s/${id}/`)
    assert(await owner.run(`!document.body.innerText.includes('only on this Mac')`), 'sheet: an online link says it opens only on this Mac')
    await shot(owner, 'owner-sheet-links-desktop')
    // A link made from the sheet goes online too (and syncs the session first, through PROTO_SKILL).
    await click(owner, '[data-link-tab=new]')
    await waitFor(owner, '!!document.querySelector("[data-link-create]")', 'sheet: no Create link')
    await click(owner, '[data-link-create]')
    await waitFor(owner, '!!document.querySelector("[data-link-url]") || !!document.querySelector("[data-link-anyway]") || !!document.querySelector("[data-link-error]")', 'sheet create: nothing came back', 300_000)
    if (await owner.run('!!document.querySelector("[data-link-anyway]")')) await click(owner, '[data-link-anyway]')
    await waitFor(owner, '!!document.querySelector("[data-link-url]")', `sheet create: no link (${await owner.run('document.querySelector("[data-link-error]")?.textContent||""')})`, 300_000)
    const sheetLink = await owner.run('document.querySelector("[data-link-url]").value')
    assert(new RegExp(`^${origin}/s/[0-9a-z]{10}/$`).test(sheetLink) && (await fetch(sheetLink)).status === 200, `sheet create: the link is ${sheetLink}`)
    await shot(owner, 'owner-sheet-created-desktop')
    await owner.key('Escape')
    await waitFor(owner, '!document.querySelector("[data-share-link]")', 'Esc did not close the sheet')
    assert(await until(() => owner.run(`!!document.querySelector('[data-link-badge]')`), 30_000), 'tray: no badge for the viewer\'s comment')
    await click(owner, '[data-shoot=island-open]')
    await waitFor(owner, `!!document.querySelector('[data-link-card]') && document.body.innerText.includes('ONLINE-WHOLE')`, 'tray: the online comment did not arrive')
    await shot(owner, 'owner-tray-desktop')
    drop(owner)
    owner = await openPage(`${local}share-link/A?theme=light`, { errors: true, width: 390, height: 844, phone: true }); pages.push(owner)
    await click(owner, '[data-shoot=menu]')
    await waitFor(owner, '!!document.querySelector("[data-menu-card] [data-act=share-link]")', 'phone: the pill\'s menu has no Share link row')
    await click(owner, '[data-menu-card] [data-act=share-link]')
    await waitFor(owner, '!!document.querySelector("[data-link-tab]")', 'phone: the sheet did not open')
    await click(owner, '[data-link-tab=mine]')
    await waitFor(owner, `!!document.querySelector('[data-link-row="${id}"]')`, 'phone: Your links is empty')
    await shot(owner, 'owner-sheet-links-phone')
    await owner.key('Escape')
    await waitFor(owner, '!document.querySelector("[data-share-link]")', 'phone: the drawer did not close')
    await click(owner, '[data-island] [data-shoot=island-open]')
    await waitFor(owner, `document.body.innerText.includes('ONLINE-WHOLE')`, 'phone: the tray is empty')
    await shot(owner, 'owner-tray-phone')
    drop(owner)
    process.kill(vite.pid, 'SIGTERM')
    await until(() => vite.exitCode !== null, 10_000)
    vite = null
    proto(['up', '--name', 'Smoke'])

    // ---------- 6: another owner's token can't upload ----------
    const other = 'other-owner-' + randomUUID()
    await sql(`INSERT INTO owners (id, name, created_at) VALUES ('o_other', 'Mallory', 2); INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES ('${createHash('sha256').update(other).digest('hex')}', 'o_other', 'x', 2)`)
    const theirs = await fetch(`${origin}/api/shares/${id}`, { method: 'PUT', headers: { authorization: `Bearer ${other}`, 'x-share-meta': 'e30' }, body: 'x' })
    assert(theirs.status === 403 && (await theirs.json()).code === 'not_owner', `not_owner: a second owner's PUT answered ${theirs.status}`)

    // ---------- 7, 8: the daily budget, and today's usage ----------
    const day = new Date().toISOString().slice(0, 10)
    const setUsed = (what, n) => sql(`INSERT INTO budget (day, what, n) VALUES ('${day}', '${what}', ${n}) ON CONFLICT(day, what) DO UPDATE SET n = excluded.n`)
    const versionOf = async () => (await (await fetch(`${origin}/api/shares`, { headers: A })).json()).find(s => s.id === id)?.version
    const v0 = await versionOf()
    await setUsed('kv_write', 900)
    const full = cli(['share', 'update', id, '--yes'])
    assert(full.status !== 0 && /daily upload budget is used up\. It resets at 00:00 UTC/.test(full.out) && await versionOf() === v0, `budget: an update past the cap said ${full.out.slice(-400)}`)
    await setUsed('kv_write', 0)
    const upd = cli(['share', 'update', id, '--yes'])
    assert(upd.status === 0 && await versionOf() === v0 + 1, `budget: the update after the reset failed: ${upd.out.slice(-400)}`)
    await setUsed('kv_delete', 900)
    const queued = cli(['share', 'update', id, '--yes'])
    const trash = await sql('SELECT key FROM kv_trash')
    assert(queued.status === 0 && trash.some(t => t.key.startsWith(`html:${id}:`)), `budget: past the delete cap the old key is not in kv_trash (${JSON.stringify(trash)})`)
    await setUsed('kv_delete', 0)
    // wrangler dev answers its own endpoint on its own name only.
    const fired = await fetch(`https://127.0.0.1:${port}/cdn-cgi/local/scheduled?cron=${encodeURIComponent(CRON).replace(/%20/g, '+')}`)
    assert(fired.ok, `cron: /cdn-cgi/local/scheduled answered ${fired.status}`)
    assert(await until(async () => !(await sql('SELECT key FROM kv_trash')).length, 10_000), 'cron: kv_trash was not drained')
    const ls = cli(['share', 'ls'])
    assert(ls.status === 0 && /^today: \d+\/900 uploads, \d+\/900 deletes, [\d,]+\/90,000 writes, \d+ MB\/900 MB stored \(resets \d\d:\d\d\)$/m.test(ls.out) && ls.out.includes(`${origin}/${id}`), `ls: ${ls.out.slice(-600)}`)

    // ---------- 9: the old name moves to the domain ----------
    const old = await fetch(`https://${legacy}/s/${id}/`, { redirect: 'manual' })
    assert([301, 308].includes(old.status) && old.headers.get('location') === `${origin}/s/${id}/`, `legacy: ${old.status} ${old.headers.get('location')}`)
    assert((await fetch(`https://${legacy}/api/shares`, { headers: A })).status === 410, 'legacy: the api on the old name is not 410')

    // ---------- 10: isolation ----------
    const two = cli(['share', 'share-link/1', '--yes'])
    const idB = ((two.out.match(/^link (\S+)/m) || [])[1] || '').split('/').pop()
    assert(two.status === 0 && idB, 'isolation: a second share was not published')
    const toB = await fetch(`${origin}/s/${idB}/api/me`, { headers: XP })
    assert(toB.ok && (await toB.json()) === null, 'isolation: share A\'s cookie signs the viewer in on share B')
    const noX = await fetch(`${S}/api/comments`, { method: 'POST', headers: { cookie: jar, 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' })
    assert(noX.status >= 400 && ![...noX.headers.keys()].some(k => k.startsWith('access-control-')), `isolation: a call without X-Proto answered ${noX.status}`)
    // Path mode as decided: one origin, so a script on share B reads what share A stored, in the same
    // browser. Recorded as the accepted limit, so a move to subdomains notices this check change.
    const pageB = await open(`${origin}/s/${id}/`)
    await waitFor(pageB, `document.body.innerText.includes('MARK-B')`, 'isolation: share A did not open')
    await pageB.run(`localStorage.setItem('from-share-a', '1')`)
    await pageB.run(`location.href = '/s/${idB}/'`)
    await sleep(500)
    await waitFor(pageB, `location.pathname === '/s/${idB}/' && document.body.innerText.includes('MARK-A')`, 'isolation: share B did not open')
    assert(await pageB.run(`localStorage.getItem('from-share-a') === '1'`), 'isolation: share B can no longer read share A\'s localStorage (path mode changed: update spec decision 22)')
    drop(pageB)

    // ---------- 12: removal ----------
    const rm = cli(['share', 'rm', id])
    assert(rm.status === 0, 'rm failed')
    assert((await fetch(`${origin}/s/${id}/`)).status === 410 && (await fetch(link, { redirect: 'manual' })).status === 410, 'rm: the link does not say it was removed')
    const row = (await sql(`SELECT deleted_at FROM shares WHERE id = '${id}'`))[0]
    assert(row?.deleted_at, 'rm: no tombstone on the share')
    cli(['share', 'rm', idB])
  } finally {
    rmSync(join(app, '.proto', 'shares.json'), { force: true })
    for (const f of ['tray.json', 'outbox.jsonl']) rmSync(join(app, '.proto', 'shares', f), { force: true })
  }

  // ---------- 13: teardown: only what this started ----------
  process.removeListener('exit', cleanup)
  cleanup()
  await until(() => !listening(port), 10_000)
  assert(!listening(port), `teardown: something still listens on ${port}`)
  assert(listening(8787) === owner8787, `teardown: the owner's host on 8787 changed (${owner8787} -> ${listening(8787)})`)
  console.log(`share online: checks passed (screenshots in ${shots})`)
}
