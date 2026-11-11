import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pruneShellFonts } from '../app/share/fonts.mjs'

const face = (name, range, family = 'Google Sans Variable') => `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${name});${range ? `unicode-range:${range};` : ''}}`
const css = [face('latin', 'U+0000-00FF'), face('hebrew', 'U+0590-05FF'), face('greek', 'U+0370-03FF'), face('japanese', 'U+3000-30FF'), face('symbols', 'U+1F300-1F5FF')].join('')

test('shares retain Latin and the Unicode subsets their published text uses', () => {
  const out = pruneShellFonts(css, 'שלום, hello')
  assert.match(out, /base64,latin/)
  assert.match(out, /base64,hebrew/)
  assert.doesNotMatch(out, /base64,(greek|japanese|symbols)/)
})

test('escaped bundle text and supplementary characters retain their subsets', () => {
  const out = pruneShellFonts(css, String.raw`\u03b1 \u{3042} ` + String.fromCodePoint(0x1f30d))
  for (const name of ['latin', 'greek', 'japanese', 'symbols']) assert.ok(out.includes(`base64,${name}`), name)
})

test('CSS content escapes retain the font used by generated text', () => {
  const input = css + String.raw`.label::before{content:"\3b1"}.other::after{content:"\3042 "}`
  const out = pruneShellFonts(input, input)
  assert.match(out, /base64,greek/)
  assert.match(out, /base64,japanese/)
})

test('wildcards and any range of a font face can cover a published character', () => {
  const input = face('wildcard', 'U+4??') + face('multi', 'U+0100-017F,U+3040-309F')
  assert.equal(pruneShellFonts(input, 'Жあ'), input)
})

test('unknown ranges and other font families are preserved', () => {
  const input = face('other', 'U+3000-30FF', 'Product Font') + face('unknown', 'broken') + face('no-range', '')
  assert.equal(pruneShellFonts(input, ''), input)
})

test('non-font CSS is preserved while unused shell faces are removed', () => {
  const input = `.demo{content:'@font-face';color:red}${face('greek', 'U+0370-03FF')}`
  assert.equal(pruneShellFonts(input, 'hello'), ".demo{content:'@font-face';color:red}")
})
