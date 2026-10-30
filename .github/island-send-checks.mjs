// Drafts waiting to be sent always have a Send. The pill beside the island's box is sized from a
// hidden copy of its label, and the bar holding both is not there while the island rests as a tab
// on the right edge: after a load with drafts kept, opening the side panel, or bringing the island
// home to the foot and opening its list, must still show "Send n", not a pill folded to no width.
// shots: a folder for each opened state.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function islandSendChecks({ proto, app, openPage, fail, shots }) {
  proto(['add', 'sendfx', '--title', 'Island send', '--variants', 'A:Plain'])
  writeFileSync(join(app, 'src', 'protos', 'sendfx', 'A.tsx'), `export default function Page() {
    return <main style={{ padding: 24 }}><button data-shoot="only" style={{ width: 140, height: 48 }}>Variant A</button></main>
  }
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}sendfx/A?theme=light`)
  const helpers = `
    const until = async f => { for (const end = Date.now() + 5000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const island = () => document.querySelector('[data-island]')
    const q = s => document.querySelector('[data-island] ' + s)
    const saved = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.filter(i => i.proto === 'sendfx') ?? []
    const pill = () => q('[data-shoot=send]')
    const sendShown = async () => {
      if (!await until(() => pill() && pill().parentElement.offsetWidth > 40)) return 'its Send pill is ' + (pill()?.parentElement.offsetWidth ?? 'not') + ' px wide: the drafts cannot be sent'
      if (!/1/.test(pill().textContent)) return 'the Send pill does not count the draft: ' + pill().textContent
      await new Promise(r => setTimeout(r, 600))
      return ''
    }
  `
  // The island on the right edge, folded to its tab, as a new load finds it.
  const reloadOnTab = async () => {
    await page.run(`(() => {
      const prefs = JSON.parse(localStorage.getItem('proto-island') || '{}')
      localStorage.setItem('proto-island', JSON.stringify({ ...prefs, place: 'right', along: 0.5 }))
      location.reload()
      return true
    })()`)
    for (const end = Date.now() + 30_000; Date.now() < end && !await page.run('document.documentElement.dataset.ready === "1"', 2000).catch(() => false);) await new Promise(r => setTimeout(r, 100))
  }
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
      return ''
    })()`)
    if (added) fail(`island send: ${added}`)

    await reloadOnTab()
    const panel = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => island()?.dataset.shape === 'tab')) return 'the island did not rest as a tab on the right edge'
      q('[data-shoot=island-open]').click()
      if (!await until(() => island()?.dataset.shape === 'panel')) return 'opening the tab showed no panel'
      const why = await sendShown()
      return why && 'the side panel opened from its tab, but ' + why
    })()`)
    if (panel) fail(`island send: ${panel}`)
    if (shots) await page.screenshot(join(shots, 'side-panel.png'))

    await reloadOnTab()
    const flat = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => island()?.dataset.shape === 'tab')) return 'the island did not rest as a tab on the right edge'
      // Double-clicked, the island goes home to the foot of the stage.
      island().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      if (!await until(() => island()?.dataset.edgeSide === 'flat')) return 'double-clicking the tab did not bring the island home'
      q('[data-shoot=island-open]').click()
      if (!await until(() => island()?.dataset.open !== undefined)) return 'the count did not open the list'
      const why = await sendShown()
      return why && 'the island came home from the tab and opened its list, but ' + why
    })()`)
    if (flat) fail(`island send: ${flat}`)
    if (shots) await page.screenshot(join(shots, 'flat-list.png'))
  } finally { page.close() }
  proto(['archive', 'sendfx'])
  console.log('\nOK: drafts waiting have a Send when the island opens after resting as a tab')
}
