// While a comment is written, Tag another element also takes a region dragged out on the design:
// it goes in as an @Region tag, and the comment gets that region's picture beside it. proto inbox
// prints the tag's box and names the picture after the tag.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentRegionTagChecks({ proto, app, openPage, fail, keepShots = '' }) {
  const assert = (ok, why) => { if (!ok) fail(`region tag: ${why}`) }
  proto(['add', 'rtagfx', '--title', 'Region tag', '--variants', 'A:Two cards'])
  writeFileSync(join(app, 'src', 'protos', 'rtagfx', 'A.tsx'), `export default function A() {
  return <main style={{ padding: 24, display: 'flex', gap: 24 }}>
    <button data-shoot="target" style={{ width: 160, height: 48 }}>Target</button>
    <div data-shoot="other" style={{ width: 240, height: 160, background: '#1e293b', color: 'white' }}>Other card</div>
  </main>
}
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}rtagfx/A?theme=light`)
  const helpers = `
    const until = async (f, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
    const editor = () => document.querySelector('[data-composer] [role=textbox]')
    const design = () => document.querySelector('[data-view] iframe')?.contentDocument ?? document
    const el = s => design().querySelector('[data-mount] [data-shoot=' + s + ']')
    const pictures = () => document.querySelectorAll('[data-composer] [data-shoot=comment-pictures] button[title="Edit the screenshot"]').length
    // An element's box on this page, through a device view's frame when there is one.
    const box = s => {
      const r = el(s).getBoundingClientRect(), frame = el(s).ownerDocument.defaultView.frameElement
      const f = frame?.getBoundingClientRect(), k = frame ? f.width / frame.offsetWidth : 1
      return { x: (f?.left ?? 0) + r.left * k, y: (f?.top ?? 0) + r.top * k, w: r.width * k, h: r.height * k, k }
    }
  `
  // One comment on Target, tagging a region dragged out over the other card; `words` tell the two runs apart.
  const run = async (words, shot) => {
    const at = await page.run(`(async () => {
      ${helpers}
      const t = () => document.querySelector('[data-act="comment:toggle"]')
      for (let i = 0; i < 4 && t().getAttribute('aria-pressed') !== 'true'; i++) { t().click(); await until(() => t().getAttribute('aria-pressed') === 'true', 1500) }
      if (!await until(() => t().getAttribute('aria-pressed') === 'true' && el('target'))) return 'comment mode never started'
      await new Promise(r => setTimeout(r, 200))
      const b = box('target')
      return [b.x + b.w / 2, b.y + b.h / 2]
    })()`)
    if (!Array.isArray(at)) return fail(`region tag: ${at}`)
    await page.press(...at)
    const drag = await page.run(`(async () => {
      ${helpers}
      if (!await until(editor)) return 'picking the target opened no composer'
      editor().textContent = '${words} '
      editor().dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('[data-composer] button[aria-label="Tag another element"]').click()
      if (!await until(() => document.querySelector('[data-composer]')?.className.includes('pointer-events-none'))) return 'Tag another element did not start picking'
      const b = box('other')
      return [b.x + 20, b.y + 20, b.x + 140, b.y + 110, b.k]
    })()`)
    if (!Array.isArray(drag)) return fail(`region tag: ${drag}`)
    await page.drag([drag[0], drag[1]], [drag[2], drag[3]])
    // Kept for the PR: what the drag left in the composer, before anything is asserted of it.
    if (keepShots) { await new Promise(r => setTimeout(r, 2500)); await page.screenshot(join(keepShots, shot)) }
    const tagged = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => editor()?.querySelector('[data-tag]'))) return 'the region dragged out was not tagged'
      const chip = editor().querySelector('[data-tag]').textContent
      if (chip !== '@Region') return 'the region tag reads ' + JSON.stringify(chip) + ', not @Region'
      if (!await until(() => pictures() === 1, 8000)) return 'the tagged region brought no picture: ' + pictures()
      const img = document.querySelector('[data-composer] [data-shoot=comment-pictures] img')
      await img.decode().catch(() => {})
      // The crop is the region (120x90 on screen, in the design's px when a view scales it, at 2x), not the comment's element.
      const w = Math.round(240 / ${drag[4]}), h = Math.round(180 / ${drag[4]})
      if (Math.abs(img.naturalWidth - w) > 6 || Math.abs(img.naturalHeight - h) > 6) return 'the picture is ' + img.naturalWidth + 'x' + img.naturalHeight + ', not the ' + w + 'x' + h + ' region'
      return 'ok'
    })()`)
    assert(tagged === 'ok', tagged)
    const sent = await page.run(`(async () => {
      ${helpers}
      document.querySelector('[data-composer] button[title^="Add,"]').click()
      if (!await until(() => !editor())) return 'Add did not save the comment'
      const s = document.querySelector('[data-shoot=send]'); if (!s || s.disabled) return 'Send was not ready'
      s.click()
      return 'ok'
    })()`)
    assert(sent === 'ok', sent)
    let heard = ''
    for (let i = 0; i < 40 && !/${words}/.test(heard); i++) { heard += proto(['inbox'], { stdout: true }); if (!/${words}/.test(heard)) await new Promise(r => setTimeout(r, 250)) }
    const size = heard.match(/^ {3}with @1: region \d+,\d+ (\d+)x(\d+) \(dragged out with the mouse; its picture is attached\) in /m)
    assert(!!size && Math.abs(size[1] - 120 / drag[4]) < 3 && Math.abs(size[2] - 90 / drag[4]) < 3, `proto inbox does not print the tag's region: ${heard}`)
    assert(/^ {3}image: .*\(the region tagged @1, as dragged out\)$/m.test(heard), `proto inbox does not name the tag's picture: ${heard}`)
  }
  try {
    await run('Line these up', 'region-tag-after.png')
    // The same in a device view, the way it is most often used: the design is drawn in a frame.
    await page.run(`document.querySelector('[data-bar] [data-act="open:device"][aria-expanded="false"]')?.click()`)
    await page.run(`document.querySelector('[data-size-tabs] [data-act="size:phone"]')?.click()`)
    let phone = false
    for (let i = 0; i < 60 && !phone; i++) { phone = await page.run(`/402 × 874/.test(document.querySelector('[data-view-line]')?.textContent ?? '') && !!document.querySelector('[data-view] iframe')?.contentDocument?.querySelector('[data-shoot=other]')`); if (!phone) await new Promise(r => setTimeout(r, 250)) }
    assert(phone, 'no phone in the view')
    await new Promise(r => setTimeout(r, 400))
    await run('On the phone too', 'region-tag-phone.png')
  } finally {
    await page.close()
  }
}
