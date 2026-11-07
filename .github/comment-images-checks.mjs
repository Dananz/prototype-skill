// Whole-variant images on desktop and phone: a pasted image sits in the words as a chip, removal, its
// peek and the picture full screen, and the comment sent with it.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commentsKey } from './comments-key.mjs'

export async function commentImagesChecks({ proto, app, openPage, fail }) {
  proto(['add', 'imagesfx', '--title', 'Image comments', '--variants', 'A:Review'])
  writeFileSync(join(app, 'src', 'protos', 'imagesfx', 'A.tsx'), `export default function Page() {
    return <main style={{ padding: 32 }}><h1>Review the design</h1><button style={{ marginTop: 24 }}>Continue</button></main>
  }`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const before = process.env.PROTO_IMAGE_EVIDENCE_PHASE === 'before'
  const evidence = process.env.PROTO_IMAGE_EVIDENCE
  for (const phone of [false, true]) {
    const layout = phone ? 'phone' : 'desktop'
    const page = await openPage(`${local}imagesfx/A?theme=dark`, phone ? { width: 390, height: 844, phone: true } : { width: 1440, height: 900 })
    try {
      const result = await page.run(`(async () => {
        const until = async f => { for (const end = Date.now() + 8000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
        const box = () => document.querySelector('[data-shoot=whole-input]')
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', shiftKey: true, bubbles: true }))
        if (!await until(() => box())) return 'missing whole-variant input'
        box().focus()
        return 'ok'
      })()`)
      if (result !== 'ok') fail(`${layout} image comments: ${result}`)
      await page.run('new Promise(r => setTimeout(r, 500))')
      if (evidence) await page.screenshot(join(evidence, `${before ? 'before' : 'after'}-${layout}-composer.png`))
      if (evidence && !phone) {
        const menu = await page.run(`(async () => {
          const button = document.querySelector('[data-act="vm:imagesfx:A"]')
          if (!button) return false
          button.click()
          for (const end = Date.now() + 5000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (document.querySelector('[data-shoot=vm-comment]')) return true
          return false
        })()`)
        if (!menu) fail('could not capture decision note')
        await page.run('new Promise(r => setTimeout(r, 500))')
        await page.screenshot(join(evidence, `${before ? 'before' : 'after'}-desktop-decision.png`))
        await page.key('Escape')
        const point = await page.run(`(async () => {
          document.querySelector('[data-act="comment:toggle"]').click()
          await new Promise(r => setTimeout(r, 300))
          const frame = document.querySelector('[data-view] iframe')
          const doc = frame?.contentDocument ?? document
          const r = doc.querySelector('[data-mount] button').getBoundingClientRect(), f = frame?.getBoundingClientRect()
          return { x: r.x + r.width / 2 + (f?.x ?? 0), y: r.y + r.height / 2 + (f?.y ?? 0) }
        })()`)
        await page.press(point.x, point.y)
        const composer = await page.run(`(async () => { for (const end = Date.now() + 5000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (document.querySelector('[data-composer]')) return true; return false })()`)
        if (!composer) fail('could not capture element composer')
        await page.run('new Promise(r => setTimeout(r, 500))')
        await page.screenshot(join(evidence, `${before ? 'before' : 'after'}-desktop-element.png`))
        await page.key('Escape')
        await page.run(`document.querySelector('[data-shoot=whole-input]').focus()`)
      }
      if (before) continue
      const attached = await page.run(`(async () => {
        const until = async f => { for (const end = Date.now() + 8000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (f()) return true; return false }
        const box = () => document.querySelector('[data-shoot=whole-input]')
        if ([...document.querySelectorAll('input[type=file]')].some(e => e.closest('[data-island]'))) return 'image picker came back'
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b5c8dd'; ctx.fillRect(0,0,320,180); ctx.fillStyle = '#26354a'; ctx.font = '24px sans-serif'; ctx.fillText('Reference image', 60, 96)
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
        const dt = new DataTransfer(); dt.items.add(new File([blob], 'Zen Browser 2026-11-07 2.05.53 AM.png', { type: 'image/png' }))
        const chip = () => box().querySelector('[data-img]')
        box().focus()
        document.execCommand('insertText', false, 'Make the title like this ')
        box().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
        if (!await until(() => chip())) return 'paste did not put the image in the words'
        if (chip().textContent !== 'Zen Browser') return 'the chip should have the short name: ' + chip().textContent
        chip().querySelector('[data-img-remove]').click()
        if (!await until(() => !chip())) return 'remove did not take the image out'
        box().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
        if (!await until(() => chip())) return 'paste did not attach image again'
        document.execCommand('insertText', false, ', only lighter')
        if (!box().textContent.replace(/\\s+/g, ' ').startsWith('Make the title like this Zen Browser ')) return 'the image should sit where the caret was: ' + box().textContent
        return 'ok'
      })()`)
      if (attached !== 'ok') fail(`${layout} image comments: ${attached}`)
      await page.run('new Promise(r => setTimeout(r, 500))')
      if (evidence) await page.screenshot(join(evidence, `after-${layout}-attached.png`))
      if (evidence && !phone) {
        await page.run(`(async () => {
          document.querySelector('[data-shoot=whole-input] [data-img]').dispatchEvent(new PointerEvent('pointerover', { pointerType: 'mouse', bubbles: true }))
          for (const end = Date.now() + 3000; Date.now() < end && !document.querySelector('[data-shoot=image-peek]'); await new Promise(r => setTimeout(r, 50)));
          await new Promise(r => setTimeout(r, 300))
        })()`)
        await page.screenshot(join(evidence, 'after-desktop-peek.png'))
        await page.run(`document.querySelector('[data-shoot=whole-input] [data-img]').dispatchEvent(new PointerEvent('pointerout', { pointerType: 'mouse', bubbles: true }))`)
      }
      if (evidence) {
        await page.run(`(async () => {
          document.querySelector('[data-shoot=whole-input] [data-img]').click()
          for (const end = Date.now() + 3000; Date.now() < end && !document.querySelector('[data-shoot=image-full]'); await new Promise(r => setTimeout(r, 50)));
          await new Promise(r => setTimeout(r, 400))
        })()`)
        await page.screenshot(join(evidence, `after-${layout}-full.png`))
        await page.run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
        await page.run('new Promise(r => setTimeout(r, 300))')
      }
      await page.run(`document.querySelector('[data-shoot=whole-input]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }))`)
      const sent = await page.run(`(async () => {
        for (const end = Date.now() + 8000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) {
          const items = JSON.parse(localStorage.getItem('${commentsKey(app)}') || '{}').items ?? []
          if (items.some(i => i.proto === 'imagesfx' && i.shots?.length && i.sent)) return true
        }
        return false
      })()`)
      if (!sent) fail(`${layout}: image-only comment did not reach the inbox`)
    } finally { page.close() }
  }
  if (!before) {
    const inbox = proto(['inbox'], { stdout: true })
    if (!inbox.includes('imagesfx/A') || (inbox.match(/   image: /g) ?? []).length < 2) fail('image-only comments did not retain their inbox pictures')
  }
  proto(['archive', 'imagesfx'])
  console.log('OK: pasted images, removal, no picker button, on desktop and phone')
}
