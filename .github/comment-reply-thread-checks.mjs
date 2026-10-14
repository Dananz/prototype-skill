// Answering Claude back: a comment sent from the page and answered with `proto reply` offers Reply
// under the answer; what the user writes there goes as a follow-up on the same element, which
// `proto inbox` prints with the exchange before it, and the list shows as one thread under the
// comment (one row, one pin). `proto reply` to the follow-up lands in that thread.
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

export async function commentReplyThreadChecks({ proto, app, openPage, fail, local }) {
  proto(['add', 'threadfx', '--title', 'Threads', '--variants', 'A:Plain'])
  writeFileSync(join(app, 'src', 'protos', 'threadfx', 'A.tsx'), `export default function Page() {
    return <main style={{ padding: 24 }}><button data-shoot="only" style={{ width: 140, height: 48 }}>Thread me</button></main>
  }
`)
  const page = await openPage(`${local}?theme=light#/threadfx/A`)
  const helpers = `
    const until = async (f, ms = 10000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const v = f(); if (v) return v } return null }
    const saved = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.filter(i => i.proto === 'threadfx') ?? []
    const rows = () => [...document.querySelectorAll('[data-shoot=comment-row]')].filter(r => saved().some(i => i.id === r.dataset.comment))
    const type = (el, text) => { const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })) }
  `
  // The inbox, read until it prints what is expected (the page's send can still be on its way).
  const heard = async re => { let out = ''; for (let i = 0; i < 40 && !re.test(out); i++) { out += proto(['inbox'], { stdout: true }); if (!re.test(out)) await new Promise(r => setTimeout(r, 250)) } return out }
  try {
    // A comment on the whole variant, written and sent from the page.
    const sent = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => document.querySelector('[data-mount]'))) return 'the variant never mounted'
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', shiftKey: true, bubbles: true }))
      const box = await until(() => document.querySelector('[data-shoot=whole-input]'))
      if (!box) return 'no whole-variant box'
      type(box, 'Give the whole page more air')
      ;(await until(() => document.querySelector('[data-shoot=whole-add]')))?.click()
      if (!await until(() => saved().length === 1)) return 'adding saved no comment'
      document.querySelector('[data-shoot=send]').click()
      return await until(() => saved().every(i => i.sent)) ? 'sent ' + saved()[0].sent.batch : 'the comment never went'
    })()`)
    if (!/^sent \S+$/.test(sent)) fail(`reply thread: ${sent}`)
    const id = sent.slice(5)
    const first = await heard(/Give the whole page more air/)
    if (!first.includes(`batch ${id} `)) fail(`reply thread: the comment never reached the inbox:\n${first}`)
    proto(['reply', `${id}/1`, 'Opened up the padding everywhere', '--done', '--as', 'claude'])

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
      const pins = document.querySelectorAll('button[aria-label^="Comment 1"]').length
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
  } finally { page.close() }
  proto(['archive', 'threadfx'])
  console.log('\nOK: a reply can be answered from the page, reaches the inbox with its thread, and the answer to it lands in the thread')
}
