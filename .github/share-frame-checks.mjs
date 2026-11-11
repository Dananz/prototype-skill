// The actual share build under the host's CSP. Once loaded, device frames must still
// switch when the host refuses further page downloads.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildShare } from '../app/share/build.mjs'
import { host } from './share-link-checks.mjs'

const sleep = ms => new Promise(ok => setTimeout(ok, ms))
async function until(read, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    const value = await read()
    if (value) return value
    await sleep(40)
  }
  return false
}

export async function shareFrameChecks({ proto, app, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`share frames: ${why}`) }
  const shots = process.env.PROTO_SHARE_FRAME_SHOTS
  if (shots) mkdirSync(shots, { recursive: true })
  proto(['add', 'frame-switch', '--title', 'Shared designs', '--variants', 'A:Ink,B:Violet,C:Halo'])
  for (const [id, color, name] of [['A', '#222222', 'Ink'], ['B', '#7126d9', 'Violet'], ['C', '#0f766e', 'Halo']]) {
    writeFileSync(join(app, 'src/protos/frame-switch', `${id}.tsx`), `import { useEffect } from 'react'
      export default function ${id}() {
      useEffect(() => { if (parent !== window) parent.postMessage({testFrameDesign:'${id}'}, '*') }, [])
      return <main data-design="${id}" className="min-h-screen bg-white p-10 text-zinc-900">
        <p className="text-sm text-zinc-500">Shared design ${id} · שלום</p>
        <h1 className="mt-3 text-4xl font-semibold">${name}</h1>
        <p className="mt-4 text-lg">The selected design stays interactive at every device size.</p>
        <button className="mt-8 rounded-xl px-5 py-3 text-white" style={{background:'${color}'}}>${name} action</button>
        <label className="mt-8 block">Your note<input className="ms-3 rounded border p-2" defaultValue="Keep this text" /></label>
        <a href="#details" className="mt-6 block underline">Jump to details</a>
        <div className="h-[1000px]" /><h2 id="details">${name} details</h2>
      </main>
    }`)
  }
  const scope = { protos: [{ id: 'frame-switch', variants: ['A', 'B', 'C'] }], start: 'frame-switch/A' }
  const built = await buildShare({ sessionDir: app, scope, info: { title: 'Shared designs', owner: 'Smoke', version: 1 } })
  if (shots) writeFileSync(join(shots, 'share.html'), built.html)
  const site = await host(built.html)
  const page = await openPage(`${site.url}s/smk123/?theme=light&lang=he`)
  const click = async (selector, at = page) => {
    const p = await until(() => at.run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); const r=e?.getBoundingClientRect(); return r && r.width ? [r.x+r.width/2,r.y+r.height/2] : null })()`))
    assert(p, `missing control ${selector}`)
    await at.press(...p)
  }
  const current = () => page.run(`(() => { const d=document.querySelector('[data-full] iframe')?.contentDocument; return d?.documentElement.dataset.ready === '1' ? d.querySelector('[data-design]')?.getAttribute('data-design') : null })()`)
  try {
    assert(await until(() => page.run(`document.querySelectorAll('[data-board] [data-design]').length === 3`)), 'the three desk previews did not mount')
    if (shots) await page.screenshot(join(shots, 'desktop-desk.png'))
    await page.key('ArrowLeft')
    assert(await until(() => page.run(`document.querySelector('[data-viewer-bar] p:has(> .tabular-nums)')?.textContent.includes('Violet')`)), 'RTL Left should select the next shared design on the desk')
    await page.key('ArrowRight')
    assert(await until(() => page.run(`document.querySelector('[data-viewer-bar] p:has(> .tabular-nums)')?.textContent.includes('Ink')`)), 'RTL Right should select the previous shared design')
    await click('[data-viewer-bar] [data-switcher]')
    assert(await until(() => page.run(`document.querySelectorAll('[data-design-list] button').length === 3`)), 'even three designs need a named variant list')
    await page.key('ArrowLeft')
    assert(await page.run(`document.querySelector('[data-viewer-bar] p:has(> .tabular-nums)')?.textContent.includes('Ink')`), 'an open variants popup must keep its arrow keys')
    if (shots) { await sleep(250); await page.screenshot(join(shots, 'desktop-variants.png')) }
    await page.key('Escape')
    await sleep(250)
    await click('[data-viewer-language]')
    assert(await until(() => page.run(`document.querySelectorAll('[data-viewer-lang]').length === 3`)), 'the viewer needs browser, English and Hebrew choices without signing in')
    if (shots) { await sleep(250); await page.screenshot(join(shots, 'desktop-language.png')) }
    await page.key('Escape')
    await sleep(250)

    const phone = await openPage(`${site.url}s/smk123/?theme=light`, { width: 390, height: 844, phone: true })
    try {
      assert(await until(() => phone.run(`!!document.querySelector('[data-design="A"]')`)), 'phone design did not mount')
      assert(await phone.run(`document.documentElement.lang === (navigator.languages[0].startsWith('he') ? 'he' : 'en')`), 'a fresh viewer should use the browser language')
      if (shots) await phone.screenshot(join(shots, 'phone.png'))
      await click('[data-viewer-language]', phone)
      await click('[data-viewer-lang="he"]', phone)
      assert(await until(() => phone.run(`document.documentElement.lang === 'he' && document.querySelector('[data-viewer]')?.dir === 'rtl'`)), 'the phone language picker did not switch to Hebrew')
      await click('[data-switcher]', phone)
      if (shots) { await sleep(250); await phone.screenshot(join(shots, 'phone-variants-he.png')) }
      await phone.key('Escape')
      await sleep(250)
      await phone.key('ArrowLeft')
      assert(await until(() => phone.run(`!!document.querySelector('[data-design="B"]')`)), 'RTL phone Left did not select B')
      await click('[data-viewer-language]', phone)
      await click('[data-viewer-lang="en"]', phone)
      assert(await until(() => phone.run(`document.documentElement.lang === 'en' && document.querySelector('[data-viewer]')?.dir === 'ltr'`)), 'an explicit URL language must not lock the language picker')
      await phone.key('ArrowRight')
      assert(await until(() => phone.run(`!!document.querySelector('[data-design="B"]')`)), 'LTR phone Right did not select B')
      await click('[data-viewer-language]', phone)
      await click('[data-viewer-lang="auto"]', phone)
      assert(await until(() => phone.run(`!new URL(location.href).searchParams.has('lang') && !localStorage.getItem('proto-viewer-lang')`)), 'browser language could not be restored')
    } finally { phone.close() }
    await click('[data-board="frame-switch/A"] [data-frame]')
    assert(await until(async () => await current() === 'A'), 'opening the first design failed')
    await sleep(500)
    if (shots) await page.screenshot(join(shots, 'desktop-full.png'))
    await page.run(`document.querySelector('[data-full] iframe').contentDocument.querySelector('input').focus()`)
    await page.key('ArrowLeft')
    assert(await current() === 'A', 'arrow keys in a design text field must stay in that field')
    await page.run(`document.querySelector('[data-full] iframe').contentDocument.querySelector('input').blur()`)
    await page.key('ArrowLeft')
    assert(await until(async () => await current() === 'B'), 'an unclaimed arrow inside the full design frame should select B')
    await page.key('ArrowRight')
    assert(await until(async () => await current() === 'A'), 'an arrow inside the next frame should return to A')
    await click('[data-viewer-bar] [data-switcher]')
    await click('[data-design-list] button:nth-child(3)')
    assert(await until(async () => await current() === 'C'), 'the variants list must switch the actual full-size design')
    await click('[data-viewer-bar] [data-prev]')
    assert(await until(async () => await current() === 'B'), 'previous from C must select B')
    await click('[data-viewer-bar] [data-prev]')
    assert(await until(async () => await current() === 'A'), 'previous from B must select A')


    // This is the original failure: the old frame stays on screen while a new page
    // request hangs or fails. A self-contained share already has every design.
    site.state.failFrames = true
    const start = site.state.paths.length
    await click('[data-viewer-bar] [data-next]')
    const changed = await until(async () => await current() === 'B')
    await sleep(350)
    if (shots) await page.screenshot(join(shots, 'desktop-switch.png'))
    assert(changed, 'Next did not show B when the host refused another page download')
    await click('[data-viewer-bar] [data-prev]')
    assert(await until(async () => await current() === 'A'), 'Previous did not show A')
    const requests = site.state.paths.slice(start).filter(p => /[?&]frame=/.test(p))
    assert(requests.length === 0, `switching fetched ${requests.length} complete pages`)
    assert(await page.run(`document.querySelector('[data-full] iframe').contentDocument.documentElement.lang === 'he'`), 'the frame lost the requested language')
    assert(await page.run(`document.querySelector('[data-full] iframe').contentDocument.querySelector('[data-viewer]') === null`), 'the frame recursively booted another viewer')

    await page.run(`document.querySelector('[data-full] iframe').contentDocument.querySelector('a[href="#details"]').click()`)
    assert(await until(() => page.run(`document.querySelector('[data-full] iframe')?.contentWindow.location.hash === '#details'`)), 'the design fragment link did not navigate within its document')
    assert(await current() === 'A' && await page.run(`document.querySelector('[data-full] iframe').contentDocument.querySelector('[data-viewer]') === null`), 'the fragment link loaded a nested viewer')
    assert(site.state.paths.slice(start).filter(p => /[?&]frame=/.test(p)).length === 0, 'a fragment link downloaded another page')

    // A normal navigation remains available when the share is framed by URL.
    site.state.failFrames = false
    const direct = await openPage(`${site.url}s/smk123/?frame=frame-switch%2FC&theme=dark&device=phone&lang=en&v=1`)
    try {
      assert(await until(() => direct.run(`document.querySelector('[data-design="C"]') && !document.querySelector('[data-viewer]') && document.documentElement.classList.contains('dark') && document.documentElement.lang === 'en'`)), 'a direct frame URL lost its design, theme or language')
    } finally { direct.close() }

    const file = join(app, '.proto', 'frame-share.html')
    writeFileSync(file, built.html)
    const disk = await openPage(pathToFileURL(file).href)
    try {
      // file:// frames have opaque origins, so prove the mounted design through
      // its own message rather than assuming contentDocument is reachable.
      await disk.run(`window.__mountedDesigns=[]; addEventListener('message', e => { if(e.source === document.querySelector('[data-full] iframe')?.contentWindow && e.data?.testFrameDesign) window.__mountedDesigns.push(e.data.testFrameDesign) })`)
      await click('[data-board="frame-switch/A"] [data-frame]', disk)
      assert(await until(() => disk.run(`window.__mountedDesigns.at(-1) === 'A'`)), 'the file share did not open A')
      await click('[data-viewer-bar] [data-next]', disk)
      assert(await until(() => disk.run(`window.__mountedDesigns.at(-1) === 'B'`)), 'the file share did not switch to B')
    } finally { disk.close() }
    const faces = [...built.html.matchAll(/@font-face\s*\{[^{}]*\}/gi)].map(m => m[0]).filter(face => face.includes('Google Sans Variable'))
    assert(faces.length > 0 && !faces.some(face => /U\+0?980/i.test(face)), 'the English/Hebrew share kept the unused Bengali font subset')
    console.log('OK: share frames switch without page downloads; direct URLs, language and phone layout preserved')
  } finally { page.close(); site.close() }
}
