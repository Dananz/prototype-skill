// A variant's states by keyboard: up and down walk them from anywhere on the variant and wrap, the
// list keeps the state showing in sight, the focus walks along on a state's row with Home and End
// reaching the ends, and fields, a design's own arrows and a variant without states keep theirs.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function stateKeysChecks({ proto, app, local, openPage, fail, keepShots = '' }) {
  const assert = (ok, why) => { if (!ok) fail(`state keys: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (f, why) => { for (const end = Date.now() + 5000; Date.now() < end; await wait(50)) { const v = await f(); if (v) return v } fail(`state keys: ${why}`) }
  proto(['add', 'walk', '--title', 'Walk', '--variants', 'A:With states,B:Own arrows'])
  proto(['add', 'plain', '--title', 'Plain', '--variants', 'A:No states'])
  const ids = Array.from({ length: 17 }, (_, i) => `s${i + 1}`)
  const metaPath = join(app, 'src/protos/walk/meta.ts'), src = readFileSync(metaPath, 'utf8')
  const at = src.indexOf('export default') + 'export default'.length
  writeFileSync(metaPath, src.slice(0, at) + ' ' + JSON.stringify({ ...JSON.parse(src.slice(at)), states: ids.map((id, i) => ({ id, name: `${i + 1}. State ${id}`, click: [] })) }, null, 2) + '\n')
  writeFileSync(join(app, 'src/protos/walk/A.tsx'), `export default function A() { return <main className="p-8"><h1>A</h1><input aria-label="field" /></main> }`)
  writeFileSync(join(app, 'src/protos/walk/B.tsx'), `export default function B() { return <main className="p-8"><h1>B</h1><div role="listbox" tabIndex={0} aria-label="own">x</div><div role="radiogroup" aria-label="group"><button role="radio" aria-checked="true">r</button></div></main> }`)
  writeFileSync(join(app, 'src/protos/plain/A.tsx'), `export default function A() { return <main className="p-8" style={{ height: 3000 }}><h1>plain</h1></main> }`)
  proto(['done', 'walk', 'plain'])

  const page = await openPage(`${local}walk/A?theme=dark&tree=1`)
  try {
    const path = () => page.run('location.pathname')
    const lit = () => page.run(`document.querySelector('[data-tree-dock-list] [aria-current="true"]')?.textContent ?? ''`)
    const reach = async (want, why) => { for (const end = Date.now() + 3000; Date.now() < end; await wait(50)) if ((await path()).endsWith(want)) return; fail(`state keys: ${why}: wanted ${want}, at ${await path()}, focus on ${await page.run(`document.activeElement?.outerHTML.slice(0, 120)`)}`) }
    await until(() => page.run(`!!document.querySelector('[data-tree-dock-list] [data-act^="pvs:"]')`), 'the state list did not draw')
    await page.run(`document.activeElement?.blur()`)

    // From the page: down, then up back to At rest, then up wraps to the last.
    await page.key('ArrowDown')
    await reach('walk/A/s1', 'down from At rest')
    await until(async () => (await lit()).includes('State s1'), 'the list did not light the first state')
    await page.key('ArrowUp')
    await until(async () => !(await path()).includes('/s'), 'up did not return to At rest')
    await page.key('ArrowUp')
    await reach('walk/A/s17', 'up from At rest should wrap to the last')
    await until(() => page.run(`(() => { const box = document.querySelector('[data-tree-dock-list]').getBoundingClientRect(), r = document.querySelector('[data-tree-dock-list] [aria-current="true"]').getBoundingClientRect(); return r.top >= box.top - 1 && r.bottom <= box.bottom + 1 })()`), 'the last state is not in sight in the list')
    if (keepShots) await page.screenshot(join(keepShots, 'state-keys-last.png'))
    await page.key('ArrowDown')
    await until(async () => !(await path()).includes('/s'), 'down from the last should wrap to At rest')

    // Home and End off a row do nothing.
    await page.key('End')
    await wait(150)
    assert(!(await path()).includes('/s'), 'End moved the state with the focus away from the list')

    // On a row: the focus walks with the state, Home and End reach the ends.
    await page.run(`document.querySelector('[data-tree-dock-list] [data-act^="pvs:"]').focus()`)
    const focused = () => page.run(`document.activeElement?.dataset?.act ?? document.activeElement?.tagName`)
    await page.key('ArrowDown')
    await until(async () => (await focused()) === 'pvs:walk:A:s1', 'the focus did not walk down with the state')
    await page.key('End')
    await reach('walk/A/s17', 'End on a row')
    await until(async () => (await focused()) === 'pvs:walk:A:s17', 'the focus did not follow End')
    await page.key('Home')
    await until(async () => (await focused()) === 'pvs:walk:A:', 'the focus did not follow Home')
    assert(!(await path()).includes('/s'), 'Home did not return to At rest')

    // Several presses in a row land on the right state with the focus on it.
    for (let i = 0; i < 5; i++) await page.key('ArrowDown')
    await reach('walk/A/s5', 'five quick presses')
    await until(async () => (await focused()) === 'pvs:walk:A:s5', 'the focus did not land after quick presses')

    // A field keeps its arrows.
    await page.run(`document.querySelector('[data-mount] input, input[aria-label="field"]').focus()`)
    await page.key('ArrowDown')
    await wait(150)
    assert((await path()).endsWith('walk/A/s5'), 'an arrow in a field changed the state')
    await page.run(`document.activeElement?.blur()`)

    // A control with arrows of its own keeps them.
    await page.key('ArrowRight')
    await reach('walk/B/s5', 'right keeps the state on the next variant')
    await until(() => page.run(`!!document.querySelector('[role="radio"]')`), 'variant B did not draw')
    for (const sel of ['[role="listbox"]', '[role="radio"]']) {
      await page.run(`document.querySelector('${sel}').focus()`)
      await page.key('ArrowDown')
      await wait(150)
      assert((await path()).endsWith('walk/B/s5'), `an arrow on ${sel} changed the state`)
    }
  } finally { page.close() }

  // Without states, the arrows do what the browser does.
  const flat = await openPage(`${local}plain/A?theme=dark`)
  try {
    await until(() => flat.run(`!!document.querySelector('h1')`), 'the plain variant did not draw')
    const out = await flat.run(`new Promise(res => { addEventListener('keydown', e => setTimeout(() => res(e.defaultPrevented)), { once: true }) ; dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })) })`)
    assert(out === false, 'a variant without states took the arrow')
  } finally { flat.close() }
}
