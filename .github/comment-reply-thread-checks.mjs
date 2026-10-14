// Answering Claude back: a comment sent from the page and answered with `proto reply` offers Reply
// under the answer; what the user writes there goes as a follow-up on the same element, which
// `proto inbox` prints with the exchange before it, and the list shows as one thread under the
// comment (one row, one pin). `proto reply` to the follow-up lands in that thread.
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

export async function commentReplyThreadChecks({ proto, app, openPage, fail, local, evidence = '', layout = 'desktop', phase = 'after' }) {
  proto(['add', 'threadfx', '--title', 'Threads', '--variants', 'A:Plain'])
  writeFileSync(join(app, 'src', 'protos', 'threadfx', 'A.tsx'), `export default function Page() {
    return <main style={{ padding: 24 }}><button data-shoot="only" style={{ width: 140, height: 48 }}>Thread me</button></main>
  }
`)
  const page = await openPage(`${local}?theme=light#/threadfx/A`)
  const helpers = `
    const until = async (f, ms = 10000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const v = f(); if (v) return v } return null }
    const saved = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.filter(i => i.proto === 'threadfx') ?? []
    const panel = () => innerWidth < 640 ? document.querySelector('[role=dialog]') : document
    const rows = () => [...(panel()?.querySelectorAll('[data-shoot=comment-row]') ?? [])].filter(r => r.getClientRects().length && saved().some(i => i.id === r.dataset.comment))
    const type = (el, text) => { const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })) }
  `
  // The inbox, read until it prints what is expected (the page's send can still be on its way).
  const heard = async re => { let out = ''; for (let i = 0; i < 40 && !re.test(out); i++) { out += proto(['inbox'], { stdout: true }); if (!re.test(out)) await new Promise(r => setTimeout(r, 250)) } return out }
  const regressions = []
  const capture = async name => {
    if (!evidence) return
    await page.run('new Promise(r => setTimeout(r, 500))')
    await page.screenshot(join(evidence, `${phase}-${layout}-${name}.png`))
  }
  try {
    // A comment on the whole variant, written and sent from the page.
    const sent = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => document.querySelector('[data-mount]'))) return 'the variant never mounted'
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', shiftKey: true, bubbles: true }))
      const box = await until(() => panel()?.querySelector('[data-shoot=whole-input]'))
      if (!box) return 'no whole-variant box'
      type(box, 'Give the whole page more air')
      ;(await until(() => panel()?.querySelector('[data-shoot=whole-add]')))?.click()
      if (!await until(() => saved().length === 1)) return 'adding saved no comment'
      panel().querySelector('[data-shoot=send]').click()
      return await until(() => saved().every(i => i.sent)) ? 'sent ' + saved()[0].sent.batch : 'the comment never went'
    })()`)
    if (!/^sent \S+$/.test(sent)) fail(`reply thread: ${sent}`)
    const id = sent.slice(5)
    const first = await heard(/Give the whole page more air/)
    if (!first.includes(`batch ${id} `)) fail(`reply thread: the comment never reached the inbox:\n${first}`)
    proto(['reply', `${id}/1`, 'Opening up the padding', '--as', 'claude'])
    const typing = await page.run(`(async () => {
      ${helpers}
      const reply = await until(() => rows()[0]?.querySelector('[data-shoot=comment-answer]'))
      if (!reply) return 'interim reply offers no Reply'
      reply.click()
      const box = await until(() => rows()[0]?.querySelector('textarea'))
      type(box, 'Keep this reply while finishing')
      return await until(() => box.value === 'Keep this reply while finishing') ? 'ok' : 'typing failed'
    })()`)
    if (typing !== 'ok') fail(`reply thread: ${typing}`)
    await capture('interim-draft')
    proto(['reply', `${id}/1`, 'Opened up the padding everywhere', '--done', '--as', 'claude'])
    const retained = await page.run(`(async () => {
      ${helpers}
      const row = await until(() => rows()[0]?.closest('section')?.getAttribute('aria-label') === 'Done' && rows()[0])
      if (!row) return 'thread never finished'
      if (row.querySelector('button[aria-expanded]').getAttribute('aria-expanded') !== 'true') row.querySelector('button[aria-expanded]').click()
      return await until(() => row.querySelector('textarea')?.value === 'Keep this reply while finishing', 1000) ? 'ok' : 'finishing lost the open reply draft'
    })()`)
    await capture('done-draft')
    if (retained !== 'ok') regressions.push(retained)
    const collapsed = await page.run(`(async () => {
      ${helpers}
      const row = rows()[0]
      if (!row.querySelector('textarea')) row.querySelector('[data-shoot=comment-answer]').click()
      const box = await until(() => row.querySelector('textarea'))
      type(box, 'Keep this reply while folded')
      const original = window.fetch
      window.fetch = async (...args) => { if (args[0] !== '/__proto/comments') return original(...args); window.fetch = original; throw new TypeError('Reply connection failure') }
      ;(await until(() => !row.querySelector('[data-shoot=comment-answer-send]').disabled && row.querySelector('[data-shoot=comment-answer-send]'))).click()
      if (!await until(() => row.querySelector('[role=alert]')?.textContent.includes('Reply connection failure'))) return 'failed reply offered no error'
      row.querySelector('button[aria-expanded]').click()
      await until(() => !row.querySelector('textarea'))
      row.querySelector('button[aria-expanded]').click()
      return await until(() => row.querySelector('textarea')?.value === 'Keep this reply while folded', 1000) ? (row.querySelector('[role=alert]')?.textContent.includes('Reply connection failure') ? 'ok' : 'collapse lost the reply error') : 'collapse lost the open reply draft'
    })()`)
    await capture('reopened-draft')
    if (collapsed !== 'ok') regressions.push(collapsed)
    // Reset only through the real explicit Cancel action before the original exchange checks.
    const cancelled = await page.run(`(async () => {
      ${helpers}
      const row = rows()[0]
      if (row.querySelector('textarea')) [...row.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click()
      ;(await until(() => row.querySelector('[data-shoot=comment-answer]'))).click()
      const box = await until(() => row.querySelector('textarea'))
      let result = box.value || row.querySelector('[role=alert]') ? 'Cancel did not clear the reply text and error' : 'ok'
      type(box, 'Explicitly discard this reply')
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      ;(await until(() => row.querySelector('[data-shoot=comment-answer]'))).click()
      if ((await until(() => row.querySelector('textarea'))).value) result = 'Escape did not clear the reply text'
      ;[...row.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click()
      row.querySelector('button[aria-expanded]').click()
      return result
    })()`)
    if (cancelled !== 'ok') regressions.push(cancelled)

    // Reply under the answer, in the Done row once it opens; the follow-up joins the thread.
    const answered = await page.run(`(async () => {
      ${helpers}
      const row = await until(() => rows()[0]?.querySelector('button[aria-expanded]') && rows()[0])
      if (!row) return 'the answered comment never showed as done'
      row.querySelector('button[aria-expanded]').click()
      if (!await until(() => row.textContent.includes('Opened up the padding everywhere'))) return 'the done row does not show the reply'
      const reply = await until(() => row.querySelector('[data-shoot=comment-answer]'))
      if (!reply) return 'no Reply under the answer'
      reply.click()
      const box = await until(() => row.querySelector('[data-shoot=comment-answer-box] textarea'))
      if (!box) return 'Reply opened no box'
      type(box, 'Better, but the button still feels cramped')
      ;(await until(() => !row.querySelector('[data-shoot=comment-answer-send]').disabled && row.querySelector('[data-shoot=comment-answer-send]')))?.click()
      const follow = await until(() => saved().find(i => i.re && i.sent))
      if (!follow) return 'the answer was not sent as a follow-up'
      const root = saved().find(i => !i.re)
      if (follow.re.id !== root.id || follow.re.batch !== root.sent.batch || follow.re.i !== 1) return 'the follow-up does not name the comment it answers: ' + JSON.stringify(follow.re)
      if (follow.target?.selector !== root.target?.selector || follow.n !== root.n) return 'the follow-up is not on what the comment is on'
      return 'sent ' + follow.sent.batch
    })()`)
    if (!/^sent \S+$/.test(answered)) fail(`reply thread: ${answered}`)
    const id2 = answered.slice(5)

    // (a) The follow-up reaches the inbox with the exchange before it.
    const second = await heard(/Better, but the button still feels cramped/)
    if (!second.includes(`batch ${id2} `)) fail(`reply thread: the follow-up's batch ${id2} never reached the inbox:\n${second}`)
    if (!second.includes(`1. threadfx/A  (reply to ${id}/1)`)) fail(`reply thread: the inbox does not say which comment the follow-up answers:\n${second}`)
    if (!second.includes('   earlier: "Give the whole page more air"  ->  Claude: "Opened up the padding everywhere"')) fail(`reply thread: the inbox does not print the exchange before the follow-up:\n${second}`)
    if (!/on: the whole variant/.test(second)) fail(`reply thread: the follow-up lost what the comment is on:\n${second}`)

    // (b) The list shows one thread: one row, one pin, the follow-up nested under the comment, with Claude.
    const nested = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => rows().length === 1 && rows()[0].querySelector('[data-shoot=comment-turn]'))) return 'the follow-up is not nested under its comment: ' + rows().length + ' rows'
      const row = rows()[0]
      if (!row.querySelector('[data-shoot=comment-turn]').textContent.includes('Better, but the button still feels cramped')) return 'the nested turn lacks the follow-up'
      if (!row.closest('section')?.getAttribute('aria-label')?.startsWith('With')) return 'a thread with an open follow-up should be with the agent, it is in ' + row.closest('section')?.getAttribute('aria-label')
      if (!row.textContent.includes('Opened up the padding everywhere')) return 'the thread lost the first reply'
      const pins = [...document.querySelectorAll('button[aria-label^="Comment 1"]')].filter(p => p.getClientRects().length).length
      if (pins !== 1) return 'the thread should have one pin, it has ' + pins
      return 'ok'
    })()`)
    if (nested !== 'ok') fail(`reply thread: ${nested}`)

    // (c) proto reply to the follow-up lands in the thread, which is done again and can be answered again.
    proto(['reply', `${id2}/1`, 'Gave the button 8 px more each side', '--done', '--as', 'claude'])
    const closed = await page.run(`(async () => {
      ${helpers}
      const row = await until(() => rows()[0]?.closest('section')?.getAttribute('aria-label') === 'Done' && rows()[0])
      if (!row) return 'the thread did not move to Done after the follow-up was answered'
      if (!row.querySelector('[data-shoot=comment-turn]')) row.querySelector('button[aria-expanded]').click()
      const turn = await until(() => row.querySelector('[data-shoot=comment-turn]'))
      if (!turn || !await until(() => turn.textContent.includes('Gave the button 8 px more each side'))) return 'the reply to the follow-up is not in the thread'
      if (!row.querySelector('[data-shoot=comment-answer]')) return 'the thread offers no Reply after the last answer'
      return 'ok'
    })()`)
    if (closed !== 'ok') fail(`reply thread: ${closed}`)

    // A second answer answers the last reply, and the inbox walks the whole exchange back, oldest first.
    const again = await page.run(`(async () => {
      ${helpers}
      const row = rows()[0]
      row.querySelector('[data-shoot=comment-answer]').click()
      const box = await until(() => row.querySelector('[data-shoot=comment-answer-box] textarea'))
      if (!box) return 'Reply opened no box the second time'
      if (box.value || row.querySelector('[role=alert]')) return 'successful send did not clear the reply draft'
      type(box, 'Good. Same for the footer?')
      ;(await until(() => !row.querySelector('[data-shoot=comment-answer-send]').disabled && row.querySelector('[data-shoot=comment-answer-send]')))?.click()
      const follow = await until(() => saved().filter(i => i.re && i.sent).length === 2 && saved().filter(i => i.re).sort((a, b) => a.at - b.at)[1])
      if (!follow) return 'the second answer was not sent'
      if (follow.re.batch !== ${JSON.stringify(id2)} || follow.re.i !== 1) return 'the second answer should answer the last reply, not ' + JSON.stringify(follow.re)
      if (!await until(() => rows().length === 1 && rows()[0].querySelectorAll('[data-shoot=comment-turn]').length === 2)) return 'the thread should show two follow-ups in one row'
      return 'sent ' + follow.sent.batch
    })()`)
    if (!/^sent \S+$/.test(again)) fail(`reply thread: ${again}`)
    const third = await heard(/Same for the footer\?/)
    const walked = [`1. threadfx/A  (reply to ${id2}/1)`, '   earlier: "Give the whole page more air"  ->  Claude: "Opened up the padding everywhere"',
      '   earlier: "Better, but the button still feels cramped"  ->  Claude: "Gave the button 8 px more each side"', '   Good. Same for the footer?'].join('\n')
    if (!third.includes(walked)) fail(`reply thread: the inbox should print the whole exchange before the second answer, oldest first:\n${third}`)
    proto(['reply', `${again.slice(5)}/1`, 'Footer too', '--done', '--as', 'claude'])
    const deleted = await page.run(`(async () => {
      ${helpers}
      try {
        const row = await until(() => rows()[0]?.closest('section')?.getAttribute('aria-label') === 'Done' && rows()[0])
        if (!row.querySelector('[data-shoot=comment-answer]')) row.querySelector('button[aria-expanded]').click()
        ;(await until(() => row.querySelector('[data-shoot=comment-answer]'))).click()
        type(await until(() => row.querySelector('textarea')), 'Delete this pending reply')
        // Post to the real server, hold its response until the user deletes the thread.
        const original = window.fetch
        window.fetch = async (...args) => {
          if (args[0] !== '/__proto/comments' || window.replyBatch) {
            const response = await original(...args)
            if (args[0] === '/__proto/withdraw') window.replyWithdrawn = response.ok
            return response
          }
          const response = await original(...args)
          window.replyBatch = (await response.clone().json()).sent
          await new Promise(resolve => { window.releaseReply = resolve })
          return response
        }
        ;(await until(() => !row.querySelector('[data-shoot=comment-answer-send]').disabled && row.querySelector('[data-shoot=comment-answer-send]'))).click()
        if (!await until(() => window.releaseReply)) return 'send never reached server'
        row.querySelector('button[aria-expanded]').click()
        await until(() => !row.querySelector('textarea'))
        row.querySelector('button[aria-expanded]').click()
        const reopened = await until(() => row.querySelector('textarea') || row.querySelector('[data-shoot=comment-answer]'))
        if (reopened.tagName === 'BUTTON') reopened.click()
        const sending = await until(() => row.querySelector('[data-shoot=comment-answer-send]'))
        const keptLock = sending.disabled && sending.textContent.includes('Sending')
        // A keyboard send after reopening must not enqueue the same reply again.
        row.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
        row.querySelector('[data-shoot=remove]').click()
        if (!await until(() => saved().length === 0)) return 'deleting did not remove thread'
        window.releaseReply()
        if (!await until(() => saved().length || window.replyWithdrawn)) return 'send completion neither saved nor withdrew the reply'
        window.fetch = original
        if (saved().length || rows().length) return 'deleted thread resurrected after send'
        const status = await (await original('/__proto/status')).json()
        const batch = status.inbox.batches.find(b => b.id === window.replyBatch)
        if (batch && !batch.comments.every(c => c.withdrawn)) return 'deleted pending reply remains active on server'
        if (!keptLock) return 'collapse lost the pending send lock'
        return 'ok'
      } catch (e) { return 'delete check: ' + (e.stack || e.message || String(e)) }
    })()`)
    await capture('deleted-pending-reply')
    if (deleted !== 'ok') regressions.push(deleted)
    // The CLI must not deliver the deleted follow-up to an agent, either.
    if (proto(['inbox'], { stdout: true }).includes('Delete this pending reply')) regressions.push('inbox delivered the deleted pending reply')
    if (regressions.length) fail(`reply thread regressions: ${regressions.join('; ')}`)

  } finally { page.close() }
  proto(['archive', 'threadfx'])
  console.log('\nOK: a reply can be answered from the page, reaches the inbox with its thread, and the answer to it lands in the thread')
}
