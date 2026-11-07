// A comment carries the tweaks the user had changed on its variant: the page stamps them on the
// comment as it is written (the ones left at their defaults are not), the server keeps them,
// `proto inbox` prints them, and `proto shoot --pin` sets them again before its shot.
// Runs in the smoke suite, or on its own: node .github/smoke.mjs --comment-tweaks-only
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commentsKey } from './comments-key.mjs'

export async function commentTweaksChecks({ proto, app, openPage, fail }) {
  proto(['add', 'tweakcfx', '--title', 'Comment tweaks', '--variants', 'A:Sized'])
  writeFileSync(join(app, 'src', 'protos', 'tweakcfx', 'A.tsx'), `import { useState } from 'react'
import { useTweaks } from '../../tweaks'
export default function Sized() {
  const [size, setSize] = useState('Small')
  const [glow, setGlow] = useState(false)
  useTweaks([
    { id: 'size', label: 'Size', kind: 'select', value: size, defaultValue: 'Small', options: ['Small', 'Large'], set: setSize },
    { id: 'glow', label: 'Glow', kind: 'toggle', value: glow, defaultValue: false, set: setGlow },
  ])
  return <main data-tweakcfx={size} style={{ height: size === 'Large' ? 400 : 200, background: '#e0f2fe' }}>Sized</main>
}
`)
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}tweakcfx/A?theme=light`)
  const helpers = `
    const until = async f => { for (const end = Date.now() + 6000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const v = f(); if (v) return v } return null }
    const box = () => document.querySelector('[data-shoot=whole-input]')
    const saved = () => JSON.parse(localStorage.getItem('${commentsKey(app)}') || '{}').items?.filter(i => i.proto === 'tweakcfx') ?? []
  `
  let batch = ''
  try {
    const typed = await page.run(`(async () => {
      ${helpers}
      if (!await until(() => window.__protoDesign?.()?.querySelector('[data-tweakcfx]'))) return 'the variant never mounted'
      // Set again until it holds: the dev server can remount the design once as it starts.
      if (!await until(() => window.__protoDesign()?.querySelector('[data-tweakcfx=Large]') || (window.__proto?.tweaks?.change(window.__protoDesign(), 'size', 'Large'), false))) return 'the design did not take the size tweak: ' + window.__protoDesign()?.innerHTML.slice(0, 200) + ' fields ' + JSON.stringify(window.__proto?.tweaks?.of(window.__protoDesign()))
      await new Promise(r => setTimeout(r, 500))
      if (!window.__protoDesign()?.querySelector('[data-tweakcfx=Large]')) return 'the size tweak did not stay'
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', shiftKey: true, bubbles: true }))
      if (!await until(() => box() && document.activeElement === box())) return 'Shift+C did not open the whole-variant box'
      box().textContent = 'Too much empty space at this size'
      box().dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()`)
    if (typed !== 'ok') fail(`comment tweaks: ${typed}`)
    await page.key('Enter', ['Meta'])
    const stamped = await page.run(`(async () => {
      ${helpers}
      const c = await until(() => saved().find(i => i.sent))
      if (!c) return 'the comment was not added and sent'
      const want = JSON.stringify([{ id: 'size', label: 'Size', value: 'Large', was: 'Small' }])
      if (JSON.stringify(c.tweaks) !== want) return 'the comment should carry the changed tweak only, it has ' + JSON.stringify(c.tweaks)
      return 'ok ' + c.sent.batch
    })()`)
    if (!String(stamped).startsWith('ok ')) fail(`comment tweaks: ${stamped}`)
    batch = String(stamped).slice(3)
  } finally {
    await page.close()
  }

  const kept = JSON.parse(readFileSync(join(app, '.proto', 'inbox', 'new', batch, 'batch.json'), 'utf8'))
  if (JSON.stringify(kept.comments[0].tweaks) !== JSON.stringify([{ id: 'size', label: 'Size', value: 'Large', was: 'Small' }])) fail(`comment tweaks: the batch should keep the tweak: ${JSON.stringify(kept.comments[0])}`)
  const inbox = proto(['inbox'], { stdout: true })
  if (!inbox.includes('tweaks: Size = "Large" (default "Small")')) fail(`comment tweaks: proto inbox should print the tweak the comment was written with: ${inbox}`)
  const shot = proto(['shoot', '--pin', `${batch}/1`], { stdout: true })
  if (!/its tweaks: Size set as the user had it/.test(shot)) fail(`comment tweaks: shoot --pin should set the tweak: ${shot}`)
  if (!/box: \S+ \d+x400 page px/.test(shot)) fail(`comment tweaks: shoot --pin should shoot the design at the tweak's size (400 tall): ${shot}`)
  proto(['reply', batch, 'checked', '--done'])

  // The server keeps only well-formed tweaks, and none on a decision.
  const res = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [
    { route: 'tweakcfx/A', text: 'x', tweaks: [{ id: 'glow', label: 'Glow', value: true, was: false }, { id: 'bad', label: 'Bad', value: { no: 1 }, was: 'a' }, 'junk'] },
    { route: 'tweakcfx/A', text: 'y', action: 'more', tweaks: [{ id: 'glow', label: 'Glow', value: true, was: false }] },
  ] }) })
  const id = (await res.json()).sent
  const posted = JSON.parse(readFileSync(join(app, '.proto', 'inbox', 'new', id, 'batch.json'), 'utf8')).comments
  if (JSON.stringify(posted[0].tweaks) !== JSON.stringify([{ id: 'glow', label: 'Glow', value: true, was: false }])) fail(`comment tweaks: the server should keep only the well-formed tweak: ${JSON.stringify(posted[0].tweaks)}`)
  if (posted[1].tweaks) fail('comment tweaks: a decision should carry no tweaks')
  const printed = proto(['inbox'], { stdout: true })
  if (!printed.includes('tweaks: Glow = on (default off)')) fail(`comment tweaks: a toggle should print as on or off: ${printed}`)
  proto(['reply', id, 'checked', '--done'])
}
