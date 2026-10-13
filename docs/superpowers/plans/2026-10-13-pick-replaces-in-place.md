# A Pick Replaces the Thing It Was Made From: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Picking a variant of a prototype that was made from one element of another variant swaps that variant into the element's place, live, and unpicking puts the original back.

**Architecture:** The parent variant wraps the element in `<Slot proto id>` (original markup as children). The parent's `meta.ts` holds `slots.<id>.use`; a pick on the child prototype writes it (in the dev server for page picks, in `proto pick` for the CLI). The dev server resolves pointers into `/__proto/status`, and a stable `src/slot.ts` module reads them, re-reading on `proto:edit`, so a mounted `Slot` re-renders with no reload.

**Tech Stack:** Node ESM scripts (`scripts/proto.mjs`, `app/server.mjs`), a Vite dev server, React 19 adapters in `app/adapters/`, headless-Chrome smoke checks in `.github/`.

## Global Constraints

Values copied from the spec (`docs/superpowers/specs/2026-10-13-pick-replaces-in-place-design.md`) and the repo's `CLAUDE.md`:

- A pick lands only in the variant the prototype was made from (`home/B`); other variants and other uses are untouched.
- The swap is a pointer in meta, never an edit of `home/B.tsx`. No agent round trip.
- Other options stay in the child prototype; `home/B` gets no extra control.
- React first. A Vue session's `--slot` stops and says so.
- `home/meta.ts` shape: `"slots": { "cta": { "variant": "B", "use": "button/D" } }`. Child `meta.ts`: `"from": "home/B", "slot": "cta"`.
- Pick of the variant named `Current` or `As built`, an unpick of the pick, or an archived child: the original markup renders.
- A variant that throws must not break the parent: the slot shows the original.
- Quick CI must still pass: `git ls-files -z '*.mjs' | xargs -0 -r -n1 node --check` and `node scripts/proto.mjs stack --project .`.
- Style of the code around: terse comments that say why, no em dashes in prose, no emojis. No added comments beyond that density.
- Work in this worktree (`feat/pick-replaces-in-place`). Add exact paths to commits, never `git add -A`.

## File Structure

| File | Responsibility |
|---|---|
| `app/adapters/slot.react.ts` (create) | `Slot` component and the pointer store; installed as `src/slot.ts` |
| `app/server.mjs` (modify) | `slotPointers()`, `slots` in status, `plug()` called from the page's `pick()` |
| `scripts/proto.mjs` (modify) | copy the adapter into sessions, `add --slot`, `pick` plugs, `handoff` reads slots, inbox text |
| `app/src/registry.ts`, `app/shell/shell.ts` (modify) | expose `slot`, one line in the dropdown description |
| `.github/slot-checks.mjs` (create), `.github/smoke.mjs` (modify) | browser and CLI checks |
| `SKILL.md` (modify) | when and how Claude lifts an element, the props contract |

---

### Task 1: The `Slot` runtime and pointers in status

**Files:**
- Create: `app/adapters/slot.react.ts`, `.github/slot-checks.mjs`
- Modify: `app/server.mjs` (after `hasVariant`, and `status()` near line 339), `scripts/proto.mjs` (`STACKS.react` near line 75, `scaffold` near line 266, `appFiles` near line 300), `.github/smoke.mjs` (import near line 25, call after `splitChecks` near line 173)

**Interfaces:**
- Produces: `export function slotPointers(): Record<string, string>` in `app/server.mjs`, keys `"<parent>/<slotId>"`, values `"<child>/<letter>"`. `status().slots` is that object.
- Produces: `Slot` from `src/slot.ts`: `Slot({ proto: string, id: string, children: ReactNode, ...props })`.
- Produces: `slotChecks({ proto, app, local, openPage, fail })` from `.github/slot-checks.mjs`, extended by later tasks.

- [ ] **Step 1: Write the failing check**

Create `.github/slot-checks.mjs`. This first version sets the pointer by hand in `meta.ts` (the picks come in Task 2):

```js
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
}
```

In `.github/smoke.mjs` add `import { slotChecks } from './slot-checks.mjs'` beside the other check imports and `await slotChecks({ proto, app, local, openPage, fail })` after the `splitChecks` line.

- [ ] **Step 2: Run it to verify it fails**

Run: `node .github/smoke.mjs`
Expected: FAIL, from `slots:` or the page, because `src/slot.ts` does not exist (the variant import fails).

- [ ] **Step 3: Write the adapter**

Create `app/adapters/slot.react.ts` (createElement, as `shell/sheet.ts` does, since it is a `.ts` file):

```ts
// A part of a variant that another prototype can stand in for. Wrap the element in <Slot
// proto="<this prototype>" id="<id>" …props>, its original markup as children. While the page has
// a variant plugged in (its pick, see proto add --slot), that variant is drawn here with the
// slot's props; otherwise, or when it fails, the children are.
import { Component, Fragment, Suspense, createElement as h, lazy, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'

const loaders = import.meta.glob<{ default: ComponentType<any> }>(['./protos/*/[A-Z].{tsx,jsx}', './protos/*/[A-Z][A-Z].{tsx,jsx}'])

let pointers: Record<string, string> = {}
const listeners = new Set<() => void>()
const read = async () => {
  try { pointers = (await (await fetch('/__proto/status')).json()).slots ?? {} } catch { /* the originals show */ }
  listeners.forEach(f => f())
}
// Top level await: a variant that imports this never paints the original and then swaps.
await read()
import.meta.hot?.on('proto:edit', (d: { path: string }) => { if (/\/meta\.ts$/.test(d.path)) void read() })

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }
const parts = new Map<string, ComponentType<any>>()
function partOf(use: string) {
  const [proto, letter] = use.split('/')
  const key = Object.keys(loaders).find(k => k.startsWith(`./protos/${proto}/${letter}.`))
  if (!key) return null
  if (!parts.has(key)) parts.set(key, lazy(loaders[key]))
  return parts.get(key)!
}

class Guard extends Component<{ original: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.original : this.props.children }
}

export function Slot({ proto, id, children, ...props }: { proto: string; id: string; children?: ReactNode; [prop: string]: unknown }) {
  const use = useSyncExternalStore(subscribe, () => pointers[`${proto}/${id}`] ?? '')
  const Part = use ? partOf(use) : null
  if (!Part) return h(Fragment, null, children)
  return h(Guard, { key: use, original: children }, h(Suspense, { fallback: children }, h(Part, props)))
}
```

- [ ] **Step 4: Install the adapter into sessions**

In `scripts/proto.mjs`:
- `STACKS.react`: add `slot: 'slot.react.ts'` (after `motion: 'motion.react.ts'`). Vue gets none.
- `scaffold`, after the `copy` line: `if (kit.slot) cpSync(join(APP, 'adapters', kit.slot), join(dir, 'src', 'slot.ts'))`
- `appFiles`, after the `copy` line: `if (kit.slot) out.set(join('src', 'slot.ts'), join(APP, 'adapters', kit.slot))`

- [ ] **Step 5: Resolve pointers in the dev server**

In `app/server.mjs`, after the `hasVariant` definition:

```js
// What stands in each slot: `<prototype>/<slot id>` is `<child>/<letter>` while that is the
// `use` in the prototype's meta.ts. A child that is archived, or whose file is gone, plugs
// nothing in, so the original shows.
export function slotPointers() {
  const out = {}
  let slugs = []
  try { slugs = readdirSync(join(dir, 'src', 'protos')) } catch { /* none yet */ }
  for (const slug of slugs) {
    let meta
    try { meta = metaOf(readFileSync(metaFile(slug), 'utf8')) } catch { continue }
    for (const [id, slot] of Object.entries(meta.slots || {})) {
      const [from, letter] = String(slot?.use || '').split('/')
      if (!from || !letter || !hasVariant(from, letter)) continue
      try { if (metaOf(readFileSync(metaFile(from), 'utf8')).archived) continue } catch { continue }
      out[`${slug}/${id}`] = `${from}/${letter}`
    }
  }
  return out
}
```

In `status()`, add `slots: slotPointers()` to the returned object.

- [ ] **Step 6: Run the check to verify it passes**

Run: `node .github/smoke.mjs`
Expected: the `slots:` checks pass and the rest of smoke is as before (note any failure that predates this change by running the same command on `main` first if one appears).

- [ ] **Step 7: Commit**

```bash
git add app/adapters/slot.react.ts app/server.mjs scripts/proto.mjs .github/slot-checks.mjs .github/smoke.mjs
git commit -m "Slots: a part of a variant another prototype can stand in for"
```

---

### Task 2: A pick in the page moves the pointer

**Files:**
- Modify: `app/server.mjs` (`pick()` near line 92), `.github/slot-checks.mjs`

**Interfaces:**
- Consumes: `slotPointers`, `metaOf`, `metaFile`, `withMeta`, `writeWhole` already in `app/server.mjs`.
- Produces: `plug(slug, meta, id, off)` in `app/server.mjs`; `isCurrent(name)`.

- [ ] **Step 1: Write the failing check**

Extend `slotChecks`: replace the `setUse` calls after the first `until` with real picks. Add above `try`:

```js
  const decide = async (route, action) => {
    const res = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments: [{ route, text: action === 'pick' ? `Picked ${route.split('/')[1]}` : 'Took the pick back', action }] }) })
    assert(res.ok, `${action} ${route} answered ${res.status}`)
  }
```

and a second `try` block after the first (before `page.close()` is fine, inside the same `try`), once the child has `slot` (Task 3 adds it; for this task write the child meta by hand too):

```js
    const child = metaOf('slotbtn')
    child.from = 'slothome/B'
    child.slot = 'cta'
    writeFileSync(metaFile('slotbtn'), `export default ${JSON.stringify(child, null, 2)}\n`)
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node .github/smoke.mjs`
Expected: FAIL with `slots: picking B plugs it into slothome/B: the page shows "…Original button…"`.

- [ ] **Step 3: Implement `plug` and call it**

In `app/server.mjs`, before `pick()`:

```js
// A prototype made to stand in for part of another (`slot` in its meta.ts, `from` naming the
// parent) plugs its pick in there at once: the pick is the slot's `use`. The variant called
// Current (or As built) is the original, and so is no pick, so those clear it. Undoing a pick
// clears it only while it is that variant.
const isCurrent = name => /^(current|as built)$/i.test(String(name || '').trim())
function plug(slug, meta, id, off) {
  if (!meta.slot || typeof meta.from !== 'string') return
  const parent = meta.from.split('/')[0]
  let text, pm
  try { text = readFileSync(metaFile(parent), 'utf8'); pm = metaOf(text) } catch { return }
  const slot = pm.slots?.[meta.slot]
  if (!slot) return
  const use = `${slug}/${id}`
  if (off && slot.use !== use) return
  const next = off || isCurrent(meta.variants?.[id]) ? '' : use
  if ((slot.use || '') === next) return
  const { use: _, ...rest } = slot
  pm.slots[meta.slot] = next ? { ...rest, use: next } : rest
  writeWhole(metaFile(parent), withMeta(text, pm))
}
```

In `pick()`, directly after `writeWhole(metaFile(slug), withMeta(text, meta))`: `plug(slug, meta, id, off)`.

- [ ] **Step 4: Run the check to verify it passes**

Run: `node .github/smoke.mjs`
Expected: `slots:` checks pass.

- [ ] **Step 5: Commit**

```bash
git add app/server.mjs .github/slot-checks.mjs
git commit -m "Slots: a pick in the page plugs the variant into its parent, and undoing it puts the original back"
```

---

### Task 3: `proto add --slot` and `proto pick` plug in

**Files:**
- Modify: `scripts/proto.mjs` (`add()` after the `--from` block near line 429-450, end of `add()` near line 489, `pick()` near line 601), `.github/slot-checks.mjs`

**Interfaces:**
- Consumes: `readMeta(dir, slug)`, `writeWhole(f, text, scratch)`, `withMeta(text, meta)`, `scratchOf(dir)`, `STACKS`, `die`, `flags`, `args` already in `scripts/proto.mjs`.
- Produces: `plug(dir, slug, meta, id, off)` in `scripts/proto.mjs`, returns `''` or `"<from> (<slot>)"` when it changed the pointer.

- [ ] **Step 1: Write the failing check**

In `slotChecks`, replace the hand-written setup of the child with the CLI (the meta edits in Tasks 1 and 2 go away). Order: write `slothome/B.tsx` first, then:

```js
  proto(['add', 'slotbtn', '--from', 'slothome/A', '--slot', 'cta', '--variants', 'A:Current'], { ok: false })
  proto(['add', 'slotbtn', '--from', 'slothome', '--slot', 'cta', '--variants', 'A:Current'], { ok: false })
  proto(['add', 'slotbtn', '--title', 'Button', '--from', 'slothome/B', '--slot', 'cta', '--variants', 'A:Current,B:Rounded,C:Broken'])
  assert(metaOf('slothome').slots?.cta?.variant === 'B', 'add --slot did not record the slot in the parent')
  assert(metaOf('slotbtn').slot === 'cta' && metaOf('slotbtn').from === 'slothome/B', 'add --slot did not record the slot in the child')
```

(the first refused call: A has no `<Slot>`; second: no letter.) Drop the `meta.slots = …` write and the `child.from/slot` write. After the page checks, before `page.close()`:

```js
    proto(['pick', 'slotbtn', 'B'])
    await until('Rounded Go', 'proto pick plugs the variant in')
    proto(['pick', 'slotbtn', '--off'])
    await until('Original button', 'proto pick --off puts the original back')
    assert(!metaOf('slothome').slots.cta.use, 'proto pick --off left a pointer')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node .github/smoke.mjs`
Expected: FAIL: `proto add … --slot` is an unknown flag or the parent has no `slots`.

- [ ] **Step 3: `--slot` in `add()`**

After the `--from` block (before `const list = String(flags.variants …)`):

```js
  // A prototype made to stand in for one element of a variant: that variant must already hold the
  // element in a <Slot>, so the page has something to plug the pick into.
  let slotIn = null
  if (flags.slot !== undefined) {
    if (!STACKS[s.stack].slot) die('--slot needs the React stack for now')
    if (flags.slot === true || !/^[a-z][a-z0-9-]*$/.test(flags.slot)) die('--slot takes the slot\'s id, like cta')
    const [parent, letter = ''] = String(flags.from === undefined || flags.from === true ? '' : flags.from).split(',')[0].trim().split('/')
    if (!parent || !letter) die('--slot needs --from <slug>/<letter>: the variant that holds the slot')
    const file = ['tsx', 'jsx'].map(x => join(dir, 'src', 'protos', parent, `${letter}.${x}`)).find(f => existsSync(f))
    const tag = `<Slot proto="${parent}" id="${flags.slot}"`
    if (!file || !readFileSync(file, 'utf8').includes(tag)) die(`${parent}/${letter} has no ${tag} …>: wrap the element in it first (SKILL.md, "Plug a variant into what it was made from")`)
    set.slot = flags.slot
    slotIn = { parent, letter, id: flags.slot }
  }
```

At the end of `add()`, right after the `writeWhole(metaFile, …)` call:

```js
  if (slotIn) {
    const pf = join(dir, 'src', 'protos', slotIn.parent, 'meta.ts')
    const ptext = readFileSync(pf, 'utf8'), pm = JSON.parse(ptext.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
    pm.slots = { ...pm.slots, [slotIn.id]: { ...pm.slots?.[slotIn.id], variant: slotIn.letter } }
    writeWhole(pf, withMeta(ptext, pm), scratchOf(dir))
  }
```

- [ ] **Step 4: `plug` in the CLI pick**

Before `pick()` in `scripts/proto.mjs`:

```js
// The same rule as the page's pick (app/server.mjs plug): a prototype with a slot plugs its pick
// into the prototype it was made from; the variant called Current, or no pick, is the original.
// Says where it changed, or '' when nothing did.
const isCurrent = name => /^(current|as built)$/i.test(String(name || '').trim())
function plug(dir, slug, meta, id, off) {
  if (!meta.slot || typeof meta.from !== 'string' || !id) return ''
  const parent = meta.from.split('/')[0]
  const f = join(dir, 'src', 'protos', parent, 'meta.ts')
  if (!existsSync(f)) return ''
  const text = readFileSync(f, 'utf8'), pm = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  const slot = pm.slots?.[meta.slot]
  if (!slot) return ''
  const use = `${slug}/${id}`
  if (off && slot.use !== use) return ''
  const next = off || isCurrent(meta.variants?.[id]) ? '' : use
  if ((slot.use || '') === next) return ''
  const { use: _, ...rest } = slot
  pm.slots[meta.slot] = next ? { ...rest, use: next } : rest
  writeWhole(f, withMeta(text, pm), scratchOf(dir))
  return `${meta.from} (${meta.slot})`
}
```

In `pick()`: before the `if (flags.off)` line add `const was = meta.picked`; after `writeWhole(metaFile, withMeta(text, meta), scratchOf(dir))` add `const plugged = plug(dir, slug, meta, flags.off ? was : id, !!flags.off)`; change the final `console.log` to:

```js
  console.log((flags.off ? `${slug}: no pick` : `${slug}: picked ${id} · ${meta.variants[id]}`) + (plugged ? ` · ${isCurrent(meta.variants?.[flags.off ? was : id]) || flags.off ? 'original back in' : 'plugged into'} ${plugged}` : ''))
```

- [ ] **Step 5: Run the check to verify it passes**

Run: `node .github/smoke.mjs`
Expected: `slots:` checks pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/proto.mjs .github/slot-checks.mjs
git commit -m "Slots: proto add --slot, and proto pick plugs the pick into its parent"
```

---

### Task 4: Handoff and inbox know about slots

**Files:**
- Modify: `scripts/proto.mjs` (`handoff()` near line 1194, `ACTIONS.pick` near line 1347), `.github/slot-checks.mjs`

**Interfaces:**
- Consumes: `variantFiles(protos, first)` returning `[{ file, by? }]`, `readMeta`, `STACKS`, `rel`, `section` already in `handoff()`.

- [ ] **Step 1: Write the failing check**

In `slotChecks`, inside the `try`, after the `proto pick --off` assertions:

```js
    proto(['pick', 'slotbtn', 'B'])
    const handoff = proto(['handoff', 'slothome/B'], { stdout: true })
    assert(handoff.includes('## Slots') && handoff.includes('cta') && handoff.includes('slotbtn/B'), 'handoff does not name the slot and what is plugged in')
    assert(handoff.includes('slotbtn/B.tsx'), 'handoff does not list the plugged-in variant\'s file')
    proto(['pick', 'slotbtn', '--off'])
    assert(!proto(['handoff', 'slothome/B'], { stdout: true }).includes('## Slots'), 'handoff names a slot with nothing plugged in')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node .github/smoke.mjs`
Expected: FAIL `slots: handoff does not name the slot and what is plugged in`.

- [ ] **Step 3: Read slots in `handoff()`**

Right after `const files = variantFiles(join(dir, 'src', 'protos'), file)` and the `rel` helper, insert:

```js
  // A <Slot> in a file stands for the variant the page has plugged in: that is what the build is of,
  // so its files join the list (nested slots too, as the list grows).
  const fileOf = (proto, letter) => [STACKS[s.stack]?.ext, 'tsx', 'jsx', 'vue'].filter(Boolean).map(x => join(dir, 'src', 'protos', proto, `${letter}.${x}`)).find(f => existsSync(f))
  const slots = []
  for (let i = 0; i < files.length; i++) {
    for (const m of readFileSync(files[i].file, 'utf8').matchAll(/<Slot\s+proto="([^"]+)"\s+id="([^"]+)"/g)) {
      const use = readMeta(dir, m[1])?.slots?.[m[2]]?.use
      const [from, letter] = String(use || '').split('/')
      const f = from && letter && fileOf(from, letter)
      if (!f || slots.some(x => x.proto === m[1] && x.id === m[2])) continue
      slots.push({ proto: m[1], id: m[2], use, file: f, in: files[i].file })
      for (const x of variantFiles(join(dir, 'src', 'protos'), f)) {
        if (!files.some(y => y.file === x.file)) files.push({ ...x, by: x.by || files[i].file, ...(x.by ? {} : { via: `${m[1]}/${m[2]}` }) })
      }
    }
  }
```

Change the `Files` section line to name how a slot's file got in:

```js
  section('Files', files.map(x => `${x.file}${x.via ? ` (plugged into ${rel(x.by)} by slot ${x.via})` : x.by ? ` (imported by ${rel(x.by)})` : ''}`))
  section('Slots', slots.map(x => `${x.id} in ${rel(x.in)} is ${x.use} (${rel(x.file)}), not the markup written there: build the plugged-in design in its place`))
```

(`rel` is defined above the `Files` section; keep the insert after it, before the loop over `files` that collects findings, so the plugged-in files' copy and motion are found too.)

- [ ] **Step 4: Tell the agent a pick is already plugged in**

In `ACTIONS`, change `pick` to:

```js
  pick: 'done: marked in the page and now the working variant (on a prototype made to stand in for part of another, it is already plugged in there); a reply is only a note',
```

- [ ] **Step 5: Run the check to verify it passes**

Run: `node .github/smoke.mjs`
Expected: `slots:` checks pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/proto.mjs .github/slot-checks.mjs
git commit -m "Slots: handoff builds the plugged-in design, and the inbox says a pick is already plugged in"
```

---

### Task 5: The dropdown says where a prototype plugs in

**Files:**
- Modify: `app/src/registry.ts` (`Meta` type line 5, returned object line 32), `app/shell/shell.ts` (`Proto` type line 35, `miller()` line ~970)

**Interfaces:**
- Consumes: `parentOf(p: Proto): Proto | undefined`, `esc`, `pickOf`, in `app/shell/shell.ts`.
- Produces: `Proto.slot?: string`.

- [ ] **Step 1: Thread `slot` through**

`app/src/registry.ts`: add `slot?: string` to `Meta` and `slot: typeof meta.slot === 'string' ? meta.slot : undefined` to the object returned for a prototype. `app/shell/shell.ts`: add `slot?: string` to the `Proto` type.

- [ ] **Step 2: Add the line**

In `miller()`, the `<p class="mt-2 text-[11px] text-zinc-400">` array (the one starting `q && q.id === pickOf(p) ? 'Picked'`), add a last item before `.filter(Boolean)`:

```ts
p.slot && parentOf(p) && p.from ? `Plugs into ${esc(parentOf(p)!.title)} ${esc(p.from.variant)}` : ''
```

- [ ] **Step 3: Check it renders**

Run: `node scripts/proto.mjs up --project <a scratch project>`, add a slotted pair as in `slot-checks.mjs`, open the switcher and read the panel. Expected: "Plugs into Slot home B" on any variant of `slotbtn`, nothing on `slothome`. Also run `node .github/smoke.mjs`; expected: unchanged.

- [ ] **Step 4: Commit**

```bash
git add app/src/registry.ts app/shell/shell.ts
git commit -m "The switcher says which variant a slotted prototype plugs into"
```

---

### Task 6: SKILL.md, so Claude lifts the element and writes drop-ins

**Files:**
- Modify: `SKILL.md` (section 4, after the paragraph on `--from-picks` near line 296; the follow-up table near line 650; the comment-action table near line 629)

- [ ] **Step 1: Add the section**

After the `--from-picks` paragraph in section 4:

```markdown
**Plug a variant into what it was made from.** When the user points at one element of a variant
and asks for variants of it ("five more of this button"), the picked variant should replace that
element where it came from. Before `proto add`, lift that one use out of its variant into a slot,
its markup left inside as the default, and pass the props it needs:

    <Slot proto="home" id="cta" label="Continue" onClick={next}><button …>Continue</button></Slot>

(`import { Slot } from '../../slot'`; `id` is a short lowercase word; keep `proto` then `id` in
that order, the tools read it that way.) Then:

    proto add button --from home/B --slot cta --variants "A:Current,B:…,C:…"

A is the lifted markup, matched to the original as Current always is. Every other variant is a
drop-in: it reads the props the slot passes, each with a default so it also renders alone on its
artboard. The user's pick of any of them plugs it into `home/B` at once; picking Current, or
taking the pick back, puts the original back. Nothing in `home/B.tsx` changes for that, and
nothing is left for you to do on a pick. One written use is one slot: a slot inside a loop swaps
every item of that loop; another variant, or another use of a shared component, is untouched.
A prototype made without a slot picks as before. `proto handoff home/B` builds the plugged-in
design.
```

- [ ] **Step 2: Add the table rows**

In the follow-up table: `| "More of this button" / variants of one element | lift it into a <Slot>, then proto add <new slug> --from <slug>/<letter> --slot <id> … |`. In the comment-action table's `pick` row, append: `; when the prototype has a slot the variant is already plugged into its parent`.

- [ ] **Step 3: Check line count did not blow the budget**

Run: `wc -l SKILL.md`
Expected: about 730 lines or fewer (704 before this; trim wording if it grows more).

- [ ] **Step 4: Commit**

```bash
git add SKILL.md
git commit -m "SKILL.md: lift a pointed element into a slot, and write the variants as drop-ins"
```

---

### Task 7: Verify, then the PR (only when asked)

- [ ] **Step 1: Quick CI locally**

Run: `git ls-files -z '*.mjs' | xargs -0 -r -n1 node --check && node scripts/proto.mjs stack --project .`
Expected: no output from `--check`, a stack line from `stack`.

- [ ] **Step 2: Full browser suite**

Run: `node .github/smoke.mjs`
Expected: exits 0, `slots:` checks included. Report separately from the quick CI, as the PR template asks.

- [ ] **Step 3: By hand, once**

Start a session, make `home/B` with a button in a `<Slot>`, `proto add button --from home/B --slot cta` with three variants, open `#/home/B`, then pick B from the page's Actions menu (P) in a second tab. Expected: `home/B` changes in the first tab with no reload; "Picked B" undoes it.

- [ ] **Step 4: PR, when the user asks for one**

The repo's `CLAUDE.md` applies: use the PR template; the only visible change is the one line in the switcher panel (Task 5), so capture before and after of that panel (desktop, light), publish them under `docs/pr/pick-replaces-in-place/`, pin the URLs to the commit SHA, and read the body back with `gh pr view --json body`. Everything else is `N/A: no visual changes`. Do not open the PR before then.
