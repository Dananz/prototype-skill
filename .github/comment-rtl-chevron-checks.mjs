// A done comment's chevron follows the page: closed, it points to where the line reads on to
// (right in English, left in Hebrew), and open it points down in both.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentRtlChevronChecks({ proto, app, openPage, fail }) {
  proto(['add', 'rtlchev', '--title', 'RTL chevron', '--variants', 'A:Plain'])
  writeFileSync(join(app, 'src', 'protos', 'rtlchev', 'A.tsx'), `export default function Page() {
    return <main style={{ padding: 24 }}><button data-shoot="only" style={{ width: 140, height: 48 }}>Variant A</button></main>
  }
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const helpers = `
    const until = async (f, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const v = f(); if (v) return v } return null }
    const row = () => document.querySelector('[data-shoot=comment-row]')
    // Where the chevron's tip sits from its middle, on screen, with every transform on it applied.
    const points = () => {
      const svg = row().querySelector('button[aria-expanded] > svg:last-child'), m = svg.querySelector('path').getScreenCTM()
      const dx = m.a * 3, dy = m.b * 3
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
    }
  `
  const page = await openPage(`${local}rtlchev/A?theme=dark`)
  try {
    const added = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => { const f = document.querySelector('[data-view] iframe'); return (f ? f.contentDocument : document)?.querySelector('[data-mount] [data-shoot=only]') }, 25000)) return 'the variant never mounted'
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', shiftKey: true, bubbles: true }))
      const box = await until(() => document.querySelector('[data-shoot=whole-input]'))
      if (!box) return 'no whole-variant box'
      box.textContent = 'Chevron direction'
      box.dispatchEvent(new Event('input', { bubbles: true }))
      ;(await until(() => document.querySelector('[data-shoot=whole-add]'))).click()
      ;(await until(() => document.querySelector('[data-shoot=send]'))).click()
      return 'ok'
    })()`)
    if (added !== 'ok') fail(`rtl chevron: ${added}`)
    let heard = ''
    for (let i = 0; i < 40 && !/proto reply (\S+)/.test(heard); i++) { heard += proto(['inbox'], { stdout: true }); await new Promise(r => setTimeout(r, 250)) }
    const batch = /proto reply (\S+)/.exec(heard)?.[1]
    if (!batch) fail(`rtl chevron: the comment never reached the inbox:\n${heard}`)
    proto(['reply', batch, 'Done', '--done'])

    for (const [lang, closed] of [['en', 'right'], ['he', 'left']]) {
      await page.run(`location.href = '${local}rtlchev/A?theme=dark&lang=${lang}'`)
      await new Promise(r => setTimeout(r, 500))
      const seen = await page.run(`(async () => {
        ${helpers}
        if (!await until(() => row()?.querySelector('button[aria-expanded] > svg:last-child'))) return 'no done row'
        const was = points()
        row().querySelector('button[aria-expanded]').click()
        if (!await until(() => row().querySelector('button[aria-expanded=true]'))) return 'the row did not open'
        const open = points()
        row().querySelector('button[aria-expanded]').click()
        return was + ',' + open
      })()`)
      if (seen !== `${closed},down`) fail(`rtl chevron: in ${lang} it should point ${closed}, then down when open; it points ${seen}`)
    }
  } finally { page.close() }

  // The note a phone's Build opens: its Back chevron points the way back along the line, so right in Hebrew.
  for (const [lang, back] of [['en', 'left'], ['he', 'right']]) {
    const phone = await openPage(`${local}rtlchev/A?theme=dark&lang=${lang}`, { width: 390, height: 844, phone: true })
    try {
      const seen = await phone.run(`(async () => {
        ${helpers}
        ;(await until(() => document.querySelector('[data-pill-handle]'), 25000)).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        const he = '${lang}' === 'he'
        const build = await until(() => [...document.querySelectorAll('button')].find(b => b.textContent === (he ? 'בנה את זה' : 'Build it')))
        if (!build) return 'no Build button in the sheet'
        build.click()
        const svg = await until(() => document.querySelector('button[aria-label="' + (he ? 'חזור' : 'Back') + '"] svg'))
        if (!svg) return 'no Back chevron'
        return svg.querySelector('path').getScreenCTM().a > 0 ? 'left' : 'right'
      })()`)
      if (seen !== back) fail(`rtl chevron: the phone note's Back in ${lang} should point ${back}; it says ${seen}`)
    } finally { phone.close() }
  }
  proto(['archive', 'rtlchev'])
  console.log('\nOK: a done comment\'s chevron points along the line in both directions, and down when open')
}
