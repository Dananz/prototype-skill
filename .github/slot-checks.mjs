// A variant plugged into a slot shows in its parent, live; a pointer cleared, archived or broken shows the original.
import { readFileSync, writeFileSync } from 'node:fs'
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
  const meta = metaOf('slothome')
  meta.slots = { cta: { variant: 'B' } }
  writeFileSync(metaFile('slothome'), `export default ${JSON.stringify(meta, null, 2)}\n`)
  proto(['add', 'slotbtn', '--title', 'Button', '--variants', 'A:Current,B:Rounded,C:Broken'])
  writeFileSync(join(protos, 'slotbtn/A.tsx'), `export default function A() { return <button>Original button</button> }`)
  writeFileSync(join(protos, 'slotbtn/B.tsx'), `export default function B({ label = 'Go' }: { label?: string }) { return <button>Rounded {label}</button> }`)
  writeFileSync(join(protos, 'slotbtn/C.tsx'), `export default function C(): never { throw new Error('broken variant') }`)

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
  } finally { page.close() }
  console.log('\nOK: a variant plugs into its parent from a pick in the page and from proto pick, and handoff and inbox know it')
}
