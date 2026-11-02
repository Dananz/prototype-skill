// The dev plugin that imports each Phosphor icon from its own file (app/icons.mjs).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { iconFiles, splitImports } from '../app/icons.mjs'

const index = `import { Acorn as t, AcornIcon as n } from "./csr/Acorn.es.js";
import { Star as s, StarIcon as i, ActivityIcon as a } from "./csr/Star.es.js";
import * as o from "./ssr/index.es.js";`
const files = iconFiles(index, '/dist')

test('each name maps to the file it comes from', () => {
  assert.equal(files.get('Acorn'), '/dist/csr/Acorn.es.js')
  assert.equal(files.get('ActivityIcon'), '/dist/csr/Star.es.js')
  assert.equal(files.get('IconContext'), '/dist/lib/context.es.js')
})

test('names are split by file, keep their aliases, and lose type-only imports', () => {
  const out = splitImports(`import { Star as S, Acorn, StarIcon, type Icon } from '@phosphor-icons/react'\nconst x = 1`, files)
  assert.match(out, /import \{ Star as S, StarIcon \} from "\/dist\/csr\/Star\.es\.js";/)
  assert.match(out, /import \{ Acorn \} from "\/dist\/csr\/Acorn\.es\.js";/)
  assert.ok(!out.includes('@phosphor-icons/react'))
  assert.ok(!/type Icon/.test(out))
  assert.ok(out.endsWith('const x = 1'))
})

test('a name not found stays on the package, and other imports are left alone', () => {
  assert.match(splitImports(`import { SSR, Star } from "@phosphor-icons/react"`, files), /import \{ SSR \} from '@phosphor-icons\/react';/)
  assert.equal(splitImports(`import * as P from '@phosphor-icons/react'`, files), null)
  assert.equal(splitImports(`import { Star } from 'other'`, files), null)
})
