// A sent comment can be changed until the agent takes it. The list offers the pencil on a comment
// marked Sent (Edit in the comment's menu), Save reaches the batch the agent will read, and Edit leaves the menu once it is taken. One
// taken while the composer is open keeps the words, and offers to send them as a new comment.
// shots: a folder for each state.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function editSentChecks({ proto, app, openPage, fail, shots }) {
  proto(['add', 'editfx', '--title', 'Edit sent', '--variants', 'A:Plain'])
  writeFileSync(join(app, 'src', 'protos', 'editfx', 'A.tsx'), `export default function Page() {
    return <main style={{ padding: 24 }}><button data-shoot="only" style={{ width: 140, height: 48 }}>Variant A</button></main>
  }
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  await server()
  for (const phone of [false, true]) await pass(phone)

  // The server's half: the agent reads the new words and pictures, and once it has the batch the
  // change is refused (409), never lost silently.
  async function server() {
    const post = (path, body) => fetch(`${local}__proto/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const send = async comments => (await (await post('comments', { comments })).json()).sent
    const status = async body => (await post('edit', body)).status
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='
    const one = await send([{ route: 'editfx/A', text: 'First words', images: [{ dataUrl: pixel, name: 'marked up' }] }, { route: 'editfx/A', text: 'The other one' }])
    if (await status({ batch: one, n: 1, text: 'Second words' }) !== 200) fail('edit sent: editing a waiting comment was refused')
    if (await status({ batch: '../x', n: 1, text: 'x' }) !== 400) fail('edit sent: an edit of a bad batch id was accepted')
    if (await status({ batch: one, n: 2, text: '  ' }) !== 400) fail('edit sent: an edit to nothing was accepted')
    const got = proto(['inbox'])
    if (!/Second words/.test(got) || /First words/.test(got) || !/The other one/.test(got)) fail(`edit sent: proto inbox did not print the edited comment: ${got}`)
    const image = (got.match(/image: (.+?)(?:  \(|$)/m) || [])[1]?.trim()
    if (!image || !existsSync(image)) fail(`edit sent: an edit with no pictures in it did not keep the comment's picture: ${image}`)
    if (await status({ batch: one, n: 1, text: 'Too late' }) !== 409) fail('edit sent: editing a taken comment was not refused')
    proto(['reply', one, 'Handled', '--done'])
    const two = await send([{ route: 'editfx/A', text: 'With a picture', images: [{ dataUrl: pixel, name: 'marked up' }] }])
    if (await status({ batch: two, n: 1, text: 'Without it', images: [] }) !== 200) fail('edit sent: taking the picture off a waiting comment was refused')
    const left = readdirSync(join(app, '.proto', 'inbox', 'new', two)).filter(f => f !== 'batch.json')
    if (left.length) fail(`edit sent: the picture taken off is still in the batch: ${left}`)
    const then = proto(['inbox'])
    if (!/Without it/.test(then) || /^\s*image: /m.test(then.split('Still open')[0])) fail(`edit sent: an edit that took a picture off still printed it: ${then}`)
    proto(['reply', two, 'Handled', '--done'])
    // A decision has already acted: it can't be edited.
    const pick = await send([{ route: 'editfx/A', text: 'More like this', action: 'more' }])
    if (await status({ batch: pick, n: 1, text: 'x' }) !== 409) fail('edit sent: a decision was editable')
    proto(['inbox']); proto(['reply', pick, 'Handled', '--done'])
  }
  proto(['archive', 'editfx'])
  console.log('\nOK: a sent comment can be changed until the agent takes it')

  async function pass(phone) {
  const name = phone ? 'phone' : 'desktop'
  const page = await openPage(`${local}editfx/A?theme=dark`, phone ? { width: 390, height: 844, phone: true } : {})
  const waiting = () => {
    const root = join(app, '.proto', 'inbox', 'new')
    return readdirSync(root).filter(f => !f.startsWith('.')).flatMap(id => JSON.parse(readFileSync(join(root, id, 'batch.json'), 'utf8')).comments).map(c => c.text)
  }
  const helpers = `
    const until = async f => { for (const end = Date.now() + 8000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return f(); return null }
    const q = s => document.querySelector(s)
    const say = words => {
      const box = q('[data-island] [data-shoot=whole-input]')
      box.focus(); box.textContent = words
      box.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const type = words => {
      const ed = q('[data-composer] [role=textbox]')
      ed.focus(); ed.textContent = words
      ed.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const shown = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).includes(el) }
    const openList = async () => {
      const on = () => shown(q('[data-comment]'))
      await new Promise(r => setTimeout(r, 700))
      const open = q('[data-island] [data-shoot=island-open]')
      if (open && open.getAttribute('aria-expanded') !== 'true') open.click()
      await until(on)
      await new Promise(r => setTimeout(r, 700))
    }
    // A comment's Edit and Delete are in its menu, behind the ellipsis at its corner.
    const popup = () => [...document.querySelectorAll('[data-comment-ui][role=menu]')].find(shown)
    const menu = async words => {
      const more = row(words)?.querySelector('[data-shoot=comment-more]')
      if (!shown(more)) return null
      if (!popup()) more.click()
      return await until(popup)
    }
    const closeMenu = async () => { if (popup()) document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await until(() => !popup()) }
    const pencil = async words => { const m = await menu(words); return m?.querySelector('[data-shoot=edit-sent]') || null }
    const sendOne = async words => {
      if (!await until(() => q('[data-island] [data-shoot=whole-input]'))) return 'the island has no comment box'
      say(words)
      if (!await until(() => q('[data-island] [data-shoot=whole-add]'))) return 'typing offered no way to add it'
      q('[data-island] [data-shoot=whole-add]').click()
      const send = await until(() => q('[data-island] [data-shoot=send]:not([disabled])'))
      if (!send) return 'adding it offered no Send'
      send.click()
      await openList()
      return ''
    }
    const row = words => [...document.querySelectorAll('[data-comment]')].find(r => r.textContent.includes(words))
  `
  const run = async (step, body) => {
    const why = await page.run(`(async () => { ${helpers} ${body} })()`, 30_000)
    if (why && shots) await page.screenshot(join(shots, `${name}-failed.png`))
    if (why) fail(`edit sent (${phone ? 'phone' : 'desktop'}), ${step}: ${why}`)
  }
  try {
    await run('sending', `
      for (const k of Object.keys(localStorage)) if (/^proto-comments-/.test(k)) localStorage.removeItem(k)
      const why = await sendOne('First words')
      if (why) return why
      if (!await pencil('First words')) return 'a comment marked Sent has no Edit in its menu: ' + (row('First words')?.textContent ?? 'no row')
      return ''
    `)
    if (shots) await page.screenshot(join(shots, `${name}-sent-row.png`))
    await run('opening', `
      const edit = await pencil('First words')
      edit.click()
      if (!await until(() => q('[data-composer] [role=textbox]'))) return 'the pencil opened no composer'
      if (!q('[data-composer] [role=textbox]').textContent.includes('First words')) return 'the composer did not hold the words'
      return ''
    `)
    if (shots) await page.screenshot(join(shots, `${name}-composer.png`))
    await run('saving', `
      type('Second words')
      q('[data-shoot=composer-add]').click()
      if (!await until(() => !q('[data-composer]'))) return 'Save did not close the composer: ' + (q('[data-composer] [role=alert]')?.textContent ?? '')
      await openList()
      if (!await until(() => row('Second words'))) return 'the list did not show the new words'
      return ''
    `)
    if (waiting().join() !== 'Second words') fail(`edit sent: the batch holds ${JSON.stringify(waiting())}, not the new words`)
    const got = proto(['inbox'])
    if (!/Second words/.test(got) || /First words/.test(got)) fail(`edit sent: proto inbox printed ${got}`)
    await run('after it is taken', `
      if (!await until(() => row('Second words')?.textContent.includes('is on it'))) return 'the comment never showed it was taken'
      const m = await menu('Second words')
      if (!m) return 'a taken comment has no menu'
      if (m.querySelector('[data-shoot=edit-sent]')) return 'a taken comment still offers Edit'
      if (!m.querySelector('[data-shoot=remove]')) return 'a taken comment offers no Delete'
      return ''
    `)
    if (shots) await page.screenshot(join(shots, `${name}-taken-row.png`))
    await run('closing the menu', `await closeMenu(); return popup() ? 'Escape did not close the menu' : ''`)

    await run('sending again', `
      const why = await sendOne('Raced words')
      if (why) return why
      await openList()
      const edit = await pencil('Raced words')
      if (!edit) return "no Edit in the second comment's menu"
      edit.click()
      if (!await until(() => q('[data-composer] [role=textbox]'))) return 'the pencil opened no composer'
      type('Words kept')
      return ''
    `)
    proto(['inbox'])
    await run('taken mid-edit', `
      if (!await until(() => q('[data-shoot=composer-late]'))) return 'the composer did not say the agent has it'
      if (q('[data-composer] [role=textbox]').textContent !== 'Words kept') return 'the words did not stay'
      return ''
    `)
    if (shots) await page.screenshot(join(shots, `${name}-late.png`))
    await run('sending as new', `
      q('[data-shoot=composer-add]').click()
      if (!await until(() => !q('[data-composer]'))) return 'Send as new comment did not close the composer'
      if (!await until(() => row('Words kept'))) return 'the new comment is not in the list'
      if (!row('Raced words')) return 'the comment the agent has lost its words'
      return ''
    `)
    if (!await new Promise(ok => { const end = Date.now() + 8000; const tick = () => waiting().includes('Words kept') ? ok(true) : Date.now() > end ? ok(false) : setTimeout(tick, 100); tick() })) fail(`edit sent: the words kept never reached the inbox: ${JSON.stringify(waiting())}`)
    proto(['inbox'])

    // A follow-up waiting for the agent has its own pencil; the card on a pin has an Edit.
    const batchOf = words => { const root = join(app, '.proto', 'inbox', 'taken'); return readdirSync(root).filter(id => !id.startsWith('.') && JSON.parse(readFileSync(join(root, id, 'batch.json'), 'utf8')).comments.some(c => c.text === words)).sort().at(-1) }
    proto(['reply', `${batchOf('Raced words')}/1`, 'A question back'])
    await run('following up', `
      await openList()
      const reply = await until(() => row('Raced words')?.querySelector('[data-shoot=comment-answer]'))
      if (!reply) return 'no Reply on the answered comment'
      reply.click()
      const box = await until(() => row('Raced words')?.querySelector('[data-shoot=comment-answer-box] [contenteditable]'))
      if (!box) return 'Reply opened no box'
      box.focus(); box.textContent = 'Follow one'
      box.dispatchEvent(new Event('input', { bubbles: true }))
      const go = await until(() => row('Raced words')?.querySelector('[data-shoot=comment-answer-send]:not([disabled])'))
      if (!go) return 'typing offered no Send'
      go.click()
      const turn = () => row('Raced words')?.querySelector('[data-shoot=comment-turn] [data-shoot=edit-sent]')
      if (!await until(() => shown(turn()))) return 'a follow-up waiting for the agent has no pencil in view'
      turn().click()
      if (!await until(() => q('[data-composer] [role=textbox]')?.textContent.includes('Follow one'))) return 'the follow-up pencil did not open its words'
      type('Follow two')
      q('[data-shoot=composer-add]').click()
      if (!await until(() => !q('[data-composer]'))) return 'Save did not close the composer on a follow-up: ' + (q('[data-composer] [role=alert]')?.textContent ?? '')
      return ''
    `)
    if (!waiting().includes('Follow two')) fail(`edit sent: the follow-up's new words never reached the batch: ${JSON.stringify(waiting())}`)
    proto(['inbox'])
    if (!phone) {
      await run('from a pin', `
        const why = await sendOne('Pin words')
        if (why) return why
        await openList()
        if (!await pencil('Pin words')) return "no Edit in the pin comment's menu"
        await closeMenu()
        row('Pin words').querySelector('button').click()
        const edit = await until(() => q('[data-comment-ui] [data-shoot=edit-sent]:not([data-comment] *)') || [...document.querySelectorAll('[data-shoot=edit-sent]')].find(b => !b.closest('[data-comment]')))
        if (!edit) return 'the card on the pin offers no Edit'
        edit.click()
        if (!await until(() => q('[data-composer] [role=textbox]')?.textContent.includes('Pin words'))) return 'Edit on the card opened no composer'
        q('[data-shoot=composer-close]')?.click()
        return ''
      `)
      proto(['inbox'])
    }
  } finally { page.close() }
  }
}
