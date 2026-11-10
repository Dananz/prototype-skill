import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const code = stripTypeScriptTypes(readFileSync(new URL('../app/shell/comments/dom.ts', import.meta.url), 'utf8'))
const { seen } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const doc = { defaultView: { getComputedStyle: el => el.css } }
globalThis.document = doc
const element = (x, y, w, h, parentElement = null, overflow = 'visible') => ({
  parentElement, ownerDocument: doc, clientWidth: w, clientHeight: h,
  css: { overflowX: overflow, overflowY: overflow },
  getBoundingClientRect: () => ({ left: x, top: y, width: w, height: h }),
})
const host = element(0, 0, 200, 600)
const stage = element(0, 0, 260, 600, null, 'hidden')
const mount = element(20, 0, 320, 600, stage)
const target = element(25, 100, 300, 48, mount)
assert.deepEqual(seen(target, mount, host), { x: 25, y: 100, w: 300, h: 48 }, 'a partially visible element keeps its full outline across shell edges')
const scroller = element(25, 80, 180, 120, mount, 'hidden')
target.parentElement = scroller
assert.deepEqual(seen(target, mount, host), { x: 25, y: 100, w: 180, h: 48 }, 'the design own clipping still bounds the outline')
const leftEdge = element(-40, 100, 140, 48, mount)
assert.deepEqual(seen(leftEdge, mount, host), { x: -40, y: 100, w: 140, h: 48 }, 'the left shell edge also preserves the element dimensions')
const offscreen = element(25, 700, 300, 48, mount)
assert.equal(seen(offscreen, mount, host), null, 'fully offscreen elements have no outline or pin')
console.log('Comment edge geometry checks passed')
