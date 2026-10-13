// Browser + real inbox contract: the agent authors nothing optional until a UI request arrives.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function optionalExtras({ proto, app, local, openPage, postJson, fail, keepShots }) {
  const assert = (ok, why) => { if (!ok) fail(`optional extras: ${why}`) }
  const skill = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8')
  assert(skill.includes('First usable output: one complete, high-quality direction') && skill.includes('Do not author `useHints`') && skill.includes('`useCopy` alternatives on the initial pass') && skill.includes('5 for a screen or a flow') && skill.includes('exact Current/reference match'), 'prototype-first authoring contract missing')
  proto(['add', 'first', '--title', 'First usable prototype', '--variants', 'A:Your next project'])
  const file = join(app, 'src/protos/first/A.tsx')
  const initial = `import { useState } from 'react'
export default function A() {
  const [created, setCreated] = useState(false)
  return <main className="min-h-full bg-stone-50 p-8 sm:p-16 text-stone-900">
    <p className="text-sm font-medium text-teal-700">FIELDNOTES / PROJECTS</p>
    <h1 className="mt-12 text-4xl font-semibold tracking-tight">Make room for your next idea.</h1>
    <p className="mt-4 max-w-md text-lg text-stone-600">Keep the brief, the work and the conversations together.</p>
    <button data-shoot="create" onClick={() => setCreated(true)} className="mt-8 rounded-xl bg-teal-800 px-5 py-3 font-medium text-white">Create a project</button>
    {created && <p data-shoot="created" className="mt-4">Your project is ready.</p>}
  </main>
}`
  writeFileSync(file, initial)
  // __D: the design's document (the stage's own artboard is a frame of the page); __R: a box of an
  // element of it in the page's px, for a real press.
  const until = `window.__D = () => window.__protoDesign?.()?.ownerDocument ?? document; window.__R = el => { const r = el.getBoundingClientRect(), f = el.ownerDocument === document ? null : el.ownerDocument.defaultView.frameElement; if (!f) return r; const o = f.getBoundingClientRect(), s = o.width / (f.offsetWidth || 1); return { x: o.left + r.x * s, y: o.top + r.y * s, width: r.width * s, height: r.height * s } }; let step = 0; const until = async f => { const at = ++step; for (let end = Date.now() + 8000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const v = f(); if (v) return v } throw new Error('UI condition ' + at + ' timed out at ' + location.hash + ': ' + [...document.querySelectorAll('[data-shoot]')].map(e => e.dataset.shoot).join(',')) };`
  const page = await openPage(`${local}#/first/A`)
  const run = async body => {
    const result = await page.run(`(async () => { ${until} try { ${body}; return 'ok' } catch(e) { return e.message } })()`)
    if (result !== 'ok') await page.screenshot(join(keepShots, 'first-prototype-failure.png'))
    assert(result === 'ok', `${result}: ${body.slice(0, 500)}`)
  }
  const menu = `await until(() => document.querySelector('[data-request-extra]') || document.querySelector('[data-bar] [data-decide-btn]')?.getAttribute('aria-expanded') === 'false'); if (!document.querySelector('[data-request-extra]')) document.querySelector('[data-bar] [data-decide-btn]').click(); await until(() => document.querySelector('[data-request-extra]'))`
  const status = async () => (await (await fetch(`${local}__proto/status`)).json()).inbox
  const matching = async action => (await status()).batches.filter(b => b.comments.some(c => c.route === 'first/A' && c.action === action && !c.withdrawn && !c.done))
  try {
    await run(`await until(() => document.querySelector('[data-shoot=create]')); document.querySelector('[data-shoot=create]').click(); await until(() => document.querySelector('[data-shoot=created]')); ${menu}; if (document.querySelector('[data-bar] [data-act=copymode]')) throw new Error('copy content generated before request')`)
    assert((await matching('try-it')).length === 0 && (await matching('copy-options')).length === 0, 'opening initial UI queued generation')
    await page.screenshot(join(keepShots, 'first-prototype-initial.png'))
    await run(`document.querySelector('[data-request-extra="try-it"]').click(); await until(() => document.querySelector('textarea')); [...document.querySelectorAll('[data-decide] button')].find(b => b.textContent === 'Cancel').click(); await until(() => document.querySelector('[data-request-extra]'))`)
    assert((await matching('try-it')).length === 0, 'canceled draft queued generation')
    // A transport failure leaves the draft open and retryable without queuing work.
    await run(`document.querySelector('[data-request-extra="try-it"]').click(); await until(() => document.querySelector('textarea')); const originalFetch = window.fetch; window.fetch = async (...args) => { if (args[0] === '/__proto/comments') { window.fetch = originalFetch; throw new TypeError('Test connection failure') } return originalFetch(...args) }; [...document.querySelectorAll('[data-decide] button')].find(b => b.textContent === 'Send').click(); await until(() => document.querySelector('[data-decide] [role=alert]')?.textContent.includes('Test connection failure')); await until(() => ![...document.querySelectorAll('[data-decide] button')].find(b => b.textContent === 'Send').disabled)`)
    assert((await matching('try-it')).length === 0, 'failed send queued generation')
    // Both clicks in one task: the synchronous guard must stop a double send before React commits.
    await run(`const b = [...document.querySelectorAll('[data-decide] button')].find(b => b.textContent === 'Send'); b.click(); b.click(); await until(() => document.querySelector('[data-decide] [role=status]'))`)
    let requests = await matching('try-it')
    assert(requests.length === 1, 'repeated UI send created multiple requests')
    const first = requests[0].id
    const duplicates = await Promise.all([1, 2].map(() => postJson('comments', { comments: [{ route: 'first/A', text: 'Add Try it', action: 'try-it' }] }).then(r => r.json())))
    assert(duplicates.every(r => r.sent === first), 'retry/two-tab requests not deduplicated')
    proto(['add', 'first', '--variants', 'B:Another direction'])
    writeFileSync(join(app, 'src/protos/first/B.tsx'), `export default function B() { return <div data-shoot="other">Another direction</div> }`)
    // Navigation away and back + reopening keeps the pending request visible.
    await run(`await until(() => document.querySelector('[data-shoot=other]') && !document.querySelector('[data-shoot=create]')); location.hash = '#/first/A'; await until(() => document.querySelector('[data-shoot=create]') && !document.querySelector('[data-shoot=other]')); ${menu}; await until(() => document.querySelector('[data-request-extra="try-it"]')?.disabled)`)
    await page.screenshot(join(keepShots, 'first-prototype-requested.png'))
    await page.run(`location.reload(); true`)
    await run(`await until(() => document.documentElement?.dataset.ready === '1'); ${menu}; await until(() => document.querySelector('[data-request-extra="try-it"]')?.disabled)`)

    await run(`const row = [...document.querySelectorAll('[data-shoot=comment-row]')].find(r => r.textContent.includes('Needs explanation: A')); if (!row) throw new Error('requested extra absent from Comments'); row.querySelector('[data-shoot=remove]').click()`)
    await run(`await until(() => !document.querySelector('[data-request-extra="try-it"]')?.disabled); document.querySelector('[data-request-extra="try-it"]').click(); await until(() => document.querySelector('textarea')); [...document.querySelectorAll('[data-decide] button')].find(b => b.textContent === 'Send').click(); await until(() => document.querySelector('[data-decide] [role=status]'))`)
    requests = await matching('try-it')
    assert(requests.length === 1 && requests[0].id !== first, 'withdrawal did not allow a fresh request')
    const heard = proto(['inbox'])
    assert(heard.includes('action: try-it (add useHints for this variant only'), 'CLI did not deliver scoped generation instructions')
    // Stand in for the agent after it consumes the request. Existing source remains unchanged until here.
    assert(readFileSync(file, 'utf8') === initial, 'request mutated core prototype before agent handled it')
    const withHints = initial.replace("export default", "import { useHints } from '../../hints'\nexport default").replace('  return <main', "  useHints([{ kind: 'try', text: 'Create your first project', at: '[data-shoot=create]', done: created }])\n  return <main")
    writeFileSync(file, withHints)
    proto(['reply', `${requests[0].id}/1`, 'Try it is ready', '--done'])
    await run(`${menu}; await until(() => document.querySelector('[data-request-extra="try-it"]')?.textContent.includes('Ready')); document.querySelector('[data-request-extra="copy-options"]').click(); await until(() => document.querySelector('textarea')); [...document.querySelectorAll('[data-decide] button')].find(b => b.textContent === 'Send').click(); await until(() => document.querySelector('[data-decide] [role=status]'))`)
    const copies = await matching('copy-options')
    assert(copies.length === 1, 'copy request missing')
    assert(proto(['inbox']).includes('action: copy-options (add useCopy for this variant only'), 'copy request CLI instructions missing')
    const complete = withHints.replace("export default", "import { useCopy } from '../../copy'\nexport default").replace('  return <main', "  const copy = useCopy([{ id: 'headline', label: 'Headline', options: ['Make room for your next idea.', 'Bring your next idea to life.'] }])\n  return <main").replace('<h1 className=', '<h1 data-copy="headline" className=').replace('>Make room for your next idea.</h1>', '>{copy.headline}</h1>')
    writeFileSync(file, complete)
    proto(['reply', `${copies[0].id}/1`, 'Headline options are ready', '--done'])
    await run(`${menu}; await until(() => document.querySelector('[data-request-extra="copy-options"]')?.textContent.includes('Ready'))`)
    await page.screenshot(join(keepShots, 'first-prototype-ready.png'))
    await run(`document.querySelector('[data-bar] [data-decide-btn]').click(); (await until(() => document.querySelector('[data-hint="tab:try"]'))).click(); await until(() => document.querySelector('[data-try-body]')?.textContent.includes('Create your first project') || document.body.textContent.includes('Create your first project'))`)
    await page.screenshot(join(keepShots, 'first-prototype-try-it.png'))
    await run(`(await until(() => document.querySelector('[data-bar] [data-act=copymode]'))).click(); (await until(() => document.querySelector('[data-copy-mark=headline]'))).click(); (await until(() => document.querySelector('[data-copy-option="1"]'))).click(); await until(() => __D().querySelector('[data-mount] h1')?.textContent === 'Bring your next idea to life.')`)
    await page.screenshot(join(keepShots, 'first-prototype-copy-options.png'))
    // Comments use the existing visual picker, with no per-element names or named-element list.
    await run(`document.querySelector('[data-bar] [data-act=copymode]').click(); const h = __D().querySelector('[data-mount] h1'); h.dataset.shoot = 'special-headline-name'; h.setAttribute('aria-label', 'Accessible headline'); h.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true })); await until(() => document.querySelector('[data-composer]')); if (document.querySelector('[data-composer]').textContent.includes('special-headline-name') || document.querySelector('[data-composer]').textContent.includes('Accessible headline')) throw new Error('element name shown'); document.querySelector('[data-composer] [aria-label="Tag another element"]').click(); await until(() => document.querySelector('[data-composer]').classList.contains('opacity-60')); if (document.querySelector('[data-tag-menu]')) throw new Error('named-element menu remains')`)
    const point = await page.run(`(() => { ${until} const r = __R(__D().querySelector('[data-mount] main > p')); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
    await page.press(...point)
    await run(`await until(() => document.querySelector('[data-composer] [data-tag="0"]')?.textContent === '@1'); if (__D().querySelector('[data-mount] h1').getAttribute('aria-label') !== 'Accessible headline') throw new Error('native accessible name changed')`)
    await page.screenshot(join(keepShots, 'first-prototype-visual-comments.png'))
    await run(`[...document.querySelectorAll('[data-composer] button')].find(b => b.textContent === 'Add').click(); await until(() => [...document.querySelectorAll('[data-shoot=comment-row]')].some(r => r.textContent.includes('Comment 1')))`)
    // Old saved labels are not displayed, but their stable selector targets and tags still open.
    await run(`await until(() => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.some(i => i.target)); const saved = JSON.parse(localStorage.getItem('proto-comments-smoke')); const old = saved.items.find(i => i.target); old.target.label = 'Legacy special name'; old.tags[0].label = 'Legacy tagged name'; localStorage.setItem('proto-comments-smoke', JSON.stringify(saved))`)
    await page.run(`location.reload(); true`)
    await run(`await until(() => document.documentElement?.dataset.ready === '1'); const row = await until(() => [...document.querySelectorAll('[data-shoot=comment-row]')].find(r => r.textContent.includes('Comment 1'))); if (row.textContent.includes('Legacy')) throw new Error('saved names shown'); row.querySelector('button').click(); await until(() => document.querySelector('[data-composer]')); if (document.querySelector('[data-composer] [data-tag="0"]')?.textContent !== '@1') throw new Error('legacy tag lost'); [...document.querySelectorAll('[data-composer] button')].find(b => b.textContent === 'Cancel').click()`)
    // Completed/no-op request can be retried; a taken then withdrawn request never reappears in inbox.
    const retry = await (await postJson('comments', { comments: [{ route: 'first/A', text: 'Add Try it', action: 'try-it' }] })).json()
    assert(retry.sent !== requests[0].id, 'done request cannot be retried')
    proto(['inbox'])
    await postJson('withdraw', { batch: retry.sent, n: 1 })
    assert((await matching('try-it')).length === 0, 'taken canceled request still pending')
    // A request on highlighted words (it has an element) is its own: asked twice, both arrive, and neither is the variant's.
    const words = { selector: ':scope > main > h1:nth-child(2)', tag: 'h1', text: 'Make room for your next idea.', rect: { x: 0, y: 0, w: 100, h: 40 } }
    const askWords = async () => (await (await postJson('comments', { comments: [{ route: 'first/A', text: 'Generate copy options for “Make room”', action: 'copy-options', target: words }] })).json()).sent
    const [w1, w2] = [await askWords(), await askWords()]
    assert(w1 && w2 && w1 !== w2, 'a request on highlighted words was merged with another')
    const status = (await (await fetch(`${local}__proto/status`)).json().catch(() => null))?.inbox
    const mine = status?.batches?.filter(b => b.id === w1 || b.id === w2).flatMap(b => b.comments) ?? []
    assert(status && mine.length === 2 && mine.every(c => c.scoped), 'the status did not mark requests on highlighted words as scoped')
    for (const w of [w1, w2]) await postJson('withdraw', { batch: w, n: 1 })
    for (const route of ['first', 'first/Z', 'first/A/state']) assert((await postJson('comments', { comments: [{ route, text: 'Try it', action: 'try-it' }] })).status === 400, `accepted invalid route ${route}`)
  } finally { page.close() }
  const phone = await openPage(`${local}#/first/B`, { width: 390, height: 844, phone: true })
  try {
    const result = await phone.run(`(async () => { ${until} try {
      (await until(() => document.querySelector('[data-pill-handle]'))).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const b = await until(() => document.querySelector('[data-request-extra="copy-options"]'));
      b.click(); await until(() => document.querySelector('textarea'));
      return 'ok'
    } catch(e) { return e.message } })()`)
    assert(result === 'ok', `phone: ${result}`)
    await phone.screenshot(join(keepShots, 'first-prototype-phone-request.png'))
  } finally { phone.close() }
  console.log('OK: prototype-first / optional extras, cancellation, deduplication, hot reload and phone UI and visual comments')
}
