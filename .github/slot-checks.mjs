// A variant plugged into a slot shows in its parent, live; a pointer cleared, archived or broken shows the original.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function slotChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`slots: ${why}`) }
  const protos = join(app, 'src/protos')
  const metaFile = slug => join(protos, slug, 'meta.ts')
  const metaOf = slug => JSON.parse(readFileSync(metaFile(slug), 'utf8').replace(/^[\s\S]*?export default\s*/, ''))
  const setUse = use => {
    const m = metaOf('slothome')
    if (use) m.slots.cta.use = use; else delete m.slots.cta.use
    writeFileSync(metaFile('slothome'), `export default ${JSON.stringify(m, null, 2)}\n`)
  }

  proto(['add', 'slothome', '--title', 'Slot home', '--variants', 'A:Classic,B:With button'])
  writeFileSync(join(protos, 'slothome/A.tsx'), `export default function A() { return <main>Home A</main> }`)
  writeFileSync(join(protos, 'slothome/B.tsx'), `import { Slot } from '../../slot'
export default function B() { return <main><h1>Home B</h1><Slot proto="slothome" id="cta" label="Go"><button>Original button</button></Slot></main> }`)
  // A variant with no <Slot> in it, or no variant named, has nothing to plug into.
  proto(['add', 'slotbtn', '--from', 'slothome/A', '--slot', 'cta', '--variants', 'A:Current'], { ok: false })
  proto(['add', 'slotbtn', '--from', 'slothome', '--slot', 'cta', '--variants', 'A:Current'], { ok: false })
  assert(!existsSync(join(protos, 'slotbtn')), 'a refused add --slot left a prototype behind')
  proto(['add', 'slotbtn', '--title', 'Button', '--from', 'slothome/B', '--slot', 'cta', '--variants', 'A:Current,B:Rounded,C:Broken'])
  assert(metaOf('slothome').slots?.cta?.variant === 'B', 'add --slot did not record the slot in the parent')
  assert(metaOf('slotbtn').slot === 'cta' && metaOf('slotbtn').from === 'slothome/B', 'add --slot did not record the slot in the child')
  writeFileSync(join(protos, 'slotbtn/A.tsx'), `export default function A() { return <button>Original button</button> }`)
  writeFileSync(join(protos, 'slotbtn/B.tsx'), `export default function B({ label = 'Go' }: { label?: string }) { return <button>Rounded {label}</button> }`)
  writeFileSync(join(protos, 'slotbtn/C.tsx'), `export default function C(): never { throw new Error('broken variant') }`)

  // A decision made in the page, as its buttons send it: the server marks it and moves the pointer.
  const decide = async (route, action) => {
    const res = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route, text: action === 'pick' ? `Picked ${route.split('/')[1]}` : 'Took the pick back', action }] }) })
    const body = await res.json().catch(() => ({}))
    assert(res.ok && body.results?.[0]?.done, `${action} ${route} answered ${res.status}: ${JSON.stringify(body.results ?? body)}`)
  }

  const page = await openPage(`${local}#/slothome/B`)
  const until = async (words, why) => {
    const seen = await page.run(`(async () => { for (const end = Date.now() + 10000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { if (document.body.innerText.includes(${JSON.stringify(words)})) return 'ok' } return document.body.innerText.slice(-300) })()`)
    assert(seen === 'ok', `${why}: the page shows "${seen}"`)
  }
  try {
    await until('Original button', 'a slot with no pointer shows its children')
    setUse('slotbtn/B')
    await until('Rounded Go', 'a pointer set while the page is open swaps live, with the slot\'s props')
    setUse('slotbtn/C')
    await until('Original button', 'a variant that throws falls back to the original')
    await until('Home B', 'a variant that throws leaves the parent up')
    setUse('slotbtn/B')
    await until('Rounded Go', 'the slot recovers when the pointer moves to a working variant')
    setUse('')
    await until('Original button', 'a cleared pointer shows the original again')

    await decide('slotbtn/B', 'pick')
    await until('Rounded Go', 'picking B plugs it into slothome/B')
    assert(metaOf('slothome').slots.cta.use === 'slotbtn/B', 'the pick did not write the parent\'s pointer')
    await decide('slotbtn/A', 'pick')
    await until('Original button', 'picking Current puts the original back')
    assert(!metaOf('slothome').slots.cta.use, 'picking Current left a pointer')
    await decide('slotbtn/B', 'pick')
    await until('Rounded Go', 'picking B again plugs it in')
    await decide('slotbtn/B', 'unpick')
    await until('Original button', 'taking the pick back puts the original back')
    assert(!metaOf('slothome').slots.cta.use, 'the unpick left a pointer')
    await decide('slotbtn/C', 'pick')
    await until('Original button', 'a picked variant that throws still shows the original')
    await decide('slotbtn/C', 'unpick')
    // The CLI's pick follows the same rule as the page's.
    proto(['pick', 'slotbtn', 'B'])
    await until('Rounded Go', 'proto pick plugs the variant in')
    assert(metaOf('slothome').slots.cta.use === 'slotbtn/B', 'proto pick did not write the parent\'s pointer')
    proto(['pick', 'slotbtn', 'A'])
    await until('Original button', 'proto pick of Current puts the original back')
    assert(!metaOf('slothome').slots.cta.use, 'proto pick of Current left a pointer')
    proto(['pick', 'slotbtn', 'B'])
    await until('Rounded Go', 'proto pick plugs the variant in again')
    proto(['pick', 'slotbtn', '--off'])
    await until('Original button', 'proto pick --off puts the original back')
    assert(!metaOf('slothome').slots.cta.use, 'proto pick --off left a pointer')
    proto(['inbox']) // the page's picks arrive done; take them so later queue counts start clean
  } finally { page.close() }
  console.log('\nOK: a variant plugs into its parent from a pick in the page and from proto pick, and handoff and inbox know it')
}
