// Drafts waiting to be sent always have a Send. On the right edge the comments island rests as a
// small tab, and its bar (with the Send pill) is only there once the panel opens: the panel opened
// after a load with drafts kept must still show "Send n", not a pill folded to no width.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function islandSendChecks({ proto, app, openPage, fail }) {
  proto(['add', 'sendfx', '--title', 'Island send', '--variants', 'A:Plain'])
  writeFileSync(join(app, 'src', 'protos', 'sendfx', 'A.tsx'), `export default function Page() {
    return <main style={{ padding: 24 }}><button data-shoot="only" style={{ width: 140, height: 48 }}>Variant A</button></main>
  }
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}sendfx/A?theme=light`)
  const helpers = `
    const until = async f => { for (const end = Date.now() + 5000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const q = s => document.querySelector('[data-island] ' + s)
    const saved = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.filter(i => i.proto === 'sendfx') ?? []
    const pill = () => q('[data-shoot=send]')
  `
  try {
    const added = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => q('[data-shoot=whole-input]'))) return 'the island has no comment box'
      const box = q('[data-shoot=whole-input]')
      box.textContent = 'Wait to be sent'
      box.dispatchEvent(new Event('input', { bubbles: true }))
      if (!await until(() => q('[data-shoot=whole-add]'))) return 'typing in the box offered no way to add it'
      q('[data-shoot=whole-add]').click()
      if (!await until(() => saved().length === 1)) return 'adding saved no draft'
      // The island on the right edge, folded to its tab, for the next load.
      const prefs = JSON.parse(localStorage.getItem('proto-island') || '{}')
      localStorage.setItem('proto-island', JSON.stringify({ ...prefs, place: 'right', along: 0.5 }))
      return ''
    })()`)
    if (added) fail(`island send: ${added}`)
    await page.run('location.reload(); true')
    for (const end = Date.now() + 30_000; Date.now() < end && !await page.run('document.documentElement.dataset.ready === "1"', 2000).catch(() => false);) await new Promise(r => setTimeout(r, 100))
    const opened = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => document.querySelector('[data-island][data-shape=tab]'))) return 'the island did not rest as a tab on the right edge'
      q('[data-shoot=island-open]').click()
      if (!await until(() => document.querySelector('[data-island][data-shape=panel]') && pill())) return 'opening the tab showed no panel with a send button'
      if (!await until(() => pill().parentElement.offsetWidth > 40)) return 'the panel opened with its Send pill ' + pill().parentElement.offsetWidth + ' px wide: the drafts cannot be sent'
      if (!/1/.test(pill().textContent)) return 'the Send pill does not count the draft: ' + pill().textContent
      return ''
    })()`)
    if (opened) fail(`island send: ${opened}`)
  } finally { page.close() }
  proto(['archive', 'sendfx'])
  console.log('\nOK: drafts waiting have a Send when the side panel opens from its tab')
}
