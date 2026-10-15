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

  // An agent can forget --slot. Mark the choice, but keep its assignment as work to do.
  const created = proto(['add', 'slotloose', '--from', 'slothome/B', '--variants', 'A:Current,B:Rounded'])
  assert(created.includes('assignment needed') && created.includes('--slot'), 'creation did not warn about an unconnected replacement')
  const response = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route: 'slotloose/B', text: 'Picked B', action: 'pick' }] }) })
  const result = await response.json()
  assert(response.ok && result.results?.[0]?.done === false, 'a child with no slot arrived done without being assigned')
  assert(metaOf('slotloose').picked === 'B', 'a missing slot lost the user\'s choice')
  const batchFile = sub => join(app, '.proto/inbox', sub, result.sent, 'batch.json')
  assert(!JSON.parse(readFileSync(batchFile('new'), 'utf8')).done, 'the unassigned pick batch was completed')
  const heard = proto(['inbox'])
  assert(heard.includes('assignment pending') && heard.includes('slothome/B') && heard.includes('--slot') && heard.includes('reply --done'), 'inbox omitted the assignment repair instructions')
  assert(proto(['reply', `${result.sent}/1`, 'Only noted the pick', '--done'], { ok: false }).includes('cannot mark'), 'reply --done could hide an unrepaired assignment')
  proto(['reply', result.sent, 'Waiting on the component', '--until', 'slotloose'])
  assert(proto(['done', 'slotloose']).includes('assignment pending'), 'finishing builds did not tell the agent its assignment was still pending')
  assert(!JSON.parse(readFileSync(batchFile('taken'), 'utf8')).comments[0].done, 'finishing variant builds hid an unrepaired assignment')
  const taken = JSON.parse(readFileSync(batchFile('taken'), 'utf8'))
  taken.takenBy = { pid: 2147483647, at: new Date().toISOString() }
  writeFileSync(batchFile('taken'), JSON.stringify(taken))
  assert(proto(['inbox']).includes('session that ended before it answered'), 'an unassigned pick was lost when its agent ended')
  proto(['pick', 'slotloose', '--off'])
  writeFileSync(batchFile('taken'), JSON.stringify(taken))
  const superseded = proto(['inbox'])
  assert(superseded.includes('selection has changed; do not apply') && !superseded.includes('run proto pick slotloose B'), 'an undone pick still told the agent to reinstall it')
  assert(proto(['pick', 'slotloose', 'B']).includes('assignment pending'), 'CLI pick hid the missing assignment')
  proto(['add', 'slotloose', '--from', 'slothome/B', '--slot', 'cta'])
  assert(proto(['reply', `${result.sent}/1`, 'Registered the slot only', '--done'], { ok: false }).includes('not using the chosen variant'), 'slot registration alone incorrectly counted as an installed choice')
  await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route: 'slotbtn/B', text: 'Picked B', action: 'pick' }] }) })
  assert(proto(['reply', `${result.sent}/1`, 'Another child fills it', '--done'], { ok: false }).includes('do not overwrite a newer pick'), 'another child\'s pointer incorrectly counted as this choice being installed')
  proto(['pick', 'slotloose', '--off'])
  proto(['reply', `${result.sent}/1`, 'Superseded by the newer component choice', '--done'])
  assert(metaOf('slothome').slots.cta.use === 'slotbtn/B', 'completing an older request overwrote another child\'s newer choice')
  proto(['pick', 'slotloose', 'B'])
  assert(metaOf('slothome').slots.cta.use === 'slotloose/B', 'repair did not assign the existing choice')
  proto(['reply', `${result.sent}/1`, 'Connected the chosen button', '--done'])
  assert(JSON.parse(readFileSync(batchFile('taken'), 'utf8')).comments[0].done, 'a repaired assignment could not be completed')
  proto(['pick', 'slotloose', '--off'])
  proto(['add', 'slotloose', '--reference-only', '--slot', 'cta'], { ok: false })
  proto(['add', 'slotloose', '--reference-only'], { ok: false })
  const originalSource = readFileSync(join(protos, 'slothome/B.tsx'), 'utf8')
  writeFileSync(join(protos, 'slothome/B.tsx'), `export default function B() { return <main>Original button</main> }`)
  try {
    const broken = await (await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route: 'slotloose/B', text: 'Picked B', action: 'pick' }] }) })).json()
    assert(broken.results?.[0]?.done === false, 'a registered slot removed from source arrived done')
    assert(proto(['inbox']).includes('no longer renders'), 'inbox claimed a broken slot was plugged in')
    writeFileSync(join(protos, 'slothome/B.tsx'), originalSource)
    proto(['pick', 'slotloose', 'B'])
    proto(['reply', `${broken.sent}/1`, 'Restored the slot', '--done'])
    proto(['pick', 'slotloose', '--off'])
  } finally { writeFileSync(join(protos, 'slothome/B.tsx'), originalSource) }
  proto(['archive', 'slotloose'])
  proto(['add', 'slotref', '--from', 'slothome/B', '--reference-only', '--variants', 'A:Current,B:Independent'])
  assert(metaOf('slotref').referenceOnly === true, 'reference-only intent was not persisted')
  for (const route of ['slotref/B', 'slotref/A']) {
    const picked = await (await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route, text: 'Picked', action: 'pick' }] }) })).json()
    assert(picked.results?.[0]?.done === true, 'a reference-only pick no longer completes immediately')
  }
  proto(['inbox'])
  proto(['pick', 'slotref', '--off'])
  proto(['archive', 'slotref'])
  proto(['add', 'slotsynth', '--from', 'slothome/B,slotbtn/B', '--variants', 'A:Combined screen'])
  assert(metaOf('slotsynth').referenceOnly && metaOf('slotsynth').also[0] === 'slotbtn/B', 'a multi-parent composition was treated as a replacement')
  const synthesis = await (await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route: 'slotsynth/A', text: 'Picked A', action: 'pick' }] }) })).json()
  assert(synthesis.results?.[0]?.done === true && metaOf('slotsynth').also[0] === 'slotbtn/B', 'a composition pick lost its lineage or stayed pending')
  proto(['add', 'slotall', '--from-picks', '--variants', 'A:All picks'])
  assert(metaOf('slotall').referenceOnly, 'a --from-picks composition was not reference-only')
  proto(['inbox'])
  proto(['archive', 'slotsynth'])
  proto(['archive', 'slotall'])

  // A decision made in the page, as its buttons send it: the server marks it and moves the pointer.
  const decide = async (route, action) => {
    const res = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route, text: action === 'pick' ? `Picked ${route.split('/')[1]}` : 'Took the pick back', action }] }) })
    const body = await res.json().catch(() => ({}))
    assert(res.ok && body.results?.[0]?.done, `${action} ${route} answered ${res.status}: ${JSON.stringify(body.results ?? body)}`)
  }

  // What a plug-in left in the history (session.json asks), and the working variant it must not move.
  const session = () => JSON.parse(readFileSync(join(app, 'session.json'), 'utf8'))
  const lines = key => (session().asks?.[key] || []).map(a => a.text)
  const ends = (key, want, why) => {
    const got = lines(key).slice(-want.length)
    assert(JSON.stringify(got) === JSON.stringify(want), `${why}: ${key} history ends ${JSON.stringify(got)}, not ${JSON.stringify(want)}`)
  }
  const worksOn = (want, why) => {
    const w = session().work
    assert(`${w?.proto}/${w?.variant}` === want, `${why}: the working variant is ${w?.proto}/${w?.variant}, not ${want}`)
  }
  const unchanged = (run, why) => { const was = JSON.stringify(session().asks); run(); assert(JSON.stringify(session().asks) === was, `${why}: the history changed`) }

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
    // Both variants say so in their history, after "Picked B", and the working variant is the pick.
    ends('slotbtn/B', ['Picked B', 'Plugged into Slot home B'], 'a page pick')
    ends('slothome/B', ['Plugged in Button B'], 'a page pick')
    worksOn('slotbtn/B', 'a page pick')
    // The strip lists it as a status line: its text as written, and not one of the changes asked for.
    await page.run(`location.hash = '#/slotbtn/B'`)
    const header = await page.run(`(async () => { for (const end = Date.now() + 10000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const b = document.querySelector('[data-act="asks"]'); if (b) return b.innerText.trim() } return 'no asks button: ' + document.body.innerText.slice(-300) })()`)
    assert(header === '0 changes you asked for', `a plug-in counted as a request: the strip says "${header}"`)
    await page.run(`document.querySelector('[data-act="asks"]').click()`)
    await until('Plugged into Slot home B', 'the strip lists the plug-in')
    assert(await page.run(`document.querySelector('[data-act="asks"]').innerText.trim()`) === '0 changes you asked for', 'opening the list changed its count')
    await page.run(`location.hash = '#/slothome/B'`)
    await until('Rounded Go', 'back on the parent after looking at the strip')
    const before = lines('slothome/B').length
    await decide('slotbtn/A', 'pick')
    await until('Original button', 'picking Current puts the original back')
    assert(!metaOf('slothome').slots.cta.use, 'picking Current left a pointer')
    ends('slotbtn/A', ['Picked A', 'Original back in Slot home B'], 'a page pick of Current')
    ends('slothome/B', ['Plugged in Button B', 'Original back, took out Button B'], 'a page pick of Current')
    assert(lines('slothome/B').length === before + 1, 'a page pick of Current wrote more than one line on the parent')
    worksOn('slotbtn/A', 'a page pick of Current')
    // Current again with nothing plugged in changes no pointer: only its "Picked A".
    await decide('slotbtn/A', 'pick')
    ends('slotbtn/A', ['Original back in Slot home B', 'Picked A'], 'a pick of Current with nothing plugged in')
    ends('slothome/B', ['Plugged in Button B', 'Original back, took out Button B'], 'a pick of Current with nothing plugged in')
    await decide('slotbtn/B', 'pick')
    await until('Rounded Go', 'picking B again plugs it in')
    ends('slotbtn/B', ['Picked B', 'Plugged into Slot home B'], 'a second page pick')
    await decide('slotbtn/B', 'unpick')
    await until('Original button', 'taking the pick back puts the original back')
    assert(!metaOf('slothome').slots.cta.use, 'the unpick left a pointer')
    ends('slotbtn/B', ['Plugged into Slot home B', 'Original back in Slot home B'], 'a page unpick')
    ends('slothome/B', ['Plugged in Button B', 'Original back, took out Button B'], 'a page unpick')
    worksOn('slotbtn/B', 'a page unpick')
    // An unpick of what is not the pick changes nothing, so it leaves nothing.
    const asksNow = JSON.stringify(session().asks)
    await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route: 'slotbtn/B', text: 'Took the pick back', action: 'unpick' }] }) })
    assert(JSON.stringify(session().asks) === asksNow, 'an unpick of a variant that is not the pick wrote history')
    await decide('slotbtn/C', 'pick')
    await until('Original button', 'a picked variant that throws still shows the original')
    ends('slothome/B', ['Original back, took out Button B', 'Plugged in Button C'], 'a page pick of a variant that throws')
    await decide('slotbtn/C', 'unpick')
    ends('slothome/B', ['Plugged in Button C', 'Original back, took out Button C'], 'a page unpick of the variant that throws')
    // The CLI's pick follows the same rule as the page's.
    proto(['pick', 'slotbtn', 'B'])
    await until('Rounded Go', 'proto pick plugs the variant in')
    assert(metaOf('slothome').slots.cta.use === 'slotbtn/B', 'proto pick did not write the parent\'s pointer')
    ends('slotbtn/B', ['Picked B', 'Plugged into Slot home B'], 'proto pick')
    ends('slothome/B', ['Plugged in Button B'], 'proto pick')
    worksOn('slotbtn/B', 'proto pick')
    proto(['pick', 'slotbtn', 'A'])
    await until('Original button', 'proto pick of Current puts the original back')
    assert(!metaOf('slothome').slots.cta.use, 'proto pick of Current left a pointer')
    ends('slotbtn/A', ['Picked A', 'Original back in Slot home B'], 'proto pick of Current')
    ends('slothome/B', ['Plugged in Button B', 'Original back, took out Button B'], 'proto pick of Current')
    worksOn('slotbtn/A', 'proto pick of Current')
    proto(['pick', 'slotbtn', 'B'])
    await until('Rounded Go', 'proto pick plugs the variant in again')
    proto(['pick', 'slotbtn', '--off'])
    await until('Original button', 'proto pick --off puts the original back')
    assert(!metaOf('slothome').slots.cta.use, 'proto pick --off left a pointer')
    ends('slotbtn/B', ['Plugged into Slot home B', 'Original back in Slot home B'], 'proto pick --off')
    ends('slothome/B', ['Plugged in Button B', 'Original back, took out Button B'], 'proto pick --off')
    worksOn('slotbtn/B', 'proto pick --off')
    // Nothing plugged in or out, nothing written: --off with no pick, and Current with the original showing.
    unchanged(() => proto(['pick', 'slotbtn', '--off']), 'proto pick --off with no pick')
    ends('slothome/B', ['Plugged in Button B', 'Original back, took out Button B'], 'proto pick --off with no pick')
    proto(['pick', 'slotbtn', 'A'])
    ends('slotbtn/A', ['Original back in Slot home B', 'Picked A'], 'proto pick of Current with nothing plugged in')
    ends('slothome/B', ['Plugged in Button B', 'Original back, took out Button B'], 'proto pick of Current with nothing plugged in')
    // A build of the parent is of the plugged-in design: its slot and that variant's file are named.
    proto(['pick', 'slotbtn', 'B'])
    const handoff = proto(['handoff', 'slothome/B'], { stdout: true })
    assert(handoff.includes('## Slots') && handoff.includes('cta') && handoff.includes('slotbtn/B'), 'handoff does not name the slot and what is plugged in')
    assert(handoff.includes('slotbtn/B.tsx'), 'handoff does not list the plugged-in variant\'s file')
    proto(['pick', 'slotbtn', '--off'])
    assert(!proto(['handoff', 'slothome/B'], { stdout: true }).includes('## Slots'), 'handoff names a slot with nothing plugged in')
    // A pick in the page says it is already in the parent, so the agent edits no source for it.
    proto(['inbox'])
    await decide('slotbtn/B', 'pick')
    const told = proto(['inbox'], { stdout: true })
    assert(/action: pick \(done[^\n]*slotbtn fills the cta slot of slothome\/B/.test(told), `proto inbox does not say the pick is already plugged in: ${told}`)
    await decide('slotbtn/B', 'unpick')
    proto(['inbox']) // the page's picks arrive done; take them so later queue counts start clean
  } finally { page.close() }
  // Unpicking the child deliberately keeps its parent's choice; reset this fixture explicitly.
  proto(['pick', 'slothome', '--off'])
  console.log('\nOK: a variant plugs into its parent from a pick in the page and from proto pick, and handoff and inbox know it')
}
