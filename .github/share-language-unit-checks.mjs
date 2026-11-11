import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'

const source = stripTypeScriptTypes(readFileSync(new URL('../app/shell/i18n.ts', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '').replace(/^if \(import\.meta\.hot\).*$/gm, '').replace(/export /g, '')
function load({ share = true, languages = ['en-US'], sessionLanguage = 'he', stored = {}, query = '', blocked = false } = {}) {
  const values = new Map(Object.entries(stored)), document = { documentElement: {} }
  const location = { href: `https://example.test/s/abc/?${query}#details`, reloads: 0, reload() { this.reloads++ }, assign(url) { this.assigned = String(url) } }
  const localStorage = { getItem: k => { if (blocked) throw Error('blocked'); return values.get(k) ?? null }, setItem: (k, v) => { if (blocked) throw Error('blocked'); values.set(k, v) }, removeItem: k => { if (blocked) throw Error('blocked'); values.delete(k) } }
  const result = new Function('session', 'he', 'pageQuery', 'SHARE', 'navigator', 'document', 'localStorage', 'location', `${source}; return { lang, langChoice, setLangChoice, followSession }`)(
    { lang: sessionLanguage }, {}, `?${query}`, share, { languages, language: languages[0] }, document, localStorage, location)
  return { ...result, document, location, values }
}
test('a shared page follows the browser, independently of its author and owner preference', () => {
  assert.equal(load({ stored: { 'proto-lang': 'he' } }).lang, 'en')
  assert.equal(load({ languages: ['he-IL'], sessionLanguage: 'en' }).lang, 'he')
  assert.equal(load({ languages: ['iw-IL'] }).lang, 'he')
  assert.equal(load({ languages: ['fr-FR', 'he-IL'] }).lang, 'he')
  assert.equal(load({ languages: ['fr-FR'] }).lang, 'en')
})
test('viewer preferences and URL overrides take precedence over browser language', () => {
  assert.equal(load({ stored: { 'proto-viewer-lang': 'he' } }).lang, 'he')
  assert.equal(load({ stored: { 'proto-viewer-lang': 'he' }, query: 'lang=en' }).lang, 'en')
  assert.equal(load({ stored: { 'proto-viewer-lang': 'bad' } }).lang, 'en')
  const he = load({ languages: ['he-IL'] })
  assert.deepEqual(he.document.documentElement, { lang: 'he', dir: 'rtl' })
})
test('changing viewer language overrides a URL language and preserves URL state', () => {
  const v = load({ query: 'lang=he&theme=dark' })
  v.setLangChoice('en')
  const url = new URL(v.location.assigned)
  assert.equal(url.searchParams.get('lang'), 'en')
  assert.equal(url.searchParams.get('theme'), 'dark')
  assert.equal(url.hash, '#details')
  assert.equal(v.values.get('proto-viewer-lang'), 'en')
  assert.equal(v.values.has('proto-lang'), false)
})
test('browser auto can be restored and language selection works without storage', () => {
  const v = load({ query: 'lang=he', stored: { 'proto-viewer-lang': 'he' } })
  v.setLangChoice('auto')
  assert.equal(new URL(v.location.assigned).searchParams.has('lang'), false)
  assert.equal(v.values.has('proto-viewer-lang'), false)
  const privatePage = load({ blocked: true })
  privatePage.setLangChoice('he')
  assert.equal(new URL(privatePage.location.assigned).searchParams.get('lang'), 'he')
})
test('author language changes never reload a shared viewer', () => {
  const v = load()
  v.followSession({ lang: 'he' })
  assert.equal(v.location.reloads, 0)
})
test('the author shell still follows its session and its own saved preference', () => {
  assert.equal(load({ share: false }).lang, 'he')
  assert.equal(load({ share: false, stored: { 'proto-lang': 'en', 'proto-viewer-lang': 'he' } }).lang, 'en')
  const v = load({ share: false })
  v.followSession({ lang: 'en' })
  assert.equal(v.location.reloads, 1)
})
