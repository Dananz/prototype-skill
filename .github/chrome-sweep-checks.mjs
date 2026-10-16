// What the start-of-run sweep in scripts/chrome.mjs deletes from the temp folder, and what it must leave:
// fresh things, other programs' files, links, and above all a profile a browser still has open, however
// old its folder looks. Runs on a fake temp folder; the live-browser check starts a real headless Chrome
// when one is installed. Run with node --test .github/chrome-sweep-checks.mjs.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { inUse, startChrome, stopChrome, sweepProfiles } from '../scripts/chrome.mjs'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
const old = new Date(Date.now() - 3 * 86_400_000)
const GUID = n => `${String(n).repeat(8)}-1234-1234-1234-123456789abc.tmp`
function fakeTemp(fn) {
  const root = mkdtempSync(join(tmpdir(), 'proto sweep checks '))
  const dir = (name, files = [], age = old) => {
    const p = join(root, name)
    mkdirSync(p, { recursive: true })
    for (const f of files) f.endsWith('/') ? mkdirSync(join(p, f), { recursive: true }) : writeFileSync(join(p, f), 'x')
    utimesSync(p, age, age)
    return p
  }
  const file = (name, body, age = old) => { const p = join(root, name); writeFileSync(p, body); utimesSync(p, age, age); return p }
  try { fn({ root, dir, file }) } finally { rmSync(root, { recursive: true, force: true }) }
}
const gone = (paths, root) => paths.filter(p => existsSync(p)).map(p => `${p} stayed; temp holds ${readdirSync(root).join(', ')}`)
const kept = paths => paths.filter(p => !existsSync(p)).map(p => `${p} was deleted`)

test('Windows: Chrome-shaped leftovers older than a day go; fresh, foreign, half-shaped and linked ones stay', () => fakeTemp(({ root, dir, file }) => {
  const stale = [
    dir('proto-shoot-abc', ['DevToolsActivePort']),
    dir('somebody-elses-profile', ['Local State', 'Default/']),
    dir('crashed', ['Crashpad/']),
    dir('scoped_dir1234_5678'),
    dir('chrome_chrome_Unpacker_BeginUnzipping1'),
    dir('playwright_chromiumdev_profile-xyz'),
    dir('proto-snap-free', ['lockfile', 'Default/']), // a lockfile no browser holds
    file(GUID(1), 'Cr24 a CRX package'),
  ]
  const stay = [
    dir('proto-shoot-fresh', ['DevToolsActivePort'], new Date()),
    dir('a-project', ['notes.txt']),
    dir('half', ['Local State']),
    dir('claude', ['DevToolsActivePort']),
    file(GUID(2), 'MZ not a CRX'),
    file(GUID(3), 'Cr24 but fresh', new Date()),
  ]
  sweepProfiles({ root, platform: 'win32', budget: 10_000 })
  assert.deepEqual([...gone(stale, root), ...kept(stay)], [])
  assert.deepEqual(readdirSync(root).filter(n => n.includes('.sweep-')), [], 'a renamed folder was left behind')
}))

test('elsewhere: only the skill\'s own stale profiles go, never other programs\' Chrome leftovers', () => fakeTemp(({ root, dir, file }) => {
  const stale = [dir('proto-compare-abc', ['Default/']), dir('panel-verify-1', ['Local State'])]
  const stay = [
    dir('somebody-elses-profile', ['Local State', 'Default/', 'DevToolsActivePort']),
    dir('scoped_dir1234_5678'),
    dir('playwright_chromiumdev_profile-xyz'),
    file(GUID(1), 'Cr24 a CRX package'),
  ]
  sweepProfiles({ root, platform: 'linux', budget: 10_000 })
  assert.deepEqual([...gone(stale, root), ...kept(stay)], [])
}))

test('a link at the top of temp is never entered, and its target stays', t => fakeTemp(({ root }) => {
  const outside = mkdtempSync(join(tmpdir(), 'proto sweep link target '))
  try {
    writeFileSync(join(outside, 'DevToolsActivePort'), 'x')
    const link = join(root, 'proto-shoot-link')
    try { symlinkSync(outside, link, 'junction') } catch { return t.skip('no rights to make a link here') }
    utimesSync(link, old, old)
    sweepProfiles({ root, platform: 'win32', budget: 10_000 })
    assert.ok(existsSync(join(outside, 'DevToolsActivePort')), 'the link\'s target lost its files')
    assert.ok(readdirSync(root).includes('proto-shoot-link'), 'the link itself was removed')
  } finally { try { rmdirSync(join(root, 'proto-shoot-link')) } catch { /* never made */ } rmSync(outside, { recursive: true, force: true }) }
}))

test('SingletonLock: in use while its process runs here, free once it is gone, in use when it names another machine', t => fakeTemp(({ root, dir }) => {
  const lock = (name, to) => { const p = dir(name); symlinkSync(to, join(p, 'SingletonLock')); return p }
  try { lock('probe', 'x-1') } catch { return t.skip('no rights to make a symbolic link here') }
  assert.equal(inUse(lock('mine', `${hostname()}-${process.pid}`), 'linux'), true)
  assert.equal(inUse(lock('dead', `${hostname()}-2147483646`), 'linux'), false)
  assert.equal(inUse(lock('remote', 'some-other-machine-1234'), 'linux'), true)
  assert.equal(inUse(dir('unlocked'), 'linux'), false)
}))

// The case the age check alone gets wrong: a browser still running in a profile whose folder looks days old.
const chromeFound = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(new URL('../scripts/chrome.mjs', import.meta.url).href)}).then(m => m.findChrome())`], { cwd: skill, stdio: 'ignore' }).status === 0
test('a profile a running Chrome has open is never touched, however old it looks', { skip: !chromeFound && 'no Chrome installed' }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'proto sweep live '))
  const profile = join(root, 'proto-shoot-live')
  mkdirSync(profile)
  const chrome = startChrome([`--user-data-dir=${profile}`, '--no-first-run'])
  chrome.profile = undefined // the check deletes it itself, after looking
  try {
    // A Chrome that can't start here (a CI box without a usable sandbox) says nothing about the sweep.
    const started = await new Promise(ok => {
      let out = ''
      chrome.stderr.on('data', d => { out += d; if (/DevTools listening/.test(out)) ok(true) })
      chrome.on('exit', () => ok(`Chrome exited: ${out.trim().split('\n').pop()}`))
      setTimeout(() => ok(`Chrome did not start in 20 s: ${out.trim().split('\n').pop()}`), 20_000)
    })
    if (started !== true) return t.skip(started)
    // Files a running Chrome keeps for as long as it runs; any of them going means the sweep reached in.
    // The last is the in-use mark the sweep reads, so it must be there for this check to mean anything.
    const lock = process.platform === 'win32' ? 'lockfile' : 'SingletonLock'
    const marks = ['Local State', 'Default', 'DevToolsActivePort', lock]
    const present = () => marks.filter(m => { try { lstatSync(join(profile, m)); return true } catch { return false } })
    for (let i = 0; i < 50 && !present().includes(lock); i++) await new Promise(r => setTimeout(r, 100))
    const before = present()
    assert.ok(before.includes(lock), `a running Chrome has no ${lock} in its profile, so the sweep can't tell it is in use`)
    utimesSync(profile, old, old)
    sweepProfiles({ root, budget: 10_000 })
    assert.deepEqual(present(), before, 'the live profile lost files')
    assert.deepEqual(readdirSync(root), ['proto-shoot-live'], 'the live profile was renamed or moved')
    assert.equal(chrome.exitCode, null, 'Chrome stopped')
  } finally {
    stopChrome(chrome)
    for (let i = 0; i < 50 && existsSync(root); i++) { try { rmSync(root, { recursive: true, force: true }) } catch { await new Promise(r => setTimeout(r, 100)) } }
  }
})
