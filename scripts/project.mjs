// One app per project. Every conversation (session) in a project works in .prototypes/_project and
// is listed in its registry, .proto/sessions.json, kept out of session.json because the page
// hot-reloads that file and the registry changes on every command. Legacy apps (one per session,
// .prototypes/<session>/) are found here for the import (scripts/import.mjs).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PROJECT_DIR = '_project'
export const projectApp = project => join(project, '.prototypes', PROJECT_DIR)

const read = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
// Whole or not at all: a reader never sees half a file.
function write(f, v) {
  mkdirSync(join(f, '..'), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(v, null, 2) + '\n')
  renameSync(tmp, f)
}

// A directory only one process can create is the lock; one held past 5 s was left by a crash and is
// taken over. app/server.mjs takes the same lock.
export function locked(app, fn) {
  const lock = join(app, '.proto', 'session.lock')
  mkdirSync(join(lock, '..'), { recursive: true })
  let mine = false
  for (let i = 0; i < 200 && !mine; i++) {
    try { mkdirSync(lock); mine = true } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 5000) rmSync(lock, { recursive: true, force: true }) } catch { /* just released */ }
      if (!mine) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }
  try { return fn() } finally { if (mine) rmSync(lock, { recursive: true, force: true }) }
}

/** A long hold (an import copying files) touches the lock, so others don't take it as left by a crash. */
export function keepLock(app) {
  const now = new Date()
  try { utimesSync(join(app, '.proto', 'session.lock'), now, now) } catch { /* not held */ }
}

export const readProject = app => read(join(app, 'session.json'), null)
/** Changes session.json under the lock: fn gets the state and returns the fields to change. */
export function withProject(app, fn) {
  return locked(app, () => {
    const was = readProject(app), s = { ...was, ...fn(was) }
    if (JSON.stringify(s) !== JSON.stringify(was)) write(join(app, 'session.json'), s)
    return s
  })
}

const registryFile = app => join(app, '.proto', 'sessions.json')
export const sessionsOf = app => read(registryFile(app), {})
/** Adds or refreshes a conversation in the registry; info fields left undefined keep their value. */
export function registerSession(app, sid, info = {}) {
  return locked(app, () => {
    const all = sessionsOf(app), now = new Date().toISOString(), was = all[sid] || { createdAt: now }
    const set = Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined && v !== null))
    all[sid] = { ...was, ...set, seenAt: now }
    write(registryFile(app), all)
    return all[sid]
  })
}

/** The conversation working on a prototype now: the last to add to it or work on it, else its maker. */
export const ownerOf = meta => meta?.owner ?? meta?.session ?? null

/** Per-session apps from before the project app, not imported yet, oldest first. */
export function legacySessions(project) {
  const root = join(project, '.prototypes')
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter(d => d !== PROJECT_DIR && !d.startsWith('_') && !d.startsWith('.'))
    .map(d => ({ dir: join(root, d), json: read(join(root, d, 'session.json'), null) }))
    .filter(x => x.json?.id && !x.json.migratedTo && existsSync(join(x.dir, 'src', 'protos'))
      && readdirSync(join(x.dir, 'src', 'protos')).some(p => existsSync(join(x.dir, 'src', 'protos', p, 'meta.ts'))))
    .sort((a, b) => String(a.json.createdAt || '').localeCompare(String(b.json.createdAt || '')))
}
