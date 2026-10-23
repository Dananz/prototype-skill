// A comment takes several pictures: each paste adds one (up to six), all of them are sent, and
// proto inbox lists each.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentPicturesChecks({ proto, app, openPage, fail }) {
  proto(['add', 'picsfx', '--title', 'Pictures', '--variants', 'A:One button'])
  writeFileSync(join(app, 'src', 'protos', 'picsfx', 'A.tsx'), `export default function One() {
  return <main style={{ padding: 24 }}><button data-shoot="target" style={{ width: 160, height: 48 }}>Target</button></main>
}
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}picsfx/A?theme=light`)
  const helpers = `
    const until = async (f, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const editor = () => document.querySelector('[data-composer] [role=textbox]')
    const design = () => document.querySelector('[data-view] iframe')?.contentDocument ?? document
    const target = () => design().querySelector('[data-mount] [data-shoot=target]')
    // One per picture: a pasted image's chip, or a screenshot's thumbnail.
    const pictures = () => document.querySelectorAll('[data-composer] [data-shoot=comment-pictures] [data-shoot=image-chip], [data-composer] [data-shoot=comment-pictures] button[title="Edit the screenshot"]').length
    const camera = () => document.querySelector('[data-composer] button[aria-label="Attach a screenshot"]')
    // A pasted PNG, a different colour each time, the way Ctrl+V hands it over.
    const paste = async n => {
      const c = document.createElement('canvas'); c.width = 40; c.height = 30
      const g = c.getContext('2d'); g.fillStyle = 'hsl(' + n * 50 + ' 70% 50%)'; g.fillRect(0, 0, 40, 30)
      const blob = await new Promise(r => c.toBlob(r, 'image/png'))
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'p' + n + '.png', { type: 'image/png' }))
      editor().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }
  `
  const open = async () => {
    const at = await page.run(`(async () => {
      ${helpers}
      // The bar is redrawn when its state changes, so the button is looked up each time; a click
      // that lands before the page listens does nothing, so it is tried again.
      const t = () => document.querySelector('[data-act="comment:toggle"]')
      for (let i = 0; i < 4 && t().getAttribute('aria-pressed') !== 'true'; i++) { t().click(); await until(() => t().getAttribute('aria-pressed') === 'true', 1500) }
      if (!await until(() => t().getAttribute('aria-pressed') === 'true' && target())) return 'comment mode is ' + t().getAttribute('aria-pressed') + ', target ' + !!target()
      await new Promise(r => setTimeout(r, 200))
      const r = target().getBoundingClientRect(), frame = target().ownerDocument.defaultView.frameElement
      const f = frame?.getBoundingClientRect(), scale = frame ? f.width / frame.offsetWidth : 1
      return [(f?.left ?? 0) + (r.left + r.width / 2) * scale, (f?.top ?? 0) + (r.top + r.height / 2) * scale]
    })()`)
    if (!Array.isArray(at)) fail('pictures: comment mode or the target never became ready: ' + at)
    await page.press(...at)
  }
  try {
    await open()
    const two = await page.run(`(async () => {
      ${helpers}
      if (!await until(editor)) return 'picking the target opened no composer'
      editor().textContent = 'Two pictures'
      editor().dispatchEvent(new Event('input', { bubbles: true }))
      await paste(1)
      if (!await until(() => pictures() === 1)) return 'the first pasted image did not show: ' + pictures()
      await paste(2)
      if (!await until(() => pictures() === 2)) return 'a second pasted image should be added beside the first, not replace it: ' + pictures()
      document.querySelector('[data-composer] button[title^="Add,"]').click()
      if (!await until(() => !editor())) return 'Add did not save the comment'
      const s = document.querySelector('[data-shoot=send]'); if (!s || s.disabled) return 'Send was not ready'
      s.click()
      return 'ok'
    })()`)
    if (two !== 'ok') fail(`pictures: ${two}`)
    let heard = ''
    for (let i = 0; i < 40 && !/Two pictures/.test(heard); i++) { heard += proto(['inbox'], { stdout: true }); if (!/Two pictures/.test(heard)) await new Promise(r => setTimeout(r, 250)) }
    const lines = (heard.match(/^ {3}image: .*\(pasted by the user\)$/gm) || []).length
    if (lines !== 2) fail(`pictures: proto inbox should list both pictures of the comment, found ${lines}: ${heard}`)

    await open()
    const six = await page.run(`(async () => {
      ${helpers}
      if (!await until(editor)) return 'the second comment opened no composer'
      for (let n = 1; n <= 7; n++) { await paste(n); await until(() => pictures() === Math.min(n, 6), 2000) }
      await new Promise(r => setTimeout(r, 300))
      if (pictures() !== 6) return 'a comment should hold at most 6 pictures, it holds ' + pictures()
      if (!camera().disabled) return 'with 6 pictures the camera should be off'
      document.querySelector('[data-composer] [data-shoot=comment-pictures] button[aria-label="Remove the image"]').click()
      if (!await until(() => pictures() === 5 && !camera().disabled)) return 'removing one should make room again'
      ;[...document.querySelectorAll('[data-composer] button')].find(b => b.textContent === 'Cancel').click()
      return 'ok'
    })()`)
    if (six !== 'ok') fail(`pictures: ${six}`)

    // Removing the last picture from a saved draft must stay removed after Save and reload.
    await open()
    const removed = await page.run(`(async () => {
      ${helpers}
      if (!await until(editor)) return 'the removal comment opened no composer'
      editor().textContent = 'Remove every picture'
      editor().dispatchEvent(new Event('input', { bubbles: true }))
      await paste(1)
      if (!await until(() => pictures() === 1)) return 'the removal picture did not show'
      document.querySelector('[data-composer] button[title^="Add,"]').click()
      if (!await until(() => !editor())) return 'the removal draft was not saved'
      const saved = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.find(i => i.body.includes('Remove every picture'))
      if (!await until(() => saved()?.shots?.length === 1)) return 'the original picture was not persisted'
      const legacy = { ...saved(), id: 'legacy-picture', body: ['Legacy picture'], shot: saved().shots[0].src, pasted: true }; delete legacy.shots
      const row = () => [...document.querySelectorAll('[data-shoot=comment-row]')].find(r => r.textContent.includes('Remove every picture'))
      row().querySelector('button').click()
      if (!await until(() => editor() && pictures() === 1)) return 'the saved draft did not reopen with its picture'
      document.querySelector('[data-composer] button[aria-label="Remove the image"]').click()
      if (!await until(() => pictures() === 0)) return 'the last picture did not disappear in the composer'
      document.querySelector('[data-composer] button[title^="Add,"]').click()
      if (!await until(() => !editor() && saved() && !(saved().shots?.length || saved().shot))) return 'Save restored the removed picture in the saved draft'
      row().querySelector('button').click()
      if (!await until(editor)) return 'the empty-picture draft did not reopen'
      if (pictures() !== 0) return 'the removed picture came back on reopen'
      ;[...document.querySelectorAll('[data-composer] button')].find(b => b.textContent === 'Cancel').click()
      const data = JSON.parse(localStorage.getItem('proto-comments-smoke'))
      data.items.push(legacy)
      localStorage.setItem('proto-comments-smoke', JSON.stringify(data))
      return 'ok'
    })()`)
    if (removed !== 'ok') fail(`pictures: ${removed}`)
    await page.run('location.reload()')
    const legacy = await page.run(`(async () => {
      ${helpers}
      const row = () => [...document.querySelectorAll('[data-shoot=comment-row]')].find(r => r.textContent.includes('Legacy picture'))
      if (!await until(row)) return 'the legacy draft was not restored after reload'
      row().querySelector('button').click()
      if (!await until(() => editor() && pictures() === 1)) return 'the legacy picture did not reopen'
      document.querySelector('[data-composer] button[aria-label="Remove the image"]').click()
      if (!await until(() => pictures() === 0)) return 'the legacy picture did not disappear'
      document.querySelector('[data-composer] button[title^="Add,"]').click()
      const saved = () => JSON.parse(localStorage.getItem('proto-comments-smoke') || '{}').items?.find(i => i.id === 'legacy-picture')
      if (!await until(() => !editor() && saved() && !(saved().shots?.length || saved().shot))) return 'Save restored the legacy picture'
      document.querySelector('[data-shoot=send]').click()
      return 'ok'
    })()`)
    if (legacy !== 'ok') fail(`pictures: ${legacy}`)
    let cleared = ''
    for (let i = 0; i < 40 && !cleared.includes('Legacy picture'); i++) { cleared += proto(['inbox'], { stdout: true }); if (!cleared.includes('Legacy picture')) await new Promise(r => setTimeout(r, 250)) }
    for (const words of ['Remove every picture', 'Legacy picture']) {
      const comment = cleared.split(/^\d+\. /m).find(c => c.includes(words))
      if (!comment || /^ {3}image:/m.test(comment)) fail('pictures: Send must omit the removed picture for ' + words)
    }

  } finally { page.close() }
  proto(['archive', 'picsfx'])
  console.log('\nOK: a comment takes several pictures (up to six), and proto inbox lists each')
}
