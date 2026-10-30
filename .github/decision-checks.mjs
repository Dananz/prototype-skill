// In a real browser: History beside a variant (a version kept by `proto ask`, a second one arriving
// while the page is open, and on a phone) and Decision brief.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function decisionChecks({ proto, app, local, openPage, fail, keepShots }) {
  const assert = (ok, why) => { if (!ok) fail(`decisions: ${why}`) }
  const design = (id, words, tone) => writeFileSync(join(app, `src/protos/decide/${id}.tsx`), `export default function ${id}() { return <main className="min-h-full ${tone} p-12 text-zinc-900"><h1 className="text-4xl font-semibold">${words}</h1><p className="mt-4 text-lg">Variant ${id}</p></main> }`)
  proto(['add', 'decide', '--title', 'Decide things', '--ask', 'A landing hero', '--variants', 'A:Calm,B:Loud'])
  design('A', 'Calm hero', 'bg-sky-50')
  design('B', 'First words of B', 'bg-amber-100')
  proto(['done', 'decide'])
  await new Promise(r => setTimeout(r, 800))
  proto(['ask', '--to', 'decide/B', 'make the heading bolder'])
  design('B', 'Second words of B', 'bg-emerald-100')
  assert(existsSync(join(app, 'src/history/decide/B/1/B.tsx')), 'proto ask kept no version')

  const until = `const until = async (f, ms = 15000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 60))) { const v = f(); if (v) return v } throw new Error('timed out: ' + document.body.innerText.slice(0, 600)) };`
  const page = await openPage(`${local}decide/B/~history`, { errors: true })
  const run = async code => {
    const result = await page.run(`(async () => { ${until} try { ${code}; return 'ok' } catch (e) { return e.message } })()`)
    assert(result === 'ok', result)
  }
  try {
    // The earlier version on the left, the variant now on the right, each its own design.
    await run(`await until(() => document.querySelector('[data-history]')); await until(() => document.querySelector('[data-version-pane="1"] [data-mount] h1')?.textContent === 'First words of B'); await until(() => document.querySelector('[data-version-pane="now"] [data-mount] h1')?.textContent === 'Second words of B'); if (!document.querySelector('[data-history]').textContent.includes('make the heading bolder')) throw new Error('the version does not say which ask it came before')`)
    await page.screenshot(join(keepShots, 'history-desktop.png'))
    // A second ask while the page is open: the new version joins the bar without a reload.
    await page.run('window.__stay = 1')
    proto(['ask', '--to', 'decide/B', 'now a green background'])
    design('B', 'Third words of B', 'bg-emerald-200')
    await run(`await until(() => document.querySelector('[data-version="2"]')); if (window.__stay !== 1) throw new Error('the page reloaded'); await until(() => document.querySelector('[data-version-pane="2"] [data-mount] h1')?.textContent === 'Second words of B')`)
    await run(`document.querySelector('[data-version="1"]').click(); await until(() => document.querySelector('[data-version-pane="1"] [data-mount] h1')?.textContent === 'First words of B')`)
    assert(proto(['history', 'decide/B']).includes('2 earlier versions'), 'proto history does not list both versions')

    // Decision brief from the Decide menu: made, kept for the agent, shown in place.
    await run(`document.querySelector('[data-act="tool:decide:B:history"]').click(); await until(() => !document.querySelector('[data-history]')); (await until(() => document.querySelector('[data-bar] [data-decide-btn]'))).click(); (await until(() => document.querySelector('[data-brief-open]'))).click(); await until(() => document.querySelector('[data-brief] pre')?.textContent.includes('# Decision brief: Decide things')); if (!document.querySelector('[data-brief]').textContent.includes('.proto/decisions/decide.md')) throw new Error('the brief does not say where it is kept')`)

    await page.screenshot(join(keepShots, 'brief-desktop.png'))
    assert(readFileSync(join(app, '.proto/decisions/decide.md'), 'utf8').includes('Nothing is picked yet'), 'brief file missing or wrong')
    const bad = page.errors().filter(e => !/favicon|ERR_ABORTED|WebSocket/.test(e))
    assert(!bad.length, `page errors: ${bad.join(' | ')}`)
  } finally { page.close() }

  // On a phone, History is in the pill's line even when the variant has no states.
  const phone = await openPage(`${local}decide/B`, { width: 390, height: 844, phone: true })
  try {
    const result = await phone.run(`(async () => { ${until} try { (await until(() => document.querySelector('[data-pill-state]'))).click(); (await until(() => [...document.querySelectorAll('button')].find(b => /History/.test(b.textContent) && !b.closest('[data-pill-state]') && b.offsetParent))).click(); await until(() => document.querySelector('[data-version-pane="2"] [data-mount] h1')?.textContent === 'Second words of B'); return 'ok' } catch (e) { return e.message } })()`)
    assert(result === 'ok', `phone History: ${result}`)
    await phone.screenshot(join(keepShots, 'history-phone.png'))
  } finally { phone.close() }

  // Comments sent from the page show in the brief with their answers.
  const ok = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route: 'decide/A', text: 'The calm one reads best' }] }) })
  const body = await ok.json()
  assert(ok.status === 200, `a comment was refused: ${JSON.stringify(body)}`)
  const { sent } = body
  proto(['inbox'])
  proto(['reply', sent, 'Keeping it calm', '--done'])
  assert(proto(['brief', 'decide']).includes('On #1 · Calm: “The calm one reads best” → “Keeping it calm”'), 'the brief leaves out a comment and its answer')
}
