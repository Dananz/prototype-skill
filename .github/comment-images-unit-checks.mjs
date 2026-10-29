import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const source = readFileSync(new URL('../app/shell/comments/types.ts', import.meta.url), 'utf8')
const code = stripTypeScriptTypes(source)
const { noteSays } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
assert.equal(noteSays({ body: [], tags: [], shots: [{ src: 'data:image/png;base64,eA==', pasted: true }] }), true, 'image-only notes must be sendable')
assert.equal(noteSays({ body: ['   '], tags: [] }), false)
assert.equal(noteSays({ body: ['hello'], tags: [] }), true)
assert.equal(noteSays({ body: [{ tag: 0 }], tags: [] }), true)
assert.equal(noteSays({ body: [], tags: [], shots: [] }), false)
console.log('Comment image checks passed')
