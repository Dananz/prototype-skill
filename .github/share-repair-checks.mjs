// Published-link repair in the owner's real shell. Stand in for the remote host's list only;
// repair requests still pass through the session server into its real inbox and CLI output.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function shareRepairChecks({ proto, app, local, openPage, fail, keepShots, before = false }) {
  proto(['add', 'repair-link', '--title', 'Account settings', '--variants', 'A:Profile,B:Security'])
  for (const id of ['A', 'B']) writeFileSync(join(app, 'src/protos/repair-link', `${id}.tsx`), `export default function ${id}() { return <main className="min-h-screen bg-slate-50 p-10"><h1 className="text-3xl font-semibold">Account settings</h1><p className="mt-3 text-slate-500">${id === 'A' ? 'Your profile and preferences.' : 'Keep your account secure.'}</p></main> }\n`)
  const inbox = join(app, '.proto/inbox/new')
  const batches = () => existsSync(inbox) ? readdirSync(inbox).filter(n => !n.startsWith('.')) : []
  const seen = new Set(batches())
  const assert = (ok, why) => { if (!ok) fail(`share repair: ${why}`) }
  const row = {
    id: 'repair123', title: 'Account settings', version: 4, publishedAt: '2026-11-11T10:00:00Z',
    scope: { protos: [{ id: 'repair-link', variants: ['A', 'B'] }], start: 'repair-link/B' },
    host: 'local-test', link: 'https://repair123.prtype.dev/', changed: false, comments: { total: 3, new: 0 }, live: true,
  }
  const listed = {
    host: { name: 'local-test', stage: 'online', owner: 'Tomer' }, hostError: null,
    shares: [row], elsewhere: [{ ...row, id: 'other123', title: 'Another project', elsewhere: true, project: 'other-project' }],
  }
  const wait = async (page, code, why) => {
    for (const end = Date.now() + 15_000; Date.now() < end; await sleep(100)) if (await page.run(code)) return
    assert(false, why)
  }
  const click = (p, s) => p.run(`document.querySelector(${JSON.stringify(s)})?.click()`)
  const type = (p, text) => p.run(`(()=>{const e=document.querySelector('[data-link-repair-note]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const shot = async (p, name) => { await sleep(300); await p.screenshot(join(keepShots, `repair-${before ? 'before' : 'after'}-${name}.png`)) }
  const take = async () => {
    for (const end = Date.now() + 10_000; Date.now() < end; await sleep(100)) {
      const name = batches().find(n => !seen.has(n))
      if (name) { seen.add(name); return { name, batch: JSON.parse(readFileSync(join(inbox, name, 'batch.json'), 'utf8')) } }
    }
    assert(false, 'Send did not put a request in the inbox')
  }

  for (const [name, opts, lang] of [
    ['desktop', { width: 1280, height: 800 }, 'en'],
    ['phone-he', { width: 390, height: 844, phone: true }, 'he'],
  ]) {
    if (opts.phone && !before) rmSync(join(app, 'src/protos/repair-link/B.tsx'))
    const page = await openPage(`${local}repair-link/A?theme=light&lang=${lang}`, { ...opts, errors: true })
    try {
      await page.run(`(()=>{const real=window.fetch;window.__repairFailure=false;window.fetch=(u,o)=>{
        if(String(u).includes('/share/list'))return Promise.resolve(Response.json(${JSON.stringify(listed)}));
        if(String(u).includes('/share/owner'))return Promise.resolve(Response.json({host:'local-test',signedIn:true,signin:true,login:'Tomer'}));
        if(window.__repairFailure&&String(u).endsWith('/comments'))return Promise.reject(new Error('Connection interrupted'));
        if(window.__repairDelay&&String(u).endsWith('/comments'))return real(u,o).then(async r=>{await new Promise(resolve=>{window.__releaseRepair=resolve});return r});
        return real(u,o)
      };window.dispatchEvent(new Event('focus'))})()`)
      const container = opts.phone ? '[data-link-row="repair123"]' : '[data-pop-here="repair123"]'
      // The phone opens the Share sheet from its pill menu.
      if (opts.phone) {
        await click(page, '[data-pill-menu]')
        await wait(page, `!!document.querySelector('[data-card] [data-act="share-link"]')`, 'phone: no Share menu item')
        await click(page, '[data-card] [data-act="share-link"]')
        await wait(page, `!!document.querySelector('[data-link-tab=mine]')`, 'phone: Share sheet missing')
        await click(page, '[data-link-tab=mine]')
      } else {
        await click(page, '[data-share-btn]')
        await wait(page, `!!document.querySelector('[data-pop-here="repair123"]')`, `${name}: link missing from Share`)
        await click(page, '[data-pop-here="repair123"] [data-pop-more]')
      }
      await wait(page, `!!document.querySelector('${container} [data-link-disable]')`, `${name}: link options missing`)
      await shot(page, `${name}-options`)
      if (before) continue

      assert(await page.run(`!!document.querySelector('${container} [data-link-repair]')`), `${name}: no Fix prototype action`)
      if (!opts.phone) {
        await click(page, '[data-pop-elsewhere] [data-pop-more]')
        assert(await page.run(`!document.querySelector('[data-pop-elsewhere] [data-link-repair]')`), 'another project incorrectly offers repair here')
      }
      await click(page, `${container} [data-link-repair]`)
      await wait(page, `!!document.querySelector('[data-link-repair-cancel]')`, 'repair did not open')
      await click(page, '[data-link-repair-cancel]')
      await wait(page, `document.activeElement===document.querySelector('${container} [data-link-repair]')`, 'Cancel did not restore keyboard focus')
      await click(page, `${container} [data-link-repair]`)
      await wait(page, `document.activeElement===document.querySelector('[data-link-repair-note]')`, 'repair does not focus the optional description')
      assert(await page.run(`!document.querySelector('[data-link-repair-send]').disabled && !document.querySelector('[data-link-repair-note]').required`), 'a blank description cannot be sent')
      if (opts.phone) await type(page, 'המסכים לא מתחלפים והטעינה איטית')
      await shot(page, `${name}-describe`)

      // A failed send preserves the description, keeps retry available, and creates no batch.
      if (opts.phone) {
        await page.run('window.__repairFailure=true')
        await click(page, '[data-link-repair-send]')
        await wait(page, `!!document.querySelector('${container} [role=alert]')`, 'send failure is hidden')
        assert(await page.run(`document.querySelector('[data-link-repair-note]').value==='המסכים לא מתחלפים והטעינה איטית' && !document.querySelector('[data-link-repair-send]').disabled`), 'failed send lost the description or cannot retry')
        assert(!batches().some(n => !seen.has(n)), 'failed send queued a request')
        await shot(page, `${name}-error`)
        await page.run('window.__repairFailure=false')
      }
      await page.run('window.__repairDelay=true')
      await page.run(`(()=>{const b=document.querySelector('[data-link-repair-send]');b.click();b.click()})()`)
      await wait(page, `typeof window.__releaseRepair==='function'`, 'delayed response never arrived')
      if (!opts.phone) {
        await page.key('Escape')
        await wait(page, `document.querySelector('[data-share-pop]')?.hidden===true`, 'Share did not close during a pending send')
        await click(page, '[data-share-btn]')
        await wait(page, `!!document.querySelector('[data-pop-here] [data-pop-more]')`, 'Share did not reopen')
        await click(page, '[data-pop-here] [data-pop-more]')
        await wait(page, `!!document.querySelector('[data-pop-actions]')`, 'link options did not reopen')
      } else {
        await click(page, '[data-link-tab=new]')
        await wait(page, `!document.querySelector('[data-link-row]')`, 'phone: changing tabs did not unmount Your links')
        await click(page, '[data-link-tab=mine]')
        await wait(page, `!!document.querySelector('[data-link-row]')`, 'phone: Your links did not reopen')
      }
      assert(await page.run(`document.querySelector('[data-link-repair-send]')?.disabled===true`), 'reopening Share loses the pending request and permits duplicate sends')
      await shot(page, `${name}-sending`)
      await page.run('window.__repairDelay=false;window.__releaseRepair()')
      await wait(page, `!!document.querySelector('[data-link-repair-sent]')`, 'request has no sent confirmation')
      await shot(page, `${name}-sent`)
      const { name: batchName, batch } = await take()
      assert(!batches().some(n => !seen.has(n)), 'double-click queued duplicate repairs')
      const c = batch.comments[0]
      assert(c.action === 'share-repair' && c.route === 'repair-link/B', `repair targets the wrong action or variant: ${c.action} ${c.route}`)
      assert(c.text.includes('https://repair123.prtype.dev/') && c.text.includes('repair123') && c.text.includes('Published version: 4'), 'request omitted the published link or version')
      assert(opts.phone ? c.text.includes('המסכים לא מתחלפים והטעינה איטית') : /investigate/i.test(c.text), 'description or self-diagnosis instruction missing')
      const printed = proto(['inbox'])
      assert(printed.includes('share-repair') && printed.includes('proto share update') && printed.includes('repair123'), 'CLI does not explain diagnosing and updating the original link')
      for (const sub of ['new', 'taken']) rmSync(join(app, '.proto/inbox', sub, batchName), { recursive: true, force: true })
      assert(!await page.run(`!!document.querySelector('[data-link-repair-send]')`), 'sent request can be accidentally sent twice')
      const bad = page.errors().filter(e => !/favicon|WebSocket|ERR_ABORTED|Connection interrupted/.test(e))
      assert(!bad.length, `${name}: page errors: ${bad.join(' | ')}`)
    } finally { page.close() }
  }
}
