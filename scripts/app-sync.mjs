// A session's copy of the app, brought up to date with the template: every shell file replaced
// (the shell is one piece, never some of it), files the template dropped swept away, and the
// packages the shell needs set to the template's versions. `proto up` runs it before it starts the
// dev server, and `proto share` before it builds, since a share is built from the session's own
// copy (a session not re-upped would publish an old viewer). Nothing here stops a server or
// installs: the caller does what the result asks for.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SKILL = dirname(dirname(fileURLToPath(import.meta.url)))
export const APP = join(SKILL, 'app')

export const BASE = { vite: '^8.3.0', tailwindcss: '^4.3.0', '@tailwindcss/vite': '^4.3.0' }
// The shell's own runtime, in every app whatever its stack: the phone's variant sheet is Base
// UI's Drawer, which is React, and so is the comment layer (which takes its screenshots with
// modern-screenshot). The few icons the shell takes from Phosphor are its own SVG files, so they
// work the same in a Vue app.
export const SHELL = { react: '^19.2.0', 'react-dom': '^19.2.0', '@base-ui/react': '^1.9.0', 'modern-screenshot': '^4.7.0', '@phosphor-icons/core': '^2.1.1', '@fontsource-variable/google-sans': '^5.3.2', 'qrcode-generator': '^2.0.4' }
// What a variant can reach for without an install (an install reloads the page): icons and
// motion. Fonts come from Google Fonts at run time (src/fonts.ts, `proto fonts`). New sessions
// only; `proto up` never adds them to an existing one, so a running session isn't reinstalled and
// restarted for packages it never asked for.
export const STACKS = {
  react: { deps: {}, craft: { '@phosphor-icons/react': '^2.1.10', motion: '^14.1.0' }, dev: { '@vitejs/plugin-react': '^6.1.0' }, ext: 'tsx', adapter: 'react.tsx', hints: 'hints.react.ts', tweaks: 'tweaks.react.ts', copy: 'copy.react.ts', motion: 'motion.react.ts', slot: 'slot.react.ts', stub: 'react.tsx', plan: 'react-plan.tsx' },
  vue: { deps: { vue: '^3.5.0' }, craft: { '@phosphor-icons/vue': '^2.2.1', 'motion-v': '^2.7.0' }, dev: { '@vitejs/plugin-vue': '^6.0.0' }, ext: 'vue', adapter: 'vue.ts', hints: 'hints.vue.ts', tweaks: 'tweaks.vue.ts', copy: 'copy.vue.ts', motion: 'motion.vue.ts', stub: 'vue.vue', plan: 'vue-plan.vue' },
}

// The files a running dev server holds in memory: a change to one takes a new server.
export const RESTART_WORTHY = ['vite.config.mjs', 'server.mjs', 'source.mjs', 'assignment.mjs', 'listener.mjs']

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }

// What a session's app takes from the template, by its path in the session: everything copied in
// except the session's own work (its prototypes and theme), plus the stack's adapters.
const OWN = new Set(['adapters', 'stubs', 'node_modules', join('src', 'protos'), join('src', 'theme.css')])
export function appFiles(stack) {
  const kit = STACKS[stack]
  if (!kit) throw new Error(`unknown stack "${stack}" in session.json`)
  const out = new Map()
  const walk = rel => {
    for (const e of readdirSync(join(APP, rel), { withFileTypes: true })) {
      const r = join(rel, e.name)
      if (OWN.has(r)) continue
      if (e.isDirectory()) walk(r)
      else out.set(r === 'gitignore' ? '.gitignore' : r, join(APP, r))
    }
  }
  walk('')
  out.set(join('src', `mount.${kit.adapter.split('.').pop()}`), join(APP, 'adapters', kit.adapter))
  out.set(join('src', 'hints.ts'), join(APP, 'adapters', kit.hints))
  out.set(join('src', 'tweaks.ts'), join(APP, 'adapters', kit.tweaks))
  out.set(join('src', 'copy.ts'), join(APP, 'adapters', kit.copy))
  out.set(join('src', 'motion.ts'), join(APP, 'adapters', kit.motion))
  if (kit.slot) out.set(join('src', 'slot.ts'), join(APP, 'adapters', kit.slot))
  return out
}

/**
 * Brings the session at `dir` up to date with the template. Says what changed: the files (by their
 * path in the session), whether package.json moved (an install is then needed), and whether any
 * of it is something a running dev server would only pick up when started again.
 */
export function syncApp(dir) {
  const s = readJson(join(dir, 'session.json'), null)
  const kit = STACKS[s?.stack]
  if (!kit) throw new Error(`unknown stack "${s?.stack}" in ${join(dir, 'session.json')}`)
  const files = appFiles(s.stack)
  const changed = []
  for (const [rel, from] of files) {
    const to = join(dir, rel), next = readFileSync(from)
    if (existsSync(to) && readFileSync(to).equals(next)) continue
    mkdirSync(dirname(to), { recursive: true })
    writeFileSync(to, next)
    changed.push(rel)
  }
  // A shell file the template dropped or renamed would otherwise linger beside its replacement.
  const sweep = rel => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = join(rel, e.name)
      if (e.isDirectory()) { sweep(r); if (!readdirSync(join(dir, r)).length) rmSync(join(dir, r), { recursive: true }) }
      else if (!files.has(r)) { rmSync(join(dir, r)); changed.push(r) }
    }
  }
  if (existsSync(join(dir, 'shell'))) sweep('shell')
  const pkgFile = join(dir, 'package.json'), pkg = readJson(pkgFile, {})
  let deps = false
  for (const [key, want] of [['dependencies', { ...SHELL, ...kit.deps }], ['devDependencies', { ...BASE, ...kit.dev }]]) {
    pkg[key] ||= {}
    for (const [name, v] of Object.entries(want)) if (pkg[key][name] !== v) { pkg[key][name] = v; deps = true }
  }
  if (deps) {
    const tmp = `${pkgFile}.${process.pid}.${randomBytes(4).toString('hex')}`
    writeFileSync(tmp, JSON.stringify(pkg, null, 2) + '\n')
    renameSync(tmp, pkgFile)
  }
  return { changed, deps, restartWorthy: changed.some(f => RESTART_WORTHY.includes(f)) }
}

/** Installs the session's packages (pnpm when it is there, else npm). Says whether it worked. */
export function installApp(dir) {
  const win = process.platform === 'win32'
  const pnpm = spawnSync(win ? 'where' : 'which', ['pnpm'], { stdio: 'ignore' }).status === 0
  const [bin, args] = pnpm
    ? ['pnpm', ['install', '--ignore-workspace', '--prefer-offline', '--reporter=silent']]
    : ['npm', ['install', '--no-audit', '--no-fund', '--loglevel=error']]
  return spawnSync(bin, args, { cwd: dir, stdio: 'inherit', ...(win ? { shell: true } : {}) }).status === 0
}
