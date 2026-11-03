import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

test('picks accept file-based variants with about metadata and reject missing variants', async () => {
  const root = mkdtempSync(join(tmpdir(), 'proto-pick-files-'))
  try {
    for (const name of ['server', 'compress', 'assignment', 'listener', 'history', 'brief', 'numbers']) {
      copyFileSync(new URL(`../app/${name}.mjs`, import.meta.url), join(root, `${name}.mjs`))
    }
    const proto = join(root, 'src/protos/signup')
    mkdirSync(proto, { recursive: true })
    writeFileSync(join(proto, 'meta.ts'), 'export default { "about": { "D": "Sentence signup" } };\n')
    writeFileSync(join(proto, 'D.tsx'), 'export default function Page() { return null }\n')
    const { receive } = await import(pathToFileURL(join(root, 'server.mjs')))
    const check = (action, variant) => receive({ comments: [{ route: `signup/${variant}`, text: 'Pick', action }] }, root, { check: true })
    for (const action of ['pick', 'unpick']) {
      assert.doesNotThrow(() => check(action, 'D'))
      assert.throws(() => check(action, 'E'), /signup has no variant E/)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
