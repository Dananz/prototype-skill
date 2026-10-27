// The bar's Share popover and the viewer's message, in a real Chrome with the session server's share
// routes (/__proto/share/*) and the share's host routes (api/*) answered by the check itself, so the
// page is driven through every view without a host, GitHub or a network: the button's amber dot and
// green count; signed out, Sign in with GitHub opening the claim page in a new tab and the popover
// turning to the links once `owner` says so; home with a link behind its edits and Update; New link
// with a starter and a message, the review, Create link and the link; Choose… opening the sheet with
// the message; Esc and a press outside; a publish refused for sign-in; Hebrew once; the phone's pill
// menu still opening the sheet. Then a share built for real (the session's own share build) served
// here, its owner's message on the first visit, folded into the comments, "Shared by", and the
// presence ping.
//
// Standalone: node .github/share-popover-checks.mjs [--shots <dir>] [--keep]
// It makes a scratch project with a session of its own (proto up, proto add), and removes it after.
// Playwright: playwright-core from PLAYWRIGHT_CORE (a folder), else the npx cache; Chrome for Testing
// from PROTO_CHROME, else ~/Library/Caches/ms-playwright/chromium-*/.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
const shots = arg('--shots') || process.env.PROTO_POPOVER_SHOTS || join(tmpdir(), 'proto-shots', 'share-popover')
const keep = process.argv.includes('--keep')
const sleep = ms => new Promise(r => setTimeout(r, ms))

function playwright() {
  const roots = [process.env.PLAYWRIGHT_CORE, ...(() => { try { return readdirSync(join(homedir(), '.npm', '_npx')).map(d => join(homedir(), '.npm', '_npx', d, 'node_modules', 'playwright-core')) } catch { return [] } })()].filter(Boolean)
  const found = roots.find(r => existsSync(join(r, 'package.json')))
  if (!found) { console.error('No playwright-core found: set PLAYWRIGHT_CORE to its folder (npx playwright-core --version installs one).'); process.exit(1) }
  return createRequire(join(found, 'package.json'))(found)
}
function chromePath() {
  if (process.env.PROTO_CHROME) return process.env.PROTO_CHROME
  const base = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  const dirs = existsSync(base) ? readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().reverse() : []
  for (const d of dirs) {
    const exe = join(base, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
    if (existsSync(exe)) return exe
  }
  return undefined
}

// ---------- the session ----------
const scratch = mkdtempSync(join(tmpdir(), 'proto-popover-run-'))
const project = join(scratch, 'proto-popover')
const app = join(project, '.prototypes', 'smoke')
mkdirSync(project, { recursive: true })
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'proto-popover', private: true, dependencies: { react: '^19.2.0' } }))
const env = { ...process.env, PROTO_NO_GC: '1', PROTO_SHARE_POLL_MS: '0' }
const proto = (args, ok = true) => {
  console.log(`$ proto ${args.join(' ')}`)
  const r = spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), ...args, '--project', project, '--session', 'smoke'], { encoding: 'utf8', env, timeout: 600_000 })
  if (ok && r.status !== 0) { process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); throw new Error(`proto ${args[0]} exited ${r.status}`) }
  return (r.stdout || '') + (r.stderr || '')
}
let browser = null, viewerServer = null
const cleanup = async () => {
  try { await browser?.close() } catch { /* gone */ }
  viewerServer?.close()
  if (!keep) {
    if (existsSync(join(app, 'session.json'))) spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), 'rm', '--project', project, '--session', 'smoke'], { stdio: 'ignore', env, timeout: 60_000 })
    rmSync(scratch, { recursive: true, force: true })
  } else console.log(`kept: ${app}`)
}
let passed = 0
const ok = (cond, why) => { if (!cond) throw new Error(why); passed++; console.log(`  ok  ${why}`) }

// ---------- the answers the check gives ----------
const now = Date.now()
const iso = ago => new Date(now - ago).toISOString()
const face = (letter, hue) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${hue} 55% 45%)"/><text x="32" y="42" font-family="sans-serif" font-size="28" font-weight="600" fill="#fff" text-anchor="middle">${letter}</text></svg>`)}`
const OWNER_IN = { host: 'Smoke', signedIn: true, login: 'Dananz', name: 'Tomer Danan', avatar: face('T', 265), signin: true }
const OWNER_OUT = { host: 'Smoke', signedIn: false, login: null, name: null, avatar: null, signin: true }
const shareRows = () => [
  { id: 'k3x9p2', title: 'Share link', scope: { protos: [{ id: 'share-link', variants: ['A', 'B', 'C'] }], start: 'share-link/A' }, version: stub.hereVersion, publishedAt: iso(3 * 3600e3), host: 'Smoke',
    link: 'https://prtype.dev/k3x9p2', changed: stub.hereVersion === 2, comments: { total: 3, new: 2 }, live: true, views: 14, message: 'Which one would you pick?',
    viewers: [{ login: 'dana', name: 'Dana', avatar: face('D', 160), route: 'share-link/B', at: now - 30e3, now: true }, { login: 'eli', name: 'Eli', avatar: face('E', 30), route: 'share-link/A', at: now - 86400e3, now: false }],
    changedVariants: stub.hereVersion === 2 ? [{ key: 'share-link/B', name: 'Two' }, { key: 'share-link/*', name: 'Shared parts' }] : [] },
  { id: 'r8m2kq', title: 'Answer types', scope: { protos: [{ id: 'answers', variants: ['A'] }], start: 'answers/A' }, version: 1, publishedAt: iso(26 * 3600e3), host: 'Smoke',
    link: 'https://prtype.dev/r8m2kq', changed: false, comments: { total: 5, new: 0 }, live: true, views: 6, viewers: [{ login: 'eli', name: 'Eli', avatar: null, route: 'answers/A', at: now - 20 * 3600e3, now: false }], changedVariants: [] },
  { id: 'p2v7wd', title: 'Portion drawer', scope: { protos: [{ id: 'portion', variants: ['A', 'B'] }], start: 'portion/A' }, version: 3, publishedAt: iso(50 * 3600e3), host: 'Smoke',
    link: 'https://prtype.dev/p2v7wd', changed: true, comments: { total: 0, new: 0 }, live: true, views: 2, viewers: [], changedVariants: [{ key: 'portion/B', name: 'Stacked' }] },
]
const stub = { owner: OWNER_OUT, hereVersion: 2, publish: [], update: [], signin: 0, publishRefuse: false, publishDelay: 0 }
const answer = (name, body) => {
  if (name === 'owner') return [200, stub.owner]
  if (name === 'signin') { stub.signin++; return [200, { url: `${local}__claim-test?claim=abc` }] }
  if (name === 'list') return [200, { host: { name: 'Smoke', stage: 'online', owner: stub.owner.login || '' }, hostError: null, shares: shareRows(), setup: 'proto share setup' }]
  if (name === 'publish') {
    stub.publish.push(body)
    if (stub.publishRefuse) return [409, { code: 'sign_in', error: 'Sign in with GitHub first.' }]
    if (!body.yes) return [200, { ok: false, needsYes: true, review: { sizeMiB: 1.4, block: [], notes: ['One design loads a font from the internet.'] } }]
    return [200, { ok: true, link: 'https://prtype.dev/x7c4hq', share: { id: 'x7c4hq', title: 'Share link', version: 1 } }]
  }
  if (name === 'update') { stub.update.push(body); stub.hereVersion = 3; return [200, { ok: true, link: 'https://prtype.dev/k3x9p2', share: { id: body.id, version: 3 } }] }
  if (name === 'comments') return [200, { comments: [], new: 0 }]
  return [404, { error: `no route ${name}` }]
}
let local = ''

async function main() {
  const out = proto(['up', '--name', 'Popover'])
  local = (out.match(/^local (\S+)/m) || out.match(/^url (\S+)/m) || [])[1]
  if (!local) throw new Error(`proto up gave no url:\n${out}`)
  proto(['add', 'share-link', '--title', 'Share link', '--variants', 'A:One,B:Two,C:Three'])
  const colors = { A: '#2563eb', B: '#16a34a', C: '#db2777' }
  for (const id of ['A', 'B', 'C']) writeFileSync(join(app, 'src/protos/share-link', `${id}.tsx`), `export default function ${id}() { return <main style={{ minHeight: '100vh', background: '${colors[id]}', color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', fontSize: 56 }}><h1>Variant ${id}</h1></main> }\n`)
  proto(['done', 'share-link'])
  mkdirSync(shots, { recursive: true })

  const { chromium } = playwright()
  browser = await chromium.launch({ executablePath: chromePath(), headless: true })
  const errors = []
  const newPage = async (path, { width = 1440, height = 900, phone = false, dark = true } = {}) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, colorScheme: dark ? 'dark' : 'light' })
    await context.route('**/__proto/share/**', async r => {
      const name = new URL(r.request().url()).pathname.split('/__proto/share/')[1]
      let body = {}
      try { body = r.request().postDataJSON() ?? {} } catch { /* none */ }
      const [status, json] = answer(name, body)
      if (name === 'publish' && stub.publishDelay) await sleep(stub.publishDelay)
      await r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) })
    })
    await context.route('**/__claim-test**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Signed in as Dananz. You can close this tab.</p>' }))
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(`${path}: ${e.message}`))
    await page.goto(`${local}${path}`)
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60_000 })
    return { page, context }
  }
  const shot = async (page, name) => { await sleep(400); await page.screenshot({ path: join(shots, `${name}.png`) }); console.log(`  shot ${join(shots, `${name}.png`)}`) }
  const pop = page => page.locator('[data-share-pop]')
  const isOpen = async page => (await pop(page).getAttribute('data-share-pop')) === 'open'

  // 1. The bar's Share button: before ⋯, an amber dot (a link is behind), a green 1 (Dana is in a link now).
  let { page, context } = await newPage('share-link/A?theme=dark')
  const btn = page.locator('[data-share-btn]')
  await btn.waitFor({ state: 'visible' })
  await page.locator('[data-share-behind]').waitFor({ timeout: 10_000 })
  ok(await page.locator('[data-share-btn] [data-share-now]').innerText() === '1', 'the Share button counts 1 person in a link now')
  ok(await page.evaluate(() => { const b = document.querySelector('[data-share-btn]'), m = document.querySelector('[data-bar] [data-act="open:more"]'); return !!b && !!m && !!(b.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) }), 'the Share button sits before ⋯')
  ok(!(await btn.getAttribute('class')).includes('bg-proto-primary'), 'the Share button is a bar button, not a filled pill')
  await shot(page, 'bar-share-button')

  // 2. Signed out: the sign-in step. Sign in opens the claim page in a new tab, and the popover turns to the links once the owner is signed in.
  await btn.click()
  await page.locator('[data-link-gate]').waitFor()
  ok(await isOpen(page), 'the popover opens under the button')
  const [b, p] = [await btn.boundingBox(), await pop(page).boundingBox()]
  ok(Math.abs((b.x + b.width) - (p.x + p.width)) < 2 && p.y > b.y + b.height, 'the popover is anchored under the button, at its end')
  await shot(page, 'popover-signed-out')
  const [tab] = await Promise.all([context.waitForEvent('page'), page.locator('[data-link-signin]').click()])
  await tab.waitForURL(/__claim-test\?claim=abc/, { timeout: 10_000 })
  ok(true, `Sign in with GitHub opened ${tab.url()}`)
  await page.getByText('Waiting for GitHub…').waitFor()
  ok(true, 'the popover says it is waiting for GitHub')
  stub.owner = OWNER_IN
  await page.locator('[data-pop-here]').waitFor({ timeout: 10_000 })
  ok(true, 'signed in: the popover turns to the links')
  await tab.close()

  // 3. Home: as Dananz, this prototype's link behind its edits, who is looking, views and new comments.
  ok((await page.locator('[data-share-pop] header').innerText()).includes('as Dananz'), 'home says Share as Dananz')
  ok((await page.locator('[data-pop-looking]').innerText()).includes('Dana is looking at #2 Two'), 'home says who is in the link now and where')
  ok((await page.locator('[data-pop-views]').innerText()) === '14 views', 'home shows the views')
  ok((await page.locator('[data-pop-new]').innerText()) === '2 new', 'home marks the new comments')
  ok((await page.locator('[data-pop-behind]').innerText()).includes('You changed 1 variant since v2'), 'home says the link fell behind')
  ok((await page.locator('[data-pop-changed] li').allInnerTexts()).join('|') === '#2 Two|Shared parts', 'home lists the changed variants and shared parts')
  ok(await page.locator('[data-pop-row]').count() === 2, 'home lists the other links')
  ok(await page.locator('[data-pop-row="p2v7wd"] [data-pop-row-update]').count() === 1 && await page.locator('[data-pop-row="r8m2kq"] [data-pop-row-update]').count() === 0, 'only the other link behind offers Update')
  await page.locator('[data-pop-note]').fill('The tiles are bigger now')
  await page.locator('[data-link-preview] canvas.opacity-100').waitFor({ timeout: 30_000 }).catch(() => {})
  await shot(page, 'popover-home-behind')
  await page.locator('[data-pop-update]').click()
  await page.locator('[data-pop-updated]').waitFor()
  ok(stub.update.at(-1)?.id === 'k3x9p2' && stub.update.at(-1)?.note === 'The tiles are bigger now', 'Update sends the link and the note')
  await page.locator('[data-pop-here][data-version="3"]').waitFor()
  ok(await page.locator('[data-pop-behind]').count() === 0, 'updated: the link is at v3 and no longer behind')
  ok(await page.locator('[data-share-behind]').count() === 1, 'the bar keeps its amber dot while another link is behind')

  // 4. New link: a starter, then the owner's own words; the review; Create link; the link with the message quoted.
  await page.locator('[data-pop-new-link]').click()
  await page.locator('[data-share-pop] [data-link-what=proto][aria-checked=true]').waitFor()
  ok((await page.locator('[data-pop-opens]').innerText()).includes('Opens on Share link · 1 One'), 'New link says where the link opens')
  await page.locator('[data-share-pop] [data-link-starter]').first().click()
  ok(await page.locator('[data-share-pop] [data-link-message]').inputValue() === 'Which one would you pick?', 'a starter fills the message')
  // Typed for real: letters stay in the field (no shortcut fires), Esc from the field still closes.
  await page.locator('[data-share-pop] [data-link-message]').fill('')
  await page.locator('[data-share-pop] [data-link-message]').focus()
  await page.keyboard.type('fprx')
  ok(await page.locator('[data-share-pop] [data-link-message]').inputValue() === 'fprx' && await isOpen(page) && await page.evaluate(() => location.pathname) === '/share-link/A', 'typing in the message stays in it: no shortcut fires')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('[data-share-pop]')?.getAttribute('data-share-pop') === 'closed')
  ok(true, 'Esc from the message closes the popover')
  await btn.click()
  ok(await page.locator('[data-pop-here]').count() === 1, 'closed with nothing under way, it opens on home again')
  await page.locator('[data-pop-new-link]').click()
  ok(await page.locator('[data-share-pop] [data-link-message]').inputValue() === 'fprx', 'the message written so far is kept')
  await page.locator('[data-share-pop] [data-link-message]').fill('Which one would you pick? The tiles or the rows?')
  await shot(page, 'popover-new-link')
  await page.locator('[data-share-pop] [data-link-create]').click()
  await page.locator('[data-share-pop] [data-link-review]').waitFor()
  ok(true, 'Create link shows the review first')
  // Closed while the link is being built: it goes on, and the popover opens on it.
  stub.publishDelay = 1500
  await page.locator('[data-share-pop] [data-link-anyway]').click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('[data-share-pop]')?.getAttribute('data-share-pop') === 'closed')
  await sleep(1800)
  stub.publishDelay = 0
  await btn.click()
  await page.locator('[data-share-pop] [data-link-made]').waitFor()
  ok(true, 'a link made while the popover was closed is there when it opens')
  const sent = stub.publish.at(-1)
  ok(sent.message === 'Which one would you pick? The tiles or the rows?' && sent.yes === true && sent.scope.join() === 'share-link/A,share-link', `publish sends the scope and the message (${JSON.stringify(sent)})`)
  ok((await page.locator('[data-link-made-message]').innerText()).includes('The tiles or the rows?'), 'the link made quotes the message')
  await shot(page, 'popover-made')

  // 5. Esc closes it and gives the focus back to the button; a press outside closes it.
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('[data-share-pop]')?.getAttribute('data-share-pop') === 'closed')
  ok(await page.evaluate(() => document.activeElement?.hasAttribute('data-share-btn')), 'Esc closes the popover and the focus goes back to Share')
  await btn.click()
  await page.waitForFunction(() => document.querySelector('[data-share-pop]')?.getAttribute('data-share-pop') === 'open')
  await page.mouse.click(300, 700)
  await page.waitForFunction(() => document.querySelector('[data-share-pop]')?.getAttribute('data-share-pop') === 'closed')
  ok(true, 'a press outside closes the popover')

  // 6. Choose… opens the full sheet with the message so far; a publish refused for sign-in shows the sign-in step.
  await btn.click()
  await page.locator('[data-pop-new-link]').click()
  await page.locator('[data-share-pop] [data-link-message]').fill('Is the price clear?')
  await page.locator('[data-pop-choose]').click()
  await page.locator('[data-share-link]').waitFor()
  ok(await page.locator('[data-share-link] [data-link-message]').inputValue() === 'Is the price clear?', 'Choose… opens the sheet with the message')
  ok(await page.locator('[data-share-link] [data-link-what=proto][aria-checked=true]').count() === 1, 'Choose… keeps what was picked')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[data-share-link]'))
  stub.publishRefuse = true
  await btn.click()
  await page.locator('[data-pop-new-link]').click()
  await page.locator('[data-share-pop] [data-link-create]').click()
  await page.locator('[data-share-pop] [data-link-gate]').waitFor()
  ok(true, 'a publish refused for sign-in turns the popover to the sign-in step')
  stub.publishRefuse = false
  await page.keyboard.press('Escape')
  await context.close()

  // 6b. The full sheet, signed out: its New link is the sign-in step; signed in, its message goes with the link.
  stub.owner = OWNER_OUT
  ;({ page, context } = await newPage('share-link/A?theme=dark'))
  await page.locator('[data-shoot=more]').click()
  await page.locator('[data-act=share-link]').click()
  await page.locator('[data-share-link] [data-link-gate]').waitFor()
  ok(true, 'the sheet, signed out: New link is the sign-in step')
  stub.owner = OWNER_IN
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[data-share-link]'))
  await page.locator('[data-shoot=more]').click()
  await page.locator('[data-act=share-link]').click()
  await page.locator('[data-share-link] [data-link-message]').waitFor()
  await page.locator('[data-share-link] [data-link-message]').fill('Does the copy read well?')
  await page.locator('[data-share-link] [data-link-create]').click()
  await page.locator('[data-share-link] [data-link-anyway]').click()
  await page.locator('[data-share-link] [data-link-made-message]').waitFor()
  ok(stub.publish.at(-1).message === 'Does the copy read well?', 'the sheet sends its message with the link')
  await context.close()

  // 7. Hebrew: the popover opens from the button's start side, right to left.
  ;({ page, context } = await newPage('share-link/A?theme=dark&lang=he'))
  await page.locator('[data-share-btn]').click()
  await page.locator('[data-pop-here]').waitFor()
  const [hb, hp] = [await page.locator('[data-share-btn]').boundingBox(), await pop(page).boundingBox()]
  ok(await page.evaluate(() => document.documentElement.dir) === 'rtl' && Math.abs(hb.x - hp.x) < 2, 'Hebrew: the popover lines up with the button\'s start, right to left')
  ok((await page.locator('[data-share-pop] header').innerText()).includes('בתור Dananz'), 'Hebrew: the popover speaks Hebrew')
  await shot(page, 'popover-home-he')
  await context.close()

  // 8. A phone: no Share in the bar; the pill's menu opens the sheet's drawer.
  ;({ page, context } = await newPage('share-link/A?theme=dark', { width: 390, height: 844, phone: true }))
  ok(!(await page.locator('[data-share-btn]').isVisible()), 'phone: no Share button in the bar')
  await page.locator('[data-shoot=menu]').click()
  await page.locator('[data-menu-card] [data-act=share-link]').click()
  await page.locator('[data-share-link][data-phone]').waitFor()
  ok(await page.locator('[data-share-link] [data-link-message]').count() === 1, 'phone: the sheet\'s drawer has the message field')
  await context.close()

  // 9. The viewer: a share of the session built for real, served here, its host answered here.
  const { buildShare } = await import(pathToFileURL(join(app, 'share', 'build.mjs')).href)
  const built = await buildShare({ sessionDir: app, scope: { protos: [{ id: 'share-link', variants: ['A', 'B', 'C'] }], start: 'share-link/A' }, info: { title: 'Share link', owner: 'Dananz', version: 2 } })
  viewerServer = createServer((req, res) => {
    if (req.url.startsWith('/s/abc/') && !req.url.includes('/api/')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(built.html); return }
    res.writeHead(404); res.end()
  })
  await new Promise(r => viewerServer.listen(0, '127.0.0.1', r))
  const viewer = `http://127.0.0.1:${viewerServer.address().port}/s/abc/`
  const here = [], posted = []
  // One comment by this viewer that the owner answered: its card offers Reply.
  const first = { id: '11111111-1111-4111-8111-111111111111', variant: 'share-link/A', body: 'test', target: null, status: 'new', owner_reply: 'aaahh', owner_reply_at: now - 60e3, re: null, author: { login: 'dana', name: 'Dana', avatar: null }, mine: true, created_at: now - 120e3, updated_at: now - 60e3, version: 2, done_in: null }
  const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await vctx.route('**/s/abc/api/**', async r => {
    const path = new URL(r.request().url()).pathname.split('/s/abc/api/')[1]
    const json = path === 'config' ? { comments: true, owner: 'Dananz' }
      : path === 'me' ? { login: 'dana', name: 'Dana', avatar: face('D', 160) }
      : path === 'state' ? { version: 2, updatedAt: now - 3600e3, message: 'Which one would you pick? The tiles or the rows?', note: 'The tiles are bigger now', owner: { login: 'Dananz', name: 'Tomer Danan', avatar: face('T', 265) } }
      : path.startsWith('comments') ? { comments: [first, ...posted], removed: [], now: Date.now() }
      : null
    if (path === 'here') { here.push(r.request().postDataJSON()); return r.fulfill({ status: 204 }) }
    if (path === 'comments' && r.request().method() === 'POST') {
      const b = r.request().postDataJSON()
      const row = { ...first, id: b.id, body: b.body, re: b.re ?? null, owner_reply: null, owner_reply_at: null, created_at: Date.now(), updated_at: Date.now() }
      posted.push(row)
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(row) })
    }
    if (!json) return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
  })
  const vpage = await vctx.newPage()
  vpage.on('pageerror', e => errors.push(`viewer: ${e.message}`))
  await vpage.goto(`${viewer}?theme=dark`)
  await vpage.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60_000 })
  await vpage.locator('[data-owner-message]').waitFor({ timeout: 10_000 })
  ok((await vpage.locator('[data-owner-message]').innerText()).includes('Dananz: Which one would you pick?'), 'viewer: the owner\'s message shows first')
  ok(await vpage.locator('[data-shared-by="Dananz"]').count() === 1 && (await vpage.locator('[data-shared-by]').innerText()).startsWith('Shared by Dananz'), 'viewer: the header says Shared by Dananz with the avatar')
  await vpage.waitForFunction(() => true)
  for (const end = Date.now() + 5000; !here.length && Date.now() < end;) await sleep(100)
  ok(here[0]?.route === 'share-link/A', `viewer: a signed-in viewer pings api/here with the route (${JSON.stringify(here[0])})`)
  await shot(vpage, 'viewer-message')
  await vpage.locator('[data-owner-message-fold]').click()
  await vpage.reload()
  await vpage.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60_000 })
  await sleep(800)
  ok(await vpage.locator('[data-owner-message]').count() === 0, 'viewer: once read, the message stays folded on the next visit')
  ok(await vpage.locator('[data-owner-message-folded]').count() === 1, 'viewer: folded, the message sits at the top of the comments')

  // A viewer answers the owner's reply: Reply under it, the field, Enter; the reply sits in the thread.
  await vpage.locator('[data-comments-toggle]').click()
  await vpage.locator(`[data-comment-card="${first.id}"] [data-reply]`).waitFor({ timeout: 10_000 })
  ok(true, 'viewer: a comment the owner answered offers Reply')
  await vpage.locator(`[data-comment-card="${first.id}"] [data-reply]`).click()
  await vpage.locator('[data-reply-box]').fill('thanks, looks better')
  await vpage.locator('[data-reply-box]').press('Enter')
  await vpage.locator(`[data-comment-card="${first.id}"] [data-thread-reply]`).waitFor({ timeout: 10_000 })
  ok(posted[0]?.re === first.id && posted[0]?.body === 'thanks, looks better', `viewer: the reply is posted with re (${JSON.stringify(posted[0])})`)
  ok((await vpage.locator(`[data-comment-card="${first.id}"] [data-thread-reply]`).innerText()).includes('thanks, looks better'), 'viewer: the reply shows inside the thread, not as a card of its own')
  ok(await vpage.locator('[data-comment-card]').count() === 1, 'viewer: replies get no card or pin of their own')
  await shot(vpage, 'viewer-reply')

  ok(!errors.length, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
}

try {
  await main()
  console.log(`\nOK: share popover checks (${passed} passed), shots in ${shots}`)
  await cleanup()
  process.exit(0)
} catch (e) {
  console.error(`\nFAILED: ${e?.stack || e}`)
  await cleanup()
  process.exit(1)
}
