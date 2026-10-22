// Real browser decisions and durable inbox lifecycle, including recovery after a dead taker.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function pickNoteChecks({ proto, app, local, openPage, fail, keepShots, before = false }) {
  const assert = (ok, why) => { if (!ok) fail(`pick notes: ${why}`) }
  proto(['add', 'picknotes', '--title', 'Pick a direction', '--variants', 'A:Quiet focus,B:Clear hierarchy'])
  for (const v of ['A', 'B']) writeFileSync(join(app, `src/protos/picknotes/${v}.tsx`), `export default function ${v}() { return <main className="min-h-full bg-stone-50 p-8 sm:p-16 text-stone-900"><p className="text-sm font-medium text-teal-700">FIELDNOTES / PROJECTS</p><h1 className="mt-12 text-4xl font-semibold tracking-tight">Make room for your next idea.</h1><p className="mt-4 max-w-md text-lg text-stone-600">Keep the brief, the work and the conversations together.</p><button className="mt-8 rounded-xl bg-teal-800 px-5 py-3 font-medium text-white">Create a project</button></main> }`)
  const until = `const until = async f => { for (const end = Date.now() + 10000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const v = f(); if (v) return v } throw new Error('pick note UI timed out: ' + document.body.innerText.slice(-1200)) };`
  const batches = async () => (await (await fetch(`${local}__proto/status`)).json()).inbox.batches
  const inboxFile = (id, sub = 'taken') => join(app, '.proto/inbox', sub, id, 'batch.json')
  for (const phone of [false, true]) {
    const layout = phone ? 'phone' : 'desktop', variant = phone ? 'A' : 'B'
    // The page names a variant by its number (A is 1, B is 2).
    const label = phone ? '1' : '2'
    const page = await openPage(`${local}#/picknotes/${variant}`, phone ? { width: 390, height: 844, phone: true } : {})
    const run = async code => {
      const result = await page.run(`(async () => { ${until} try { ${code}; return 'ok' } catch (e) { return e.message } })()`)
      assert(result === 'ok', result)
    }
    const menu = phone ? `(await until(() => document.querySelector('[data-pill-handle]'))).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))` : `(await until(() => document.querySelector('[data-bar] [data-decide-btn]'))).click()`
    try {
      await run(`await until(() => document.querySelector('[data-bar]')); ${menu}; await until(() => document.querySelector('[data-request-extra]')); await new Promise(r => setTimeout(r, 600))`)
      await page.screenshot(join(keepShots, `${layout}-${before ? 'before' : 'after'}-menu.png`))
      if (before) continue
      await run(`document.querySelector('[data-pick-note]').click(); await until(() => document.querySelector('textarea[aria-label^="Note for "]')); if (!document.querySelector('textarea[aria-label^="Note for "]').placeholder.includes('why this one')) throw new Error('wrong hint')`)
      const note = phone ? 'Keep the calm layout; make the heading smaller.' : 'Keep this hierarchy; make the heading smaller.'
      await run(`const t = document.querySelector('textarea[aria-label^="Note for "]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(note)}); t.dispatchEvent(new Event('input', { bubbles: true })); await until(() => document.querySelector('textarea[aria-label^="Note for "]').value === ${JSON.stringify(note)})`)
      await page.screenshot(join(keepShots, `${layout}-after-note.png`))
      // A failed request keeps the note and can be retried; two same-task clicks enqueue once.
      await run(`const original = window.fetch; window.fetch = async (...args) => { if (args[0] === '/__proto/comments') { window.fetch = original; throw new TypeError('Test connection failure') } return original(...args) }; [...document.querySelectorAll('button')].find(b => b.textContent === 'Pick ${label}').click(); await until(() => document.querySelector('[role=alert]')?.textContent.includes('Test connection failure')); await until(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Pick ${label}').disabled); if (document.querySelector('textarea[aria-label^="Note for "]').value !== ${JSON.stringify(note)}) throw new Error('failed send lost note')`)
      const earlier = new Set((await batches()).map(b => b.id))
      await run(`const b = [...document.querySelectorAll('button')].find(b => b.textContent === 'Pick ${label}'); b.click(); b.click(); await until(() => !document.querySelector('textarea[aria-label^="Note for "]')); await until(() => !document.querySelector('[data-pick-note]'))`)
      let sent
      for (let end = Date.now() + 10000; Date.now() < end && !sent; await new Promise(r => setTimeout(r, 100))) sent = (await batches()).find(b => !earlier.has(b.id) && b.comments.some(c => c.route === `picknotes/${variant}` && c.action === 'pick'))
      assert(sent && (await batches()).filter(b => !earlier.has(b.id)).length === 1, `${layout} send was missing or duplicated`)
      const pending = JSON.parse(readFileSync(inboxFile(sent.id, 'new'), 'utf8'))
      assert(!pending.done && !pending.comments[0].done, 'note was completed before the agent handled it')
      assert(pending.comments[0].text === `Picked ${label}: ${note}` && pending.comments[0].note === note && pending.comments[0].marked, 'persisted pick lost note or selection marker')
      assert(readFileSync(join(app, 'src/protos/picknotes/meta.ts'), 'utf8').includes(`"picked": "${variant}"`), 'selection was not marked')
      const session = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8'))
      assert(session.work?.proto === 'picknotes' && session.work.variant === variant && session.asks?.[`picknotes/${variant}`]?.at(-1)?.text === `Picked ${variant}`, 'working variant or history missing')
      const heard = proto(['inbox'])
      assert(heard.includes(note) && heard.includes('handle the note, then reply --done'), 'inbox tells agent the note is already done')
      // Stand in for an agent process that took the request then ended before replying.
      const taken = JSON.parse(readFileSync(inboxFile(sent.id), 'utf8'))
      taken.takenBy = { pid: 2147483647, at: new Date().toISOString() }
      writeFileSync(inboxFile(sent.id), JSON.stringify(taken))
      const recovered = proto(['inbox'])
      assert(recovered.includes(note) && recovered.includes('session that ended before it answered'), 'interrupted noted pick was not recovered')
      proto(['reply', `${sent.id}/1`, 'Handled the note', '--done'])
      assert(JSON.parse(readFileSync(inboxFile(sent.id), 'utf8')).comments[0].done, 'reply did not complete note')
      if (!phone) await run(`${menu}; await until(() => document.querySelector('[role=menu]')); if (document.querySelector('[data-pick-note]')) throw new Error('picked variant offers note again')`)
      else await run(`if (document.querySelector('[data-pick-note]')) throw new Error('picked sheet offers note again'); if ([...document.querySelectorAll('button')].some(b => b.textContent === 'Pick ${label}')) throw new Error('phone composer did not reset')`)
    } finally { page.close() }
    if (!phone && !before) proto(['pick', 'picknotes', '--off'])
  }
  if (!before) {
    const response = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route: 'picknotes/B', text: 'Picked B', action: 'pick' }] }) })
    const result = await response.json()
    const plain = JSON.parse(readFileSync(inboxFile(result.sent, 'new'), 'utf8'))
    assert(plain.done && plain.comments[0].done, 'plain pick no longer completes immediately')
    proto(['inbox']) // Consume the completed plain-pick batch before later queue-count checks.
    proto(['pick', 'picknotes', '--off'])
    proto(['archive', 'picknotes'])
  }
  console.log(`\nOK: ${before ? 'before screenshots' : 'desktop and phone pick notes persist, retry once, recover and finish'}`)
}
