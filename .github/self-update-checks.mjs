// The skill keeping itself current (scripts/self-update.mjs), on throwaway git repositories.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { skillUpdate } from '../scripts/self-update.mjs'

const root = mkdtempSync(join(tmpdir(), 'proto-update-'))
after(() => rmSync(root, { recursive: true, force: true }))
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', PROTO_NO_UPDATE: '' }
const git = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
const commit = (cwd, file) => { writeFileSync(join(cwd, file), file); git(cwd, 'add', file); git(cwd, 'commit', '-qm', file) }

let n = 0
// A "GitHub" repository named like the real one, a clone of it as the installed skill, and a
// second clone that pushes a newer commit to it.
function setup() {
  const dir = join(root, String(++n))
  const remote = join(dir, 'prototype-skill.git'), skill = join(dir, 'skill'), dev = join(dir, 'dev')
  mkdirSync(dir)
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
  git(dir, 'clone', '-q', remote, dev)
  git(dev, 'checkout', '-qb', 'main')
  commit(dev, 'one')
  git(dev, 'push', '-q', 'origin', 'main')
  git(dir, 'clone', '-q', remote, skill)
  commit(dev, 'two')
  git(dev, 'push', '-q', 'origin', 'main')
  return { dir, skill, dev, stateFile: join(dir, 'update.json'), configDir: join(dir, 'claude'), latest: git(dev, 'rev-parse', 'HEAD') }
}
const opts = s => ({ env, stateFile: s.stateFile, configDir: s.configDir })

test('a clean clone on main is fast-forwarded and asks to re-read SKILL.md', () => {
  const s = setup()
  const r = skillUpdate(s.skill, opts(s))
  assert.equal(r.updated, true)
  assert.match(r.lines[0], /^skill: updated the prototype skill \w{7} -> \w{7}: re-read SKILL\.md/)
  assert.equal(git(s.skill, 'rev-parse', 'HEAD'), s.latest)
})

test('checks at most once every few hours', () => {
  const s = setup()
  const now = Date.now()
  skillUpdate(s.skill, { ...opts(s), now })
  commit(s.dev, 'three')
  git(s.dev, 'push', '-q', 'origin', 'main')
  assert.equal(skillUpdate(s.skill, { ...opts(s), now: now + 3600_000 }).updated, false)
  assert.equal(skillUpdate(s.skill, { ...opts(s), now: now + 7 * 3600_000 }).updated, true)
})

test('a developer checkout is left alone: another branch, or edits', () => {
  const s = setup()
  git(s.skill, 'checkout', '-qb', 'feature')
  assert.deepEqual(skillUpdate(s.skill, opts(s)), { lines: [], updated: false })
  git(s.skill, 'checkout', '-q', 'main')
  writeFileSync(join(s.skill, 'one'), 'edited')
  assert.deepEqual(skillUpdate(s.skill, { ...opts(s), now: Date.now() + 7 * 3600_000 }), { lines: [], updated: false })
  assert.notEqual(git(s.skill, 'rev-parse', 'HEAD'), s.latest)
})

test('a pull that fails says so and keeps the installed version', () => {
  const s = setup()
  const head = git(s.skill, 'rev-parse', 'HEAD')
  git(s.skill, 'remote', 'set-url', 'origin', join(s.dir, 'gone', 'prototype-skill.git'))
  const r = skillUpdate(s.skill, opts(s))
  assert.equal(r.updated, false)
  assert.match(r.lines[0], /^skill: could not update the prototype skill \(.+\); carrying on with \w{7}$/)
  assert.equal(git(s.skill, 'rev-parse', 'HEAD'), head)
})

test('a clone inside Claude Code\'s plugin cache is never pulled', () => {
  const s = setup()
  const cached = join(s.configDir, 'plugins', 'cache', 'prototype')
  git(s.dir, 'clone', '-q', join(s.dir, 'prototype-skill.git'), cached)
  git(cached, 'reset', '-q', '--hard', 'HEAD~1')
  assert.deepEqual(skillUpdate(cached, opts(s)), { lines: [], updated: false })
  assert.notEqual(git(cached, 'rev-parse', 'HEAD'), s.latest)
})

test('PROTO_NO_UPDATE=1 skips the check', () => {
  const s = setup()
  assert.deepEqual(skillUpdate(s.skill, { ...opts(s), env: { ...env, PROTO_NO_UPDATE: '1' } }), { lines: [], updated: false })
})

test('a plugin install behind main is told to update, and one at main is not', () => {
  const s = setup()
  const plugin = join(s.dir, 'cache', 'prototype')
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  mkdirSync(join(s.configDir, 'plugins'), { recursive: true })
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ repository: join(s.dir, 'prototype-skill.git') }))
  const record = sha => writeFileSync(join(s.configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2, plugins: { 'prototype@prototype-skill': [{ scope: 'user', installPath: plugin, gitCommitSha: sha }] },
  }))
  record('0'.repeat(40))
  const r = skillUpdate(plugin, opts(s))
  assert.equal(r.updated, false)
  assert.match(r.lines[0], /run `claude plugin update prototype@prototype-skill` now/)
  record(s.latest)
  assert.deepEqual(skillUpdate(plugin, opts(s)), { lines: [], updated: false })
})
