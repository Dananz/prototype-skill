#!/usr/bin/env node
// proto: one live prototype app per Claude Code session, served on the tailnet.
//
//   proto up [--name "Session name"] [--stack react|vue]   create or restart, print the URL; an existing
//             session's copy of the app (shell, config, packages) is brought up to date first
//   proto add <slug> --title "…" --variants "A:Name,B:Name" [--ask "…"] [--kind phone] [--screen 402x874]
//             [--from <slug>/<letter>[,<slug>/<letter>…]]   built from those variants: nested under the first
//             [--from-picks]   built from every variant the user picked in this session
//             [--kit[=<name>]] [--current <screen>]   on the project's design kit: its theme, parts and
//             packages, and with --current that screen's saved Current as A (with its references)
//   proto plan <slug>   each placeholder shows its direction's one-line plan from .proto/briefs/<slug>.json
//   proto done <slug>/<letter>[ …] | <slug>   that variant is built: the page drops its Building mark
//   proto shoot [route…] [--theme dark] [--focus] [--copy] [--click <css>]  screenshots, e.g. hero hero/A hero/A/open
//             [--ref <png>]   instead, the variant's screen beside that screenshot of the real one
//             [--as built]    with --ref: the png is the variant built in the codebase (<route>-vs-built.png)
//             [--at <ms>]     instead, the variant's motion (useMotion) at that moment of its take
//             [--frames <n>] [--at <ms>-<ms>]   n frames of the take on one sheet, with its curves
//             [--size <w>x<h>]   instead of desktop and phone, that viewport (a layout from the page's device view)
//   proto shoot [slug…] --sheet [--state <id>] [--theme dark]   every variant on one contact sheet per prototype
//   proto compare <slug>/<letter>[/<state>] --ref <png> [--el <css>] [--size <w>x<h>] [--click <css>]
//             how far an element of the variant (default: the whole variant) is from a screenshot of
//             the real one, as % of pixels off, per column and per third, with a difference image
//   proto perf <slug>/<letter>[/<state>] [--drag <css>] [--click <css>] [--size <w>x<h>] [--dpr 2] [--hz <n>] [--seconds 3]
//             frames per second at rest (or while dragging that element), how busy the main and GPU
//             threads are, and the design's slowest functions; run it on anything that animates
//   proto handoff <slug>/<letter>   a checklist of what that variant has, for building it into the codebase
//   proto snap <slug>[/<letter>]… [--width 672]   static HTML snapshots for a Claude Doc
//   proto pick <slug> <letter> [--off]   the user chose this variant: marked in the page
//   proto work <slug>/<letter> [--ask "…"] [--off]   the variant being worked on: pinned in the page
//   proto ask "…" [--to <slug>/<letter>]   a change the user asked for, kept with that variant
//   proto ask --each "…" "…" …   several at once (a batch of comments)
//   proto inbox [--wait] [--timeout <min>]   comments sent from the page; --wait blocks until some arrive
//   proto reply <batch>[/<n>] "…" [--done] [--as codex]   answer a comment (or a whole batch) in the page
//   proto reply <batch> 1 "…" 2 "…" … [--done]   answer many comments of a batch in one call
//   proto kit [--kit=<name>]   the project's design kit: what it has, and whether the app moved on since
//   proto kit save <slug> [--sources <file,…>] [--kit=<name>]   the session's theme.css and that prototype's
//             parts, packages and screen, kept for the next session (--sources: the files they came from)
//   proto kit screen <name> <slug>[/<letter>] [--sources <file,…>]   a Current that matches its reference
//   proto fonts [--draw <n>] [--hebrew] [--avoid <family,…>]   font pairings from Google Fonts (references/
//             fonts.json); --draw: n at random, no family twice, for the directions of one prototype
//   proto archive <slug> [--off]    proto keep [--off]      proto url    proto stack
//   proto stop    proto rm    proto ls    proto gc
//
// Common flags: --project <dir> (default: git root of the cwd), --session <id>
// (default: $CLAUDE_CODE_SESSION_ID).

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)))
const APP = join(SKILL, 'app')
const INDEX = join(homedir(), '.prototypes', 'sessions.json')
const IDLE_HOURS = 6
const MAX_HEAP_MB = 1024
const DELETE_DAYS = 14
const LOCAL_PORTS = [5180, 5279]
const TAILNET_PORTS = [9500, 9599]
const BASE = { vite: '^8.3.0', tailwindcss: '^4.3.0', '@tailwindcss/vite': '^4.3.0' }
// The shell's own runtime, in every app whatever its stack: the phone's variant sheet is Base
// UI's Drawer, which is React, and so is the comment layer (which takes its screenshots with
// modern-screenshot).
const SHELL = { react: '^19.2.0', 'react-dom': '^19.2.0', '@base-ui/react': '^1.9.0', 'modern-screenshot': '^4.7.0' }
// What a variant can reach for without an install (an install reloads the page): icons and
// motion. Fonts come from Google Fonts at run time (src/fonts.ts, `proto fonts`). New sessions
// only; `proto up` never adds them to an existing one, so a running session isn't reinstalled and
// restarted for packages it never asked for.
const STACKS = {
  react: { deps: {}, craft: { '@phosphor-icons/react': '^2.1.10', motion: '^14.1.0' }, dev: { '@vitejs/plugin-react': '^6.1.0' }, ext: 'tsx', adapter: 'react.tsx', hints: 'hints.react.ts', copy: 'copy.react.ts', motion: 'motion.react.ts', stub: 'react.tsx', plan: 'react-plan.tsx' },
  vue: { deps: { vue: '^3.5.0' }, craft: { '@phosphor-icons/vue': '^2.2.1', 'motion-v': '^2.7.0' }, dev: { '@vitejs/plugin-vue': '^6.0.0' }, ext: 'vue', adapter: 'vue.ts', hints: 'hints.vue.ts', copy: 'copy.vue.ts', motion: 'motion.vue.ts', stub: 'vue.vue', plan: 'vue-plan.vue' },
}

// ---------- arguments ----------
const argv = process.argv.slice(2)
const cmd = argv[0]
const flags = {}
const args = []
// Flags that are only on or off never take the next word, so `add --from-picks mix` or
// `pick --off hero` still reads the slug as the slug.
const SWITCHES = new Set(['from-picks', 'off', 'done', 'wait', 'focus', 'copy', 'kit', 'each', 'hebrew'])
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { args.push(a); continue }
  const [k, v] = a.slice(2).split(/=(.*)/s)
  flags[k] = v !== undefined ? v : !SWITCHES.has(k) && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
}

const die = msg => { console.error(`proto: ${msg}`); process.exit(1) }
const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
// Windows keeps a directory busy while a scanner or a watcher has a file in it, so a rename can
// fail with EPERM or EBUSY for a moment. Try again for a couple of seconds, and copy as the last resort.
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])
function moveDir(from, to) {
  for (let i = 0; ; i++) {
    try { return renameSync(from, to) } catch (e) {
      if (!BUSY.has(e.code)) throw e
      if (i >= 40) { cpSync(from, to, { recursive: true }); rmSync(from, { recursive: true, force: true }); return }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
  }
}
// A file the dev server reads too (session.json, meta.ts) is written whole or not at all: into a
// scratch file, then renamed over the old one, so the page and the server never read half of one.
// In a session the scratch file waits in its .proto/, which the dev server doesn't watch; one next
// to meta.ts would look like an edit to the prototype.
const scratchOf = dir => join(dir, '.proto', 'tmp')
function writeWhole(f, text, scratch = dirname(f)) {
  mkdirSync(dirname(f), { recursive: true })
  mkdirSync(scratch, { recursive: true })
  const tmp = join(scratch, `.${basename(f)}.${process.pid}.${randomBytes(4).toString('hex')}`)
  writeFileSync(tmp, text)
  try { moveDir(tmp, f) } catch (e) { rmSync(tmp, { force: true }); throw e }
}
const writeJson = (f, v, scratch) => writeWhole(f, JSON.stringify(v, null, 2) + '\n', scratch)
const tilde = p => p.replace(homedir(), '~')
const WIN = process.platform === 'win32'
const run = (bin, a, opts = {}) => spawnSync(bin, a, { encoding: 'utf8', ...opts })
// npm and pnpm are .cmd scripts on Windows, which Node only starts through a shell.
const runCli = (bin, a, opts = {}) => WIN ? run([bin, ...a].join(' '), [], { ...opts, shell: true }) : run(bin, a, opts)
const has = bin => run(WIN ? 'where' : 'which', [bin]).status === 0
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------- where things are ----------
function projectRoot() {
  if (flags.project) return resolve(flags.project)
  const git = run('git', ['rev-parse', '--show-toplevel'])
  return git.status === 0 ? git.stdout.trim() : process.cwd()
}
function sessionId() {
  const id = flags.session || process.env.CLAUDE_CODE_SESSION_ID
  if (!id) die('no session id. Pass --session <id> (outside Claude Code, any stable name works).')
  return String(id)
}
// Claude Code session ids are UUIDs, whose first 8 characters are plenty; any other name
// is kept whole so two different names never share a folder.
const short = id => (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8) : id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40)) || 'session'
const sessionDir = () => join(projectRoot(), '.prototypes', short(sessionId()))
const sessionFile = dir => join(dir, 'session.json')
const readSession = dir => readJson(sessionFile(dir), null)
// The page hot-reloads session.json, so a write that changes nothing is skipped. Read right
// before it is written, since the dev server writes it too (a pick made in the page).
function patchSession(dir, patch) {
  const was = readSession(dir), s = { ...was, ...patch }
  if (JSON.stringify(s) !== JSON.stringify(was)) writeJson(sessionFile(dir), s, scratchOf(dir))
  return s
}
function need(dir) { if (!existsSync(sessionFile(dir))) die(`no prototype session here yet (${tilde(dir)}). Run: proto up`); return readSession(dir) }

const index = () => readJson(INDEX, []).filter(d => typeof d === 'string')
const remember = dir => { const all = new Set(index()); all.add(dir); writeJson(INDEX, [...all]) }
const forget = dir => writeJson(INDEX, index().filter(d => d !== dir))

// ---------- stack ----------
function detectStack(project) {
  const pkg = readJson(join(project, 'package.json'), {})
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
  const hasAny = (...names) => names.some(n => n in deps)
  if (hasAny('vue', 'nuxt')) return { stack: 'vue', why: 'the project uses Vue' }
  if (hasAny('react', 'next', 'react-native', 'expo', '@remix-run/react')) return { stack: 'react', why: 'the project uses React' }
  if (hasAny('svelte', '@sveltejs/kit')) return { stack: 'react', why: 'Svelte has no adapter yet, so React' }
  if (hasAny('solid-js')) return { stack: 'react', why: 'Solid has no adapter yet, so React' }
  if (hasAny('@angular/core')) return { stack: 'react', why: 'Angular has no adapter, so React' }
  return { stack: 'react', why: 'no web framework found, so React' }
}

// ---------- processes, ports, tailnet ----------
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }
// The dev server and what it started (esbuild): its process group, or its tree on Windows.
// Waits until it has exited, so a `proto up` right after gets the same port back.
async function kill(pid) {
  if (WIN) { run('taskkill', ['/pid', String(pid), '/T', '/F']); return }
  const signal = sig => { try { process.kill(-pid, sig) } catch { try { process.kill(pid, sig) } catch { /* gone */ } } }
  signal('SIGTERM')
  for (let i = 0; i < 50 && alive(pid); i++) await sleep(100)
  if (alive(pid)) signal('SIGKILL')
}
async function answers(url, ms = 2500) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok } catch { return false }
}
const running = async s => !!s?.port && alive(s.pid) && answers(`http://127.0.0.1:${s.port}/__proto/status`)
const portFree = port => new Promise(ok => {
  const srv = createServer().once('error', () => ok(false)).once('listening', () => srv.close(() => ok(true)))
  srv.listen(port, '127.0.0.1')
})
function claimedPorts(key) {
  return new Set(index().map(d => readSession(d)?.[key]).filter(Boolean))
}
async function localPort(s) {
  if (s.port && await portFree(s.port)) return s.port
  const taken = claimedPorts('port')
  for (let p = LOCAL_PORTS[0]; p <= LOCAL_PORTS[1]; p++) if (!taken.has(p) && await portFree(p)) return p
  die('no free local port in 5180-5279')
}
function tailnet() {
  if (!has('tailscale')) return null
  const st = run('tailscale', ['status', '--json'])
  if (st.status !== 0) return null
  const host = JSON.parse(st.stdout).Self?.DNSName?.replace(/\.$/, '')
  if (!host) return null
  const serve = run('tailscale', ['serve', 'status', '--json'])
  const cfg = serve.status === 0 && serve.stdout.trim() ? JSON.parse(serve.stdout) : {}
  // Which local port each https serve port proxies to.
  const rules = {}
  for (const [hostPort, web] of Object.entries(cfg.Web || {})) {
    const port = hostPort.split(':').pop()
    const proxy = Object.values(web.Handlers || {})[0]?.Proxy || ''
    rules[port] = Number(proxy.split(':').pop()) || 0
  }
  return { host, rules, tcp: new Set(Object.keys(cfg.TCP || {})) }
}
function tailnetPort(s, net) {
  if (s.tailnetPort && (net.rules[s.tailnetPort] === s.port || !net.tcp.has(String(s.tailnetPort)))) return s.tailnetPort
  const taken = claimedPorts('tailnetPort')
  for (let p = TAILNET_PORTS[0]; p <= TAILNET_PORTS[1]; p++) if (!taken.has(p) && !net.tcp.has(String(p))) return p
  die('no free tailnet port in 9500-9599')
}

// ---------- create ----------
function scaffold(dir, project) {
  const { stack, why } = flags.stack ? { stack: flags.stack, why: 'asked for' } : detectStack(project)
  const kit = STACKS[stack] || die(`unknown stack "${stack}" (react or vue)`)
  mkdirSync(dirname(dir), { recursive: true })
  const outer = join(dirname(dir), '.gitignore')
  if (!existsSync(outer)) writeFileSync(outer, '# Prototype sessions, never committed.\n*\n')
  cpSync(APP, dir, { recursive: true, filter: src => !/[/\\](adapters|stubs|node_modules)([/\\]|$)/.test(src.slice(APP.length)) })
  renameSync(join(dir, 'gitignore'), join(dir, '.gitignore'))
  cpSync(join(APP, 'adapters', kit.adapter), join(dir, 'src', `mount.${kit.adapter.split('.').pop()}`))
  cpSync(join(APP, 'adapters', kit.hints), join(dir, 'src', 'hints.ts'))
  cpSync(join(APP, 'adapters', kit.copy), join(dir, 'src', 'copy.ts'))
  cpSync(join(APP, 'adapters', kit.motion), join(dir, 'src', 'motion.ts'))
  writeJson(join(dir, 'package.json'), {
    name: `prototype-${basename(dir)}`, private: true, type: 'module',
    dependencies: { ...SHELL, ...kit.deps, ...kit.craft }, devDependencies: { ...BASE, ...kit.dev },
  })
  const id = sessionId()
  writeJson(sessionFile(dir), {
    id, name: flags.name || basename(project), project, path: tilde(project), stack,
    createdAt: new Date().toISOString(), port: null, tailnetPort: null, pid: null,
    url: null, localUrl: null, keep: false, idleHours: IDLE_HOURS, deleteDays: DELETE_DAYS,
  })
  remember(dir)
  console.log(`created ${tilde(dir)} (${stack}: ${why})`)
}

// ---------- update ----------
// What a session's app takes from the template, by its path in the session: everything copied in
// except the session's own work (its prototypes and theme), plus the stack's adapters.
const OWN = new Set(['adapters', 'stubs', 'node_modules', join('src', 'protos'), join('src', 'theme.css')])
function appFiles(stack) {
  const kit = STACKS[stack] || die(`unknown stack "${stack}" in session.json`)
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
  out.set(join('src', 'copy.ts'), join(APP, 'adapters', kit.copy))
  out.set(join('src', 'motion.ts'), join(APP, 'adapters', kit.motion))
  return out
}

/**
 * Brings an existing session's app up to date with the template, so a fix to the shell reaches a
 * session made before it. The shell is one piece, so every file of it is replaced, never some.
 * Packages the shell needs are added or moved to the template's version; ones the session added
 * stay. Vite picks up changed shell code by itself; new packages, its config and the server need
 * the dev server started again, which `up` then does.
 */
async function update(dir) {
  const s = readSession(dir)
  const kit = STACKS[s.stack]
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
  if (!changed.length && !deps) return
  if (deps) writeJson(pkgFile, pkg)
  console.log(`updated the app: ${changed.length} file${changed.length === 1 ? '' : 's'}${deps ? ', packages' : ''}`)
  if (deps || changed.some(f => ['vite.config.mjs', 'server.mjs', 'source.mjs'].includes(f))) await stop(dir, 'updated')
  if (deps) install(dir)
}

function install(dir) {
  const t = Date.now()
  const pnpm = has('pnpm')
  const r = pnpm
    ? runCli('pnpm', ['install', '--ignore-workspace', '--prefer-offline', '--reporter=silent'], { cwd: dir, stdio: 'inherit' })
    : runCli('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit' })
  if (r.status !== 0) die('installing the prototype app failed (see above)')
  console.log(`installed in ${((Date.now() - t) / 1000).toFixed(1)}s`)
}

// ---------- commands ----------
async function up() {
  await gc(true)
  const project = projectRoot()
  const dir = sessionDir()
  if (!existsSync(sessionFile(dir))) scaffold(dir, project)
  else await update(dir)
  let s = readSession(dir)
  if (flags.name && flags.name !== s.name) s = patchSession(dir, { name: flags.name })
  if (!existsSync(join(dir, 'node_modules', 'vite'))) install(dir)

  if (!await running(s)) {
    const port = await localPort(s)
    s = patchSession(dir, { port, stoppedAt: null, stopReason: null })
    mkdirSync(join(dir, '.proto'), { recursive: true })
    const log = openSync(join(dir, '.proto', 'dev.log'), 'a')
    // A ceiling on the server's JS heap: it idles near 200 MB, so this only stops a runaway,
    // which exits and is restarted by the next `proto up`.
    const child = spawn(process.execPath, [`--max-old-space-size=${MAX_HEAP_MB}`, join(dir, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: dir, detached: true, windowsHide: true, stdio: ['ignore', log, log] })
    child.unref()
    s = patchSession(dir, { pid: child.pid })
    for (let i = 0; i < 60 && !await answers(`http://127.0.0.1:${port}/__proto/status`, 1000); i++) await sleep(250)
    if (!await running(s)) die(`the dev server did not start; see ${tilde(join(dir, '.proto', 'dev.log'))}`)
  }

  const localUrl = `http://127.0.0.1:${s.port}/`
  let url = localUrl
  const net = tailnet()
  if (net) {
    const tport = tailnetPort(s, net)
    if (net.rules[tport] !== s.port) run('tailscale', ['serve', '--bg', `--https=${tport}`, `http://127.0.0.1:${s.port}`])
    url = `https://${net.host}:${tport}/`
    s = patchSession(dir, { tailnetPort: tport })
    if (!await answers(url, 10000)) die(`${url} did not answer. Local link: ${localUrl}`)
  }
  patchSession(dir, { url, localUrl })
  console.log(`url ${url}`)
  if (url !== localUrl) console.log(`local ${localUrl}`)
  console.log(`dir ${dir}`)
  console.log(`stack ${s.stack}`)
  for (const name of kitNames()) console.log(kitLine(name, project))
}

function add() {
  const dir = sessionDir()
  const s = need(dir)
  const slug = args[0]
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) die('give a slug like "hero-sections" (lowercase, digits, dashes)')
  const kit = STACKS[s.stack]
  const pdir = join(dir, 'src', 'protos', slug)
  const metaFile = join(pdir, 'meta.ts')
  const start = { title: slug, ask: '', kind: 'web', created: new Date().toISOString(), variants: {} }
  const current = () => {
    if (!existsSync(metaFile)) return { ...start }
    try { return { ...start, ...JSON.parse(readFileSync(metaFile, 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')) } }
    catch { die(`${tilde(metaFile)} is not plain JSON any more; edit it by hand instead`) }
  }
  current()
  // What this command changes, written over meta.ts as it is at the end (see below).
  const set = {}, drop = [], added = {}
  if (flags.title) set.title = flags.title
  if (flags.ask) set.ask = flags.ask
  if (flags.kind) set.kind = flags.kind === 'phone' ? 'phone' : 'web'
  // The phone frame's screen in points, read off the reference (an iPhone 17 shot is 1206×2622 at 3x: 402x874).
  if (flags.screen) {
    const m = String(flags.screen).match(/^(\d+)x(\d+)$/)
    if (!m) die('--screen is the screen in points, like 402x874')
    set.screen = [+m[1], +m[2]]
  }
  // Built from other prototypes (or some of their variants): the page nests it under the first
  // one and lists it as built from the others too. The first stays a plain "from" string and the
  // rest go in "also", so a session whose page predates "also" still nests it under the first.
  if (flags.from !== undefined || flags['from-picks']) {
    if (flags.from !== undefined && flags['from-picks']) die('give --from or --from-picks, not both')
    if (flags.from === true) die('--from takes <slug>/<letter>, several joined by commas: --from home/E,style/B')
    const refs = [...new Set(flags['from-picks'] ? picks(dir, slug) : String(flags.from).split(',').map(x => x.trim()).filter(Boolean))]
    if (!refs.length) die(flags['from-picks'] ? '--from-picks: nothing is picked in this session yet (proto pick <slug> <letter> marks a pick)' : '--from takes <slug>/<letter>')
    for (const ref of refs) {
      const [parent, variant = ''] = ref.split('/')
      if (parent === slug) die('a prototype can\'t be built from itself')
      const parentMeta = join(dir, 'src', 'protos', parent, 'meta.ts')
      if (!existsSync(parentMeta)) die(`--from: no prototype "${parent}" in this session`)
      if (variant && !readFileSync(parentMeta, 'utf8').includes(`"${variant}":`)) die(`--from: "${parent}" has no variant ${variant}`)
      // Walk up from this parent through every parent above it, the extra ones included;
      // meeting the new prototype on the way would make a loop.
      const seen = new Set(), todo = [parent]
      while (todo.length) {
        const up = todo.pop()
        if (up === slug) die(`--from: "${parent}" is already built from "${slug}"`)
        if (seen.has(up)) continue
        seen.add(up)
        todo.push(...parentsOf(dir, up))
      }
    }
    set.from = refs[0]
    if (refs.length > 1) set.also = refs.slice(1)
    else drop.push('also')
    if (flags['from-picks']) console.log(`from ${refs.join(', ')}`)
  }
  const list = String(flags.variants || '').split(',').map(x => x.trim()).filter(Boolean)
  const fresh = []
  // On the design kit: a new prototype takes its frame from it, unless told otherwise.
  const design = flags.kit || flags.current ? kitFor(s) : null
  if (design && !existsSync(metaFile)) {
    if (!flags.kind) set.kind = design.k.kind
    if (!flags.screen && design.k.screen) set.screen = design.k.screen
  }
  mkdirSync(pdir, { recursive: true })
  const stub = readFileSync(join(APP, 'stubs', kit.stub), 'utf8')
  const stubOf = (id, name) => stub.replaceAll('__ID__', () => id).replaceAll('__NAME__', () => name)
  // A saved Current is A, first in the list, whether or not --variants named it.
  if (flags.current && !current().variants.A && !list.some(e => e.split(':')[0] === 'A')) added.A = 'Current'
  for (const entry of list) {
    const [id, ...rest] = entry.split(':')
    if (!/^[A-Z]{1,2}$/.test(id)) die(`variant ids are capital letters (A, B … AA): "${id}"`)
    const name = rest.join(':').trim() || id
    added[id] = name
    const file = join(pdir, `${id}.${kit.ext}`)
    if (!existsSync(file)) { writeFileSync(file, stubOf(id, name)); fresh.push(id) }
  }
  if (design) {
    useKit(dir, pdir, slug, design, flags.current && { file: join(pdir, `A.${kit.ext}`), stub: stubOf('A', added.A ?? current().variants.A) })
    // A saved Current is already built.
    if (flags.current && fresh.includes('A')) fresh.splice(fresh.indexOf('A'), 1)
  }
  // meta.ts goes last, so the page sees the prototype with all its variants at once. It is read
  // again just before: a pick made in the page meanwhile is written by the dev server, and stays.
  // The variant list goes last, where it is easiest to read.
  const { variants, ...head } = { ...current(), ...set }
  for (const k of drop) delete head[k]
  const meta = { ...head, variants: { ...variants, ...added } }
  writeWhole(metaFile, `// Prototype: ${String(meta.title).replace(/[\r\n\u2028\u2029]+/g, ' ')}. Variant files are named by their letter; names live here.\nexport default ${JSON.stringify(meta, null, 2)}\n`, scratchOf(dir))
  // A new variant is building until `proto done`: the page marks it, and an edit that throws keeps
  // its last good frame instead of an error.
  if (fresh.length) {
    const at = new Date().toISOString()
    patchSession(dir, { building: { ...readSession(dir).building, ...Object.fromEntries(fresh.map(id => [`${slug}/${id}`, at])) } })
  }
  console.log(`${pdir}: ${Object.keys(meta.variants).map(id => `${id}.${kit.ext}`).join(' ') || 'no variants'}`)
  if (s.url) console.log(`${s.url}#/${slug}`)
}

// The one-line plans are written: each variant still on its placeholder shows its own (name, concept,
// display face, colors) until its first real write. A variant already written is left alone.
function plan() {
  const dir = sessionDir()
  const s = need(dir)
  const slug = args[0]
  const pdir = join(dir, 'src', 'protos', slug || '')
  if (!slug || !existsSync(join(pdir, 'meta.ts'))) die('which prototype? proto plan <slug> (after proto add)')
  const file = join(dir, '.proto', 'briefs', `${slug}.json`)
  const brief = readJson(file, null) || die(`write the one-line plans to ${tilde(file)} first: { "facts": "…", "directions": { "A": { "name", "concept", "display", "body", "surface", "ink", "accent", "signature" } } }`)
  const kit = STACKS[s.stack]
  const card = readFileSync(join(APP, 'stubs', kit.plan), 'utf8')
  const shown = []
  for (const [id, d] of Object.entries(brief.directions || {})) {
    const f = join(pdir, `${id}.${kit.ext}`)
    if (!existsSync(f) || !/^(\/\/|<!--) Placeholder while /.test(readFileSync(f, 'utf8'))) continue
    const keys = ['name', 'concept', 'display', 'body', 'surface', 'ink', 'accent', 'signature']
    const data = JSON.stringify(Object.fromEntries(keys.map(k => [k, d[k] == null ? null : String(d[k])])))
    const name = String(d.name || id)
    writeFileSync(f, card.replaceAll('__ID__', () => id).replaceAll('__NAME__', () => name.replace(/[\r\n]+/g, ' ')).replace('__PLAN__', () => data))
    shown.push(id)
  }
  console.log(shown.length ? `plans shown: ${shown.join(', ')}` : 'no placeholders left to show a plan on')
}

// A variant is built (its checks passed): the page drops its Building mark and shows its errors
// again. `proto done <slug>` ends every variant of that prototype.
function done() {
  const dir = sessionDir()
  const s = need(dir)
  if (!args.length) die('which variant? proto done <slug>/<letter> (or <slug> for all of its variants)')
  const building = { ...s.building }
  const ended = []
  for (const ref of args) {
    const [slug, letter] = ref.split('/')
    for (const k of Object.keys(building)) if (letter ? k === `${slug}/${letter}` : k.startsWith(`${slug}/`)) { delete building[k]; ended.push(k) }
  }
  patchSession(dir, { building })
  console.log(ended.length ? `built: ${ended.join(', ')}` : `nothing was building there (${args.join(', ')})`)
}

// meta.ts with its object replaced. Through a function: a replacement string would read `$&` or `$$`
// in a variant's name as a pattern and write something else.
const withMeta = (text, meta) => text.replace(/export default[\s\S]*$/, () => `export default ${JSON.stringify(meta, null, 2)}\n`)

// The user chose a variant ("go with A"): the page marks it and lists it first. The other
// variants stay, and so does everything built from this prototype.
function pick() {
  const dir = sessionDir()
  need(dir)
  const [slug, id] = args
  const metaFile = join(dir, 'src', 'protos', slug || '', 'meta.ts')
  if (!slug || !existsSync(metaFile)) die('which prototype? proto pick <slug> <letter>')
  const text = readFileSync(metaFile, 'utf8')
  const meta = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  if (flags.off) delete meta.picked
  else if (!id || !meta.variants?.[id]) die(`which variant of ${slug}? (${Object.keys(meta.variants || {}).join(', ')})`)
  else meta.picked = id
  writeWhole(metaFile, withMeta(text, meta), scratchOf(dir))
  // The pick is what gets worked on next; its history starts here.
  if (!flags.off) setWork(dir, { proto: slug, variant: id }, `Picked ${id}`)
  console.log(flags.off ? `${slug}: no pick` : `${slug}: picked ${id} · ${meta.variants[id]}`)
}

// ---------- the working variant ----------
// What the user is changing now: one variant per session, pinned at the top of the page's
// sidebar with what they asked for on it. It moves only when told to (a pick, `proto work`),
// never because some file changed. Kept in session.json, which the page reloads live.
const readMeta = (dir, slug) => {
  const f = join(dir, 'src', 'protos', slug || '', 'meta.ts')
  if (!slug || !existsSync(f)) return null
  return JSON.parse(readFileSync(f, 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
}
/** The prototypes one was built from: its "from", then the "also" list. A meta.ts edited by
 *  hand into something that isn't plain JSON any more counts as built from nothing. */
function parentsOf(dir, slug) {
  let m = null
  try { m = readMeta(dir, slug) } catch { /* not plain JSON */ }
  return [m?.from, ...(Array.isArray(m?.also) ? m.also : [])].filter(x => typeof x === 'string' && x).map(x => x.split('/')[0])
}
/** Every variant the user picked in this session, oldest prototype first (the page's order),
 *  for a design that combines them. Archived prototypes and the one being added are left out. */
function picks(dir, slug) {
  const root = join(dir, 'src', 'protos')
  return (existsSync(root) ? readdirSync(root) : []).filter(id => id !== slug)
    .map(id => { try { return { id, m: readMeta(dir, id) } } catch { return { id, m: null } } })
    .filter(({ m }) => m && !m.archived && m.picked && m.variants?.[m.picked])
    .sort((a, b) => String(a.m.created || '').localeCompare(String(b.m.created || '')) || a.id.localeCompare(b.id))
    .map(({ id, m }) => `${id}/${m.picked}`)
}
const sameVariant = (a, b) => !!a && !!b && a.proto === b.proto && a.variant === b.variant
function target(dir, spec) {
  const [proto, variant] = String(spec || '').split('/')
  const meta = readMeta(dir, proto)
  if (!meta) die(`no prototype "${proto || ''}" here: give <slug>/<letter>`)
  if (!variant || !meta.variants?.[variant]) die(`which variant of ${proto}? (${Object.keys(meta.variants || {}).join(', ')})`)
  return { proto, variant, name: meta.variants[variant] }
}
/** Points the session at a variant; the one it leaves goes first in `before` (three kept). */
function setWork(dir, t, ask) {
  const s = readSession(dir)
  const at = new Date().toISOString()
  const patch = {}
  if (!sameVariant(s.work, t)) {
    patch.work = { proto: t.proto, variant: t.variant, at }
    patch.before = [s.work, ...(s.before || [])].filter(x => x && !sameVariant(x, t))
      .filter((x, i, all) => all.findIndex(y => sameVariant(x, y)) === i).slice(0, 3).map(x => ({ proto: x.proto, variant: x.variant }))
  }
  if (ask) {
    const key = `${t.proto}/${t.variant}`
    patch.asks = { ...s.asks, [key]: [...(s.asks?.[key] || []), { at, text: ask }] }
  }
  patchSession(dir, patch)
}

function work() {
  const dir = sessionDir()
  const s = need(dir)
  if (flags.off) { patchSession(dir, { work: null }); return console.log('no working variant') }
  if (!args[0]) return console.log(s.work ? `working on ${s.work.proto}/${s.work.variant}` : 'no working variant')
  const t = target(dir, args[0])
  setWork(dir, t, typeof flags.ask === 'string' ? flags.ask.trim() : '')
  console.log(`working on ${t.proto}/${t.variant} · ${t.name}`)
}

function ask() {
  const dir = sessionDir()
  const s = need(dir)
  // --each: every quoted argument is one ask (a batch of comments in one call); else the words are one.
  const texts = (flags.each ? args.map(a => a.trim()) : [args.join(' ').trim()]).filter(Boolean)
  if (!texts.length) die('what did the user ask for? proto ask "…"   (several: proto ask --each "…" "…")')
  const t = flags.to ? target(dir, flags.to) : s.work
  if (!t) die('no working variant yet: proto work <slug>/<letter> --ask "…"')
  const key = `${t.proto}/${t.variant}`, at = new Date().toISOString()
  patchSession(dir, { asks: { ...s.asks, [key]: [...(s.asks?.[key] || []), ...texts.map(text => ({ at, text }))] } })
  console.log(`${key}: ${(s.asks?.[key]?.length || 0) + texts.length} asks`)
}

function archive() {
  const dir = sessionDir()
  need(dir)
  const metaFile = join(dir, 'src', 'protos', args[0] || '', 'meta.ts')
  if (!args[0] || !existsSync(metaFile)) die('which prototype? proto archive <slug>')
  const text = readFileSync(metaFile, 'utf8')
  const meta = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  meta.archived = !flags.off
  writeWhole(metaFile, withMeta(text, meta), scratchOf(dir))
  if (meta.archived && readSession(dir).work?.proto === args[0]) patchSession(dir, { work: null })
  const b = readSession(dir).building || {}
  if (meta.archived && Object.keys(b).some(k => k.startsWith(`${args[0]}/`))) patchSession(dir, { building: Object.fromEntries(Object.entries(b).filter(([k]) => !k.startsWith(`${args[0]}/`))) })
  console.log(`${args[0]} ${meta.archived ? 'archived' : 'restored'}`)
}

async function stop(dir = sessionDir(), reason = 'stopped') {
  const s = readSession(dir)
  if (!s) return
  if (alive(s.pid)) await kill(s.pid)
  if (s.tailnetPort && has('tailscale')) {
    const net = tailnet()
    if (net?.rules[s.tailnetPort] === s.port) run('tailscale', ['serve', `--https=${s.tailnetPort}`, 'off'])
  }
  patchSession(dir, { pid: null, stoppedAt: s.stoppedAt || new Date().toISOString(), stopReason: s.stopReason || reason })
}

async function rm(dir = sessionDir()) {
  if (!existsSync(dir)) return die(`nothing at ${tilde(dir)}`)
  await stop(dir, 'deleted')
  rmSync(dir, { recursive: true, force: true })
  forget(dir)
  const parent = dirname(dir)
  if (existsSync(parent) && readdirSync(parent).every(f => f === '.gitignore')) rmSync(parent, { recursive: true, force: true })
  console.log(`deleted ${tilde(dir)}`)
}

function lastEdit(dir) {
  let newest = Date.parse(readSession(dir)?.createdAt) || 0
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p) : (newest = Math.max(newest, statSync(p).mtimeMs)) } }
  try { walk(join(dir, 'src', 'protos')) } catch { /* none yet */ }
  return newest
}

// Deletes sessions untouched for DELETE_DAYS (unless kept) and drops tailnet rules that
// point at prototype ports nothing is serving any more. Idle servers stop themselves.
async function gc(quiet = false) {
  const now = Date.now()
  for (const dir of index()) {
    const s = readSession(dir)
    if (!s) { forget(dir); continue }
    const age = (now - lastEdit(dir)) / 864e5
    if (!s.keep && age > (s.deleteDays ?? DELETE_DAYS)) {
      await rm(dir)
      continue
    }
    if (s.pid && !alive(s.pid)) patchSession(dir, { pid: null, stoppedAt: s.stoppedAt || new Date().toISOString(), stopReason: s.stopReason || 'exited' })
  }
  const net = tailnet()
  if (net) {
    const live = new Set(index().map(readSession).filter(s => s && alive(s.pid)).map(s => s.port))
    for (const [tport, port] of Object.entries(net.rules)) {
      const ours = Number(tport) >= TAILNET_PORTS[0] && Number(tport) <= TAILNET_PORTS[1] && port >= LOCAL_PORTS[0] && port <= LOCAL_PORTS[1]
      if (ours && !live.has(port)) { run('tailscale', ['serve', `--https=${tport}`, 'off']); if (!quiet) console.log(`dropped leftover tailnet rule :${tport}`) }
    }
  }
  if (!quiet) console.log('gc done')
}

async function ls() {
  const rows = []
  for (const dir of index()) {
    const s = readSession(dir)
    if (!s) continue
    const days = ((Date.now() - lastEdit(dir)) / 864e5).toFixed(1)
    rows.push(`${await running(s) ? 'running' : 'stopped'}  ${s.name}  ${s.url || '-'}  last edit ${days}d ago${s.keep ? '  kept' : ''}\n  ${tilde(dir)}`)
  }
  console.log(rows.join('\n') || 'no prototype sessions')
}

async function shoot() {
  const dir = sessionDir()
  const s = need(dir)
  if (!await running(s)) die('the server is stopped. Run: proto up')
  const out = resolve(flags.out || join(dir, '.proto', 'shots'))
  const clicked = new Set(argv.filter((a, i) => argv[i - 1] === '--click'))
  let routes = args.filter(a => !clicked.has(a)).length ? args.filter(a => !clicked.has(a)) : ['']
  const extra = ['theme', 'focus', 'copy'].filter(k => flags[k]).map(k => `--${k}=${flags[k] === true ? '1' : flags[k]}`)
  if (flags.ref === true) die('--ref takes a screenshot of the real screen: --ref <png>')
  if (flags.ref && flags.sheet) die('--ref and --sheet are separate shots: run one, then the other')
  if (flags.state && !flags.sheet) die(`--state goes with --sheet; one variant in a state is proto shoot <slug>/<letter>/${flags.state === true ? '<state>' : flags.state}`)
  if (flags.ref) {
    // Relative to where Claude stands, or to the app (where `.proto/ref/` lives).
    const ref = [resolve(flags.ref), resolve(dir, flags.ref)].find(f => existsSync(f))
    if (!ref) die(`--ref: no file ${flags.ref} here or in ${tilde(dir)}`)
    extra.push(`--ref=${ref}`)
  }
  // The same sheet for the variant once it is built: the png is the real screen as built.
  if (flags.as !== undefined) {
    if (flags.as !== 'built') die('--as has one value: --as built')
    if (!flags.ref) die('--as built compares with a screenshot of the built screen: --ref <png> --as built')
    extra.push('--as=built')
  }
  // The motion of a variant that declares it (useMotion), recorded from rest as the page's dock does:
  // one moment of its take (--at 350), or n frames of it on one sheet (--frames 12), over a range of
  // it with --at 300-620.
  if (flags.at !== undefined || flags.frames !== undefined) {
    if (flags.sheet || flags.ref) die('--at and --frames shoot one variant\'s motion: not with --sheet or --ref')
    const at = String(flags.at ?? '').match(/^(\d+)(?:-(\d+))?$/)
    if (flags.at !== undefined && !at) die('--at is a moment of the take in ms (--at 350), or a range with --frames (--at 300-620)')
    if (at?.[2] !== undefined && +at[2] <= +at[1]) die(`--at ${flags.at}: a range ends after it starts`)
    const frames = flags.frames === undefined ? (at?.[2] !== undefined ? 6 : 0) : Number(flags.frames)
    if (flags.frames !== undefined && !(Number.isInteger(frames) && frames >= 2 && frames <= 24)) die('--frames is how many frames, 2 to 24: --frames 12')
    const bare = routes.find(r => r.split('/').filter(Boolean).length < 2)
    if (bare !== undefined) die(`--at and --frames shoot a variant: proto shoot <slug>/<letter> --frames 12 (not "${bare || 'the session'}")`)
    if (flags.at !== undefined) extra.push(`--at=${flags.at}`)
    if (frames) extra.push(`--frames=${frames}`)
  }
  // One viewport instead of desktop and phone (a layout a comment from the page's device view is about).
  if (flags.size !== undefined) {
    const m = String(flags.size).match(/^(\d+)x(\d+)$/)
    if (!m || +m[1] < 200 || +m[1] > 4000 || +m[2] < 200 || +m[2] > 4000) die('--size is a viewport in CSS px, 200 to 4000 each way: --size 834x1194')
    if (flags.sheet || flags.ref || flags.at !== undefined || flags.frames !== undefined) die('--size shoots single shots: not with --sheet, --ref, --at or --frames')
    extra.push(`--size=${m[1]}x${m[2]}`)
  }
  // --click can repeat: each selector is clicked in order before the shot.
  argv.forEach((a, i) => { if (a === '--click' && argv[i + 1]) extra.push(`--click=${argv[i + 1]}`); else if (a.startsWith('--click=')) extra.push(a) })
  // `--sheet hero` reads as the flag's value, so a string there is one more prototype. The list
  // goes to shoot.mjs in a file of this run's own, gone once it is done.
  const spec = flags.sheet && join(out, `.sheet-${process.pid}.json`)
  if (spec) {
    const sheets = sheetSpec(dir, [typeof flags.sheet === 'string' && flags.sheet, ...args.filter(a => !clicked.has(a))].filter(Boolean))
    routes = sheets.flatMap(p => p.columns.map(c => c.route))
    writeJson(spec, sheets)
    extra.push(`--sheet=${spec}`)
  }
  rtlCheck(dir, routes)
  const phones = new Set(routes.map(r => r.split('/')[0]).filter(slug => readMeta(dir, slug)?.kind === 'phone'))
  if (phones.size) extra.push(`--phone=${[...phones].join(',')}`)
  const r = run(process.execPath, [join(SKILL, 'scripts', 'shoot.mjs'), s.localUrl, out, ...routes.map(r => r || '/'), ...extra], { stdio: 'inherit' })
  if (spec) rmSync(spec, { force: true })
  process.exit(r.status ?? 1)
}

// --sheet: every variant of each prototype named, or of every one not archived when none is (an
// archived one still shoots when named). With --state, only the variants that have that state
// (its `only`), each shot in it. shoot.mjs shoots them as single shots, then composes one
// sheet per prototype from what this returns.
function sheetSpec(dir, slugs) {
  const root = join(dir, 'src', 'protos')
  if (flags.state === true) die('--state takes the id of a state in meta.ts: --state <id>')
  const stateOf = meta => flags.state ? (meta.states || []).find(x => x?.id === flags.state) : null
  if (!slugs.length) {
    try { slugs = readdirSync(root).filter(slug => { const m = readMeta(dir, slug); return m && !m.archived && (!flags.state || stateOf(m)) }) } catch { /* no prototypes yet */ }
    if (!slugs.length) die(flags.state ? `no prototype here has a state "${flags.state}"` : 'no prototypes to shoot yet: proto add <slug> …')
  }
  return [...new Set(slugs)].map(slug => {
    if (slug.includes('/')) die(`--sheet takes prototypes, not variants: proto shoot ${slug.split('/')[0]} --sheet`)
    const meta = readMeta(dir, slug) || die(`no prototype "${slug}" here`)
    const state = stateOf(meta)
    if (flags.state && !state) die(`${slug} has no state "${flags.state}" (${(meta.states || []).map(x => x?.id).join(', ') || 'its meta.ts lists none'})`)
    // The variants the page shows: the files named by a letter, in the page's order.
    const ids = [...new Set(readdirSync(join(root, slug)).map(f => f.match(/^([A-Z]{1,2})\.(?:tsx|jsx|vue|svelte)$/)?.[1]).filter(Boolean))]
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
      .filter(id => !state?.only?.length || state.only.includes(id))
    if (!ids.length) die(`${slug} has no variants${state ? ` with the state "${state.id}"` : ''} to shoot`)
    return {
      name: `${slug}${state ? `-${state.id}` : ''}-sheet`, title: meta.title || slug, note: state ? `state: ${state.name || state.id}` : '', picked: meta.picked || '',
      columns: ids.map(id => ({ route: [slug, id, state?.id].filter(Boolean).join('/'), id, name: meta.variants?.[id] || id })),
    }
  })
}

// A right-to-left prototype placed with left and right breaks the moment it mirrors (and a
// copy of it inherits the break), so `shoot` lists every physical side it finds. Two kinds are
// are fine and skipped: anything nested under a `dir="ltr"` element (a clock, a status bar) and
// centring (`left-1/2 -translate-x-1/2`). So is a side chosen per direction (`rtl:…`, `ltr:…`).
const PHYSICAL = new RegExp([
  String.raw`(?<![\w-])-?(?:m[lr]|p[lr]|left|right|scroll-m[lr]|scroll-p[lr])-[\w.\[\]/%-]+`,
  String.raw`(?<![\w-])(?:text|float|clear)-(?:left|right)\b`,
  String.raw`(?<![\w-])(?:border|rounded)-(?:[lr]|[tb][lr])(?:-[\w.\[\]/%-]+)?(?![\w-])`,
  String.raw`(?<![\w-])(?:bg-gradient|bg-linear)-to-(?:[lr]|[tb][lr])\b`,
  String.raw`\b(?:margin|padding|border)(?:Left|Right)\b\s*:`,
  String.raw`(?<![\w-])(?:left|right)\s*:\s*[-\d'"\`]`,
  String.raw`(?<![\w-])(?:margin|padding|border)-(?:left|right)\s*:`,
  String.raw`linear-gradient\(\s*to (?:left|right)`,
  String.raw`(?<![\w-])-?translate-x-[\w.\[\]/%-]+`,
  String.raw`translateX\(`,
  String.raw`(?<![\w-])(?:origin|bg|object)-(?:left|right|top-left|top-right|bottom-left|bottom-right)\b`,
  String.raw`(?:transformOrigin|backgroundPosition|objectPosition)\s*:\s*['"\`][^'"\`]*\b(?:left|right)\b`,
].join('|'), 'g')

function rtlCheck(dir, routes) {
  for (const slug of new Set(routes.map(r => r.split('/')[0]).filter(Boolean))) {
    const pdir = join(dir, 'src', 'protos', slug)
    if (!existsSync(pdir)) continue
    const files = readdirSync(pdir).filter(f => /\.(tsx|jsx|vue|ts|css)$/.test(f) && f !== 'meta.ts')
    const texts = files.map(f => readFileSync(join(pdir, f), 'utf8'))
    if (!texts.some(t => /dir=["'{]+rtl/.test(t))) continue
    const hits = []
    files.forEach((f, i) => {
      // Lines nested under an element marked dir="ltr" (deeper indent) are an island: skipped.
      let island = -1
      texts[i].split('\n').forEach((line, n) => {
      const indent = line.search(/\S/)
      if (island >= 0 && indent > island) return
      island = /dir=["'{]+ltr/.test(line) ? indent : -1
      if (island >= 0) return
      const bare = line.replace(/(?:rtl|ltr):[^\s"'`]+/g, '').replace(/left-1\/2(?=[^"'`]*-translate-x-1\/2)([^"'`]*)-translate-x-1\/2/g, '$1').replace(/(?<![\w-])translate-x-0(?![\w.])/g, '')
      const found = [...bare.matchAll(PHYSICAL)].map(m => m[0].trim())
      if (found.length) hits.push(`  ${f}:${n + 1}  ${found.join(' ')}`)
      })
    })
    if (hits.length) console.error(`rtl: ${slug} is right to left; physical sides to check (start/end unless inside a dir="ltr" island):\n${hits.slice(0, 15).join('\n')}${hits.length > 15 ? `\n  … ${hits.length - 15} more` : ''}`)
  }
}

// ---------- handoff ----------
// A variant built into the codebase loses what nobody listed (a drag's tilt, a shade behind a
// sheet, a spring), so `handoff` lists what the variant has as lines to tick, each with where it
// is. It reads the files alone: the same files print the same list, with the server up or not.
const SOURCE = /\.(?:tsx?|jsx?|vue|css)$/
// The variant's file, then what it imports from its folder (`./parts`), followed from file to file.
// A variant built from others imports their files too (`../today-card/shared`), so any file under
// src/protos counts; what is outside (`../../hints`, `@project/…`) is not the variant's code.
function variantFiles(protos, first) {
  const files = [{ file: first }]
  for (let i = 0; i < files.length; i++) {
    for (const m of readFileSync(files[i].file, 'utf8').matchAll(/\b(?:import|export)\s+(type\s+)?[^'";]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      // A type draws nothing: `import type { CardState } from '../week-cards/board'` brings no code.
      if (m[1]) continue
      const base = resolve(dirname(files[i].file), m[2] ?? m[3])
      const f = [base, ...['tsx', 'ts', 'jsx', 'js', 'vue', 'css'].map(x => `${base}.${x}`), ...['tsx', 'ts', 'jsx', 'js'].map(x => join(base, `index.${x}`))]
        .find(x => SOURCE.test(x) && existsSync(x) && statSync(x).isFile())
      if (f && !relative(protos, f).startsWith('..') && basename(f) !== 'meta.ts' && !files.some(x => x.file === f)) files.push({ file: f, by: files[i].file })
    }
  }
  return files
}

// A line's code without its comments, and what ends a block comment still open at its end (or
// null). A `/*`, `//` or `<!--` inside a string is part of it ('./icons/*.svg', 'https://…'), so
// the line's quotes are followed; a quote after a letter (don't, ק"ג) opens no string. `//`
// starts a comment only at the line's start or after a space, so a URL in JSX text stays.
function uncomment(line, until) {
  let out = '', quote = '', i = 0
  while (i < line.length) {
    if (until) {
      const end = line.indexOf(until, i)
      if (end < 0) return { code: out, until }
      i = end + until.length
      // A JSX comment, `{/* … */}`, goes with its braces.
      if (until === '*/' && line[i] === '}' && /\{\s*$/.test(out)) { out = out.replace(/\{\s*$/, ''); i++ }
      until = null
      continue
    }
    const c = line[i]
    if (quote) {
      const step = c === '\\' ? 2 : 1
      if (c === quote) quote = ''
      out += line.slice(i, i + step)
      i += step
      continue
    }
    if (c === '`' || ((c === '"' || c === '\'') && !/[\p{L}\p{N}]/u.test(line[i - 1] || ''))) quote = c
    else if (line.startsWith('/*', i)) { until = '*/'; i += 2; continue }
    else if (line.startsWith('<!--', i)) { until = '-->'; i += 4; continue }
    else if (line.startsWith('//', i) && (i === 0 || /\s/.test(line[i - 1]))) break
    out += c
    i++
  }
  // A comment opened at the line's very end, or a blank line inside one, carries on.
  return { code: out, until }
}

// A file's lines without their comments (a class or a word in a comment is not in the design),
// each saying whether it is CSS and whether its text is shown: a .vue file shows its <template>
// and styles in its <style>, a .tsx shows all of it, and a .ts helper shows nothing.
function sourceLines(f) {
  const kind = f.endsWith('.css') ? 'css' : f.endsWith('.vue') ? 'vue' : /\.[jt]sx$/.test(f) ? 'jsx' : 'script'
  let block = null, until = null
  return readFileSync(f, 'utf8').split(/\r?\n/).map((raw, i) => {
    if (kind === 'vue' && /^<(template|script|style)\b/.test(raw)) block = raw.match(/^<(\w+)/)[1]
    const { code: line, until: open } = uncomment(raw, until)
    until = open
    const at = { n: i + 1, line, css: kind === 'css' || block === 'style', shown: kind === 'jsx' || block === 'template' }
    if (kind === 'vue' && /^<\/(template|script|style)>/.test(raw)) block = null
    return at
  })
}

// The value that starts `s`: a quoted string or a bracketed group whole, else up to a top-level
// `;` (or `,`, which ends a property in a script but separates transitions in CSS).
function grab(s, css) {
  if (/^['"`]/.test(s)) { const end = s.indexOf(s[0], 1); return end < 0 ? `${s}…` : s.slice(0, end + 1) }
  const group = /^[([{]/.test(s)
  let depth = 0, i = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c) && --depth < 0) break
    else if (!depth && (c === ';' || (c === ',' && !css))) break
    if (group && !depth) { i++; break }
  }
  return `${s.slice(0, i).trim()}${group && depth > 0 ? '…' : ''}`
}
const valueAfter = (line, m, css) => grab(line.slice(m.index + m[0].length), css)
const each = (line, re, f = m => m[0]) => [...line.matchAll(re)].map(f)
// `prop: value` from CSS (`transition: opacity .2s;`) or a style object (`boxShadow: '0 1px …',`).
const decls = (line, re, css) => each(line, re, m => `${m[1]}: ${valueAfter(line, m, css).replace(/^(['"`])(.*)\1$/, '$2')}`)
// Text and code, told apart by what is in them: a line of text has letters and none of these.
const PROSE = /^(?![?:|&.+*/,!#@-])(?!(?:return|else|break|continue|default|case|try|finally|do|import|export|const|let|var|type|interface|function|async|await|as|extends|from|new|throw)\b)[^<>{}=;()[\]`]*\p{L}[^<>{}=;()[\]`]*$/u
// Code that still looks like text: an arrow, a condition, an assignment, a ternary, a call, a
// template string, a chain of properties (`d.kpis.churn`), or a type (`as const satisfies …`).
const CODE = /=>|&&|\|\||[=;`]|\s[?:]\s*$|\s\?\s|\s:\s|[\w$]\(|[a-z_$][\w$]*\.[a-z_$][\w$]+\.[a-z_$]|\bas const\b|\bsatisfies\b/
// A comparison (`n > 0) return`, `v-if="n > 3"`) leaves a paren or a quote without its pair.
const paired = s => (s.match(/\(/g) || []).length === (s.match(/\)/g) || []).length && (s.match(/"/g) || []).length % 2 === 0
// Props whose words are not shown: classes, styles, drawing, links, and the browser's own.
const NOT_COPY = /^(?:className|class|style|d|viewBox|points|transform|href|src|srcSet|sizes|type|role|id|key|ref|name|htmlFor|for|dir|lang|rel|target|xmlns|fill|stroke|accept|pattern|autoComplete|inputMode|aria-.*|data-.*|v-.*)$/
// The classes of a className that spans lines have no code in them either, but every word has a
// dash, a colon, a slash or a bracket, or is one of Tailwind's bare words.
const CLASSY = /[-:/[\]]|^(?:flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|truncate|transition|shadow|blur|border|rounded|ring|outline|grow|shrink|isolate|group|peer|italic|underline|uppercase|invisible|antialiased)$/
const classy = s => s.trim().split(/\s+/).every(w => CLASSY.test(w))
// A line that is all text (a sentence on its own line, `{name}` or `{{ n }}` in it read as …), or ''.
// A type's member (`label: string`, `Default: string`) is code.
function textLine(line) {
  const t = line.trim().replace(/\{\{.*?\}\}|\{[^{}]*\}/g, '…')
  const code = CODE.test(t) || /^['"]|,$/.test(t) || /^[a-z_$][\w$.-]*$/.test(t) || /^[a-z_$][\w$]*\??:\s|^[A-Z][\w$]*\??:\s*\S*$/.test(t)
  return PROSE.test(t) && !code && !classy(t) ? t : ''
}
// A line's class-like words, each with its variants (hover:, md:, data-[open]:) and without them.
// Text is left out first (between tags, strings that read as prose, a line of text), so "a soft
// shadow" in the copy isn't a shadow.
const classPart = line => textLine(line) ? '' : line.replace(/(?<![=-])>[^<>{}]*(?=<)/g, '>')
  .replace(/(['"`])((?:(?!\1).)*)\1/g, (q, _, s) => /(?:^|\s)[A-Z\u00c0-\uffff]|[,.?](?:\s|$)/.test(s.replace(/\$\{[^}]*\}/g, '')) ? '""' : q)
const words = line => classPart(line).split(/[\s'"`{}<>;]+/).filter(Boolean).map(w => [w, w.replace(/^(?:(?:[\w@/-]*\[[^\]]*\][\w/-]*|[\w@/-]+):)+/, '').replace(/^!|!$/g, '')])
// The tag an attribute sits on: on its line, or a few lines up when the tag spans lines.
function tagOf(lines, i, upTo) {
  for (let j = i, text = lines[i].line.slice(0, upTo); j >= Math.max(0, i - 8); text = lines[--j]?.line ?? '') {
    const tags = [...text.matchAll(/<([A-Za-z][\w.:-]*)/g)]
    if (tags.length) return tags.at(-1)[1]
  }
  return ''
}

const MOTION_LIBS = /\b(?:from|import)\s*\(?\s*['"](framer-motion|motion(?:\/[\w-]+)?|@react-spring\/[\w-]+|react-spring|gsap(?:\/[\w-]+)?|@gsap\/[\w-]+|animejs|@formkit\/auto-animate(?:\/[\w-]+)?|@vueuse\/motion|@motionone\/[\w-]+|popmotion|react-transition-group)['"]/g
const GESTURE_LIBS = /\b(?:from|import)\s*\(?\s*['"](@dnd-kit\/[\w-]+|@use-gesture\/[\w-]+|react-dnd[\w-]*|sortablejs|vuedraggable|vue-draggable-plus)['"]/g
const MATERIAL = /^(?:backdrop-[\w[]|bg-(?:gradient|linear|radial|conic)(?:-|$)|(?:inset-|text-|drop-)?shadow(?:-|$)|(?:mix|bg)-blend-|blur(?:-|$)|bg-(?:[\w.-]+|\[[^\]]*\])\/(?:[\d.]+|\[[^\]]*\])$)/
// What each group finds on a line, as short tokens. A token inside another on the same line (the
// cubic-bezier in a transition) is dropped, and the line's tokens together are one finding.
const FIND = {
  mark: (line, css, lines, i) => each(line, /(?<![\w[-])(?::|v-bind:)?data-(?:shoot|diff)\b(?:\s*=\s*)?/g, m => {
    const attr = m[0].replace(/\s/g, '') + (m[0].includes('=') ? valueAfter(line, m) : '')
    const tag = tagOf(lines, i, m.index)
    return tag ? `<${tag} ${attr}>` : attr
  }),
  motion: (line, css) => [
    ...words(line).filter(([w, b]) => /^-?(?:transition(?:-|$)|(?:duration|ease|delay|animate)-)/.test(b) || /(?:^|:)(?:starting|motion-safe|motion-reduce):/.test(w)).map(([w]) => w),
    ...decls(line, /(?<![\w-])((?:transition|animation)(?:-[a-z-]+|[A-Z][A-Za-z]*)?)\s*:\s*/g, css),
    ...each(line, /@keyframes\s+[\w-]+|cubic-bezier\([^)]*\)|\brequestAnimationFrame\b|\btype\s*:\s*['"]spring['"]|\b(?:stiffness|damping|mass|bounce|visualDuration)\s*:\s*[\d.]+|\buse(?:Spring|Springs|SpringValue|Trail|Animate|AnimationControls)\b|(?<![\w-])v-motion[\w-]*/g),
    ...each(line, /<(?:motion\.\w+|AnimatePresence|LayoutGroup|Reorder\.\w+|Transition|TransitionGroup|CSSTransition)\b[^>]*>?/g),
    ...each(line, /[\w$.\])]*\.animate\(/g, m => `${m[0]}…)`),
    ...each(line, /(?<![\w-])(?:initial|animate|exit|transition|variants|whileHover|whileTap|whileDrag|whileFocus|whileInView|layoutId)=(?=\{)/g, m => m[0] + valueAfter(line, m)),
    ...each(line, MOTION_LIBS, m => `import '${m[1]}'`),
  ],
  material: (line, css) => {
    const ws = words(line), found = ws.filter(([, b]) => MATERIAL.test(b)).map(([w]) => w)
    // Gradient stops count only beside a gradient, so a "to-do" in the copy isn't one.
    const stops = found.some(w => /(?:^|:)bg-(?:gradient|linear|radial|conic)/.test(w)) ? ws.filter(([, b]) => /^(?:from|via|to)-/.test(b)).map(([w]) => w) : []
    return [
      ...found, ...stops,
      ...decls(line, /(?<![\w-])(-webkit-backdrop-filter|backdrop-filter|WebkitBackdropFilter|backdropFilter|box-shadow|boxShadow|text-shadow|textShadow|mix-blend-mode|mixBlendMode|filter)\s*:\s*/g, css).filter(d => !d.startsWith('filter:') || d.includes('(')),
      // Colors only when they let something through (an alpha), and gradients.
      ...each(line, /(?<![a-zA-Z-])(?:(?:repeating-)?(?:linear|radial|conic)-gradient|rgba|hsla|rgb|hsl|oklab|oklch|lab|lch|hwb|color-mix)(?=\()/g, m => m[0] + valueAfter(line, m)).filter(c => /gradient|^(?:rgba|hsla|color-mix)|\//.test(c)),
      ...each(line, /#[0-9a-fA-F]{8}\b/g),
    ]
  },
  interaction: line => [
    ...each(line, /(?<![\w.$])on(?:Click|DoubleClick|ContextMenu|Pointer\w*|Mouse\w*|Drag\w*|Drop|Key\w*|Scroll|Wheel|Touch\w*|Input|Change|Submit)\s*=\s*(?=[{'"])|(?:(?<![\w@-])@|(?<![\w-])v-on:)(?:click|dblclick|contextmenu|pointer\w*|mouse\w*|drag\w*|drop|key\w*|scroll|wheel|touch\w*|input|change|submit)(?:\.[\w-]+)*\s*=\s*|(?<![\w-])v-model(?:[:.][\w-]+)*\s*=\s*/g, m => m[0].replace(/\s/g, '') + valueAfter(line, m)),
    ...each(line, /(?<![\w-])draggable\b(?:\s*=\s*)?/g, m => m[0].includes('=') ? `draggable=${valueAfter(line, m)}` : 'draggable'),
    ...each(line, /\baddEventListener\(\s*['"`]([\w-]+)['"`]/g, m => `addEventListener('${m[1]}')`),
    ...each(line, GESTURE_LIBS, m => `import '${m[1]}'`),
  ],
  asset: line => [
    ...each(line, /(?<=['"(]\s*)@project\/[^'"()\s]+/g),
    ...each(line, /\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+\.(?!(?:tsx?|jsx?|vue|css)['"])\w+)['"]/g, m => m[1]),
  ],
}

// Text a user reads: between tags (prices and times too), `{'…'}` children, placeholder, label,
// title and alt, a string prop that reads as words (`detail="The full workout"`), and a line that
// is all text.
function copyIn(line) {
  const out = []
  const keep = s => { s = s.replace(/\s+/g, ' ').trim(); if (/[\p{L}\p{N}]/u.test(s) && paired(s)) out.push(s) }
  const whole = textLine(line)
  if (whole) { keep(whole); return out }
  for (const m of line.matchAll(/(?<![=-])>([^<>{}]+)(?=<|\{)|\}([^<>{}]+)(?=<)/g)) { const s = m[1] ?? m[2]; if (!CODE.test(s)) keep(s) }
  const tail = line.match(/(?<![=-])>([^<>{}]+)$/)
  if (tail && PROSE.test(tail[1].trim()) && !CODE.test(tail[1])) keep(tail[1])
  for (const m of line.matchAll(/(?<!=\s*)\{\s*(['"`])([^'"`${}]*\p{L}[^'"`${}]*)\1\s*\}/gu)) if (!classy(m[2])) keep(m[2])
  // Written `name="…"` with nothing around the `=`, as attributes are; `const x = '…'` is not one.
  // A custom prop that takes classes (`c="size-4 text-zinc-400"`) is not copy either.
  for (const m of line.matchAll(/(?<![\w:@.-])([a-zA-Z][\w-]*)=(['"])([^'"]*\p{L}[^'"]*)\2/gu)) {
    if (/^(?:placeholder|aria-label|label|title|alt)$/.test(m[1]) || (/\s|[^\x00-\x7f]/.test(m[3]) && !NOT_COPY.test(m[1]) && !classy(m[3]))) keep(m[3])
  }
  return out
}

// The lines a variant offers copy options for (useCopy): where each call is, and each line's id,
// label, first option (what the build ships) and number of options. Read from the call's own text,
// or from the list it names when that is declared in the variant's files (`const LINES = [ … ]`),
// with the keys in any order.
function copyOptionsIn(files) {
  // A quote opens a string unless it follows a letter: in code a string never does, while words in
  // JSX do (Don't).
  const opens = (text, i) => text[i] === '`' || ((text[i] === '"' || text[i] === '\'') && !/[\p{L}\p{N}]/u.test(text[i - 1] || ''))
  // The file with its comments blanked out, at the same length and on the same lines: a quote in a
  // comment ("the user's headline") opens no string, and nothing in one is read as code. A comment
  // starts only where code can: at a line's start, or after a space or one of ,;{}()[]= (so
  // `<code>src/*.ts</code>` or a URL in JSX words starts none).
  const blank = text => {
    let out = '', quote = ''
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (quote) { out += c; if (c === '\\') out += text[++i] ?? ''; else if (c === quote) quote = ''; continue }
      if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*') && (i === 0 || /[\s,;{}()[\]=]/.test(text[i - 1]))) {
        const line = text[i + 1] === '/', e = line ? text.indexOf('\n', i) : text.indexOf('*/', i + 2)
        const to = e < 0 ? text.length : line ? e : e + 2
        out += text.slice(i, to).replace(/[^\n]/g, ' ')
        i = to - 1
        continue
      }
      if (opens(text, i)) quote = c
      out += c
    }
    return out
  }
  const texts = files.map(f => ({ f, text: blank(readFileSync(f, 'utf8')) }))
  const calls = [], lines = []
  const lineAt = (text, i) => text.slice(0, i).split('\n').length
  // From an opening bracket, the index of the one that closes it; brackets inside strings don't count.
  const close = (text, from) => {
    let depth = 0, quote = '', i = from
    for (; i < text.length; i++) {
      const c = text[i]
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue }
      if (opens(text, i)) quote = c
      else if ('([{'.includes(c)) depth++
      else if (')]}'.includes(c) && --depth === 0) break
    }
    return i
  }
  // The entries of a list or object literal, from its opening bracket: where each starts (past its
  // spaces) and ends, split at the commas outside brackets and strings.
  const parts = (text, open) => {
    const end = close(text, open), out = []
    let depth = 0, quote = '', start = open + 1
    for (let i = open + 1; i < end; i++) {
      const c = text[i]
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue }
      if (opens(text, i)) quote = c
      else if ('([{'.includes(c)) depth++
      else if (')]}'.includes(c)) depth--
      else if (c === ',' && !depth) { out.push([start, i]); start = i + 1 }
    }
    out.push([start, end])
    return out.flatMap(([a, b]) => { const lead = text.slice(a, b).search(/\S/); return lead < 0 ? [] : [[a + lead, b]] })
  }
  const STR = String.raw`(['"\`])((?:\\.|(?!\1)[^\\])*)\1`
  // A string literal's words, with its escapes read: 'It\'s' is It's.
  const ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }
  const literal = v => new RegExp(String.raw`^${STR}\s*$`).exec(v)?.[2]
    .replace(/\\(u\{[\da-f]+\}|u[\da-f]{4}|x[\da-f]{2}|[\s\S])/gi, (_, e) => e.length > 1 ? String.fromCodePoint(parseInt(e.replace(/[ux{}]/gi, ''), 16)) : ESC[e] ?? e)
  // Each { id, label, options } of a list, from its opening bracket. The words may hold any
  // bracket ("Hi {name}"): each object and list ends where its own bracket closes.
  const objects = ({ f, text }, open) => {
    for (const [o] of parts(text, open)) {
      if (text[o] !== '{') continue
      const props = {}
      for (const [a, b] of parts(text, o)) {
        const m = text.slice(a, b).match(/^['"]?([\w$]+)['"]?\s*:\s*/)
        if (m) props[m[1]] = { at: a, value: text.slice(a + m[0].length, b) }
      }
      const id = props.id && literal(props.id.value), list = props.options?.value
      const options = list?.startsWith('[') ? parts(list, 0).map(([a, b]) => literal(list.slice(a, b))).filter(x => x !== undefined) : []
      if (id && options.length) lines.push({ f, id, label: (props.label && literal(props.label.value)) || id, first: options[0], n: options.length, line: lineAt(text, props.id.at) })
    }
  }
  for (const t of texts) {
    for (const m of t.text.matchAll(/\buseCopy\s*\(/g)) {
      const open = m.index + m[0].length - 1, end = close(t.text, open)
      calls.push({ f: t.f, line: lineAt(t.text, m.index) })
      const arg = t.text.slice(open + 1, end).trim().replace(/^\(\s*\)\s*=>\s*/, '')
      if (!/^[A-Za-z_$][\w$]*$/.test(arg)) { const at = t.text.indexOf('[', open); if (at > open && at < end) objects(t, at); continue }
      for (const u of texts) {
        const d = u.text.match(new RegExp(String.raw`\b(?:const|let|var)\s+${arg.replace(/\$/g, '\\$')}\b[^=;]*=\s*\[`))
        if (d) { objects(u, d.index + d[0].length - 1); break }
      }
    }
  }
  return { calls, lines }
}

function handoff() {
  const dir = sessionDir()
  const s = need(dir)
  const t = target(dir, args[0])
  const meta = readMeta(dir, t.proto)
  const pdir = join(dir, 'src', 'protos', t.proto)
  const file = [STACKS[s.stack]?.ext, 'tsx', 'jsx', 'vue'].filter(Boolean).map(x => join(pdir, `${t.variant}.${x}`)).find(f => existsSync(f))
  if (!file) die(`${t.proto}/${t.variant} has no file in ${tilde(pdir)}`)
  const files = variantFiles(join(dir, 'src', 'protos'), file)
  const rel = f => relative(pdir, f).split(sep).join('/')
  // Each finding once, with every place it is: the same classes on twelve lines are one line to tick.
  const found = { mark: new Map(), motion: new Map(), material: new Map(), interaction: new Map(), asset: new Map(), copy: new Map(), hints: new Map(), review: new Map() }
  const note = (group, tokens, f, n) => {
    const key = tokens.join('\n'), g = found[group]
    if (!g.has(key)) g.set(key, { tokens, at: new Map() })
    const at = g.get(key).at, ns = at.get(f) || []
    if (ns.at(-1) !== n) at.set(f, [...ns, n])
  }
  for (const { file: f } of files) {
    const lines = sourceLines(f)
    lines.forEach(({ n, line, css, shown }, i) => {
      if (!line.trim()) return
      for (const [group, find] of Object.entries(FIND)) {
        const tokens = [...new Set(find(line, css, lines, i).map(x => x.replace(/\s+/g, ' ').replace(/`/g, '\'').trim()).filter(Boolean))]
        const kept = tokens.filter(x => !tokens.some(y => y !== x && y.includes(x))).map(x => x.length > 80 ? `${x.slice(0, 79)}…` : x)
        if (kept.length) note(group, kept, rel(f), n)
      }
      if (shown) copyIn(line).forEach(text => note('copy', [text.length > 80 ? `${text.slice(0, 79)}…` : text], rel(f), n))
      if (/\buseHints\s*\(/.test(line)) note('hints', ['useHints'], rel(f), n)
      if (/\buseMotion\s*\(/.test(line)) note('review', ['useMotion'], rel(f), n)
    })
  }

  const code = x => `\`${x}\``
  const where = at => [...at].map(([f, ns]) => `${f}:${ns.slice(0, 12).join(', ')}${ns.length > 12 ? ` +${ns.length - 12}` : ''}`).join(' · ')
  const items = group => [...found[group].values()].map(({ tokens, at }) => `${tokens.map(code).join(' ')} · ${where(at)}`)
  const out = [`# Handoff: ${meta.title || t.proto} › ${t.variant} · ${t.name}`, '']
  if (meta.ask) out.push(`- Asked: "${meta.ask}"`)
  if (meta.about?.[t.variant]) out.push(`- About ${t.variant}: ${meta.about[t.variant]}`)
  const [w, h] = meta.screen || [393, 852]
  if (meta.kind === 'phone') out.push(`- Phone screen: ${w}×${h} pt (${w * 3}×${h * 3} px at 3x)`)
  if (meta.picked) out.push(meta.picked === t.variant ? `- The user picked ${t.variant}` : `- The user picked ${meta.picked}, not ${t.variant}`)
  const section = (title, list) => { if (list.length) out.push('', `## ${title}`, ...list.map(x => `- [ ] ${x}`)) }

  section('Files', files.map(x => `${x.file}${x.by ? ` (imported by ${rel(x.by)})` : ''}`))
  // The states this variant has, with its own note where it has one, else the first variant's.
  const first = Object.keys(meta.variants || {}).sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
  const states = (Array.isArray(meta.states) ? meta.states : []).filter(x => x?.id && Array.isArray(x.click) && (!x.only?.length || x.only.includes(t.variant)))
  section('States', states.map(x => {
    const said = x.about?.[t.variant] || x.about?.[first]
    return `${x.name || x.id} (${code(`${t.proto}/${t.variant}/${x.id}`)})${said ? `: ${said}` : ''} · click ${x.click.map(code).join(' then ')}`
  }))
  section('Marked elements', items('mark'))
  section('Motion', items('motion'))
  section('Materials', items('material'))
  section('Interactions', items('interaction'))
  section(`Assets (@project/ is ${s.project})`, items('asset'))
  // Copy is the longest list and the least likely to be lost, so it stops at 30.
  const copy = [...found.copy.values()].map(({ tokens, at }) => `"${tokens[0]}" · ${where(at)}`)
  section('Copy', copy.length > 30 ? [...copy.slice(0, 30), `… ${copy.length - 30} more, in the files above`] : copy)
  section('Try it', [...found.hints.values()].map(({ at }) => `Its Try it list (${code('useHints')}) · ${where(at)}: every value, scenario and thing to try works in the build too`))
  // Copy options are for choosing in the page: the build ships each line's first option as its copy.
  const offered = copyOptionsIn(files.map(x => x.file))
  section('Copy options', [
    ...offered.lines.map(x => `${x.label} (${code(x.id)}) ships "${x.first}"${x.n > 1 ? `, not its ${x.n - 1} other option${x.n === 2 ? '' : 's'}` : ''} · ${rel(x.f)}:${x.line}`),
    ...offered.calls.length ? [`${code('useCopy')} · ${offered.calls.map(x => `${rel(x.f)}:${x.line}`).join(', ')}: the build ships each line's first option as plain copy; the options and the page's picker stay in the prototype`] : [],
  ])
  section('Motion review', [...found.review.values()].map(({ at }) => `Its motion dock (${code('useMotion')}) · ${where(at)}: the page's alone, so the build drops it; the motion it reviewed (Motion above) is what ships, its timings and easings as they are`))
  const route = `${t.proto}/${t.variant}`, ref = x => `.proto/ref/${t.proto}/built-${t.variant}${x ? `-${x}` : ''}.png`
  section('Then', [
    'Build it with the project\'s own components and patterns: the variant shows what to build, its code is not the code to ship',
    `Screenshot the built screen (${meta.kind === 'phone' ? `the phone at ${w}×${h} pt, 3x` : 'a browser 1440 wide'}) to ${join(dir, ref())}`,
    `${code(`proto shoot ${route} --ref ${ref()} --as built`)}, read ${t.proto}-${t.variant}-vs-built.png and fix until the overlay shows no double edges`,
    ...states.map(x => `${x.name || x.id}, built: screenshot it to ${ref(x.id)}, then ${code(`proto shoot ${route}/${x.id} --ref ${ref(x.id)} --as built`)}`),
    'Tick each line above once the build has it, or say why it doesn\'t apply',
  ])
  console.log(out.join('\n'))
}

// ---------- the inbox ----------
// Comments sent from the page land in the app's .proto/inbox/new/<batch>/ (the server writes
// them whole). Taking a batch moves it to taken/, so it is handed out once. `--wait` is meant to
// run in the background: it exits when a batch arrives, which wakes the agent.
const inboxDir = dir => join(dir, '.proto', 'inbox')
const batchesIn = (dir, sub) => { try { return readdirSync(join(inboxDir(dir), sub)).filter(f => !f.startsWith('.')).sort() } catch { return [] } }
const waiterFile = dir => join(inboxDir(dir), 'waiter.json')

// A batch that can't be taken or read is said so (on stderr), never skipped without a word, and
// once: `--wait` takes again every few seconds and would say it each time.
const told = new Set()
const tell = (id, what) => { if (!told.has(id)) { told.add(id); console.error(`batch ${id} ${what}`) } }
function take(dir) {
  const taken = []
  mkdirSync(join(inboxDir(dir), 'taken'), { recursive: true })
  for (const id of batchesIn(dir, 'new')) {
    const from = join(inboxDir(dir), 'new', id)
    try { moveDir(from, join(inboxDir(dir), 'taken', id)) } catch (e) { if (existsSync(from)) tell(id, `could not be taken (${e?.code ?? e?.message ?? e})`); continue /* else another reader took it */ }
    const b = readJson(join(inboxDir(dir), 'taken', id, 'batch.json'), null)
    if (b) taken.push(b)
    else tell(id, 'was taken, but its batch.json could not be read')
  }
  return taken
}

// An element as the agent reads it: what it is, where it sits, and where it is written, the file
// from the app's folder with its line and the component (`src/protos/today/parts.tsx:30 (PriceCard)`).
const where = e => {
  if (!e) return ''
  const name = e.shoot ? `[data-shoot=${e.shoot}]` : e.selector || ''
  const r = e.rect ? ` at ${e.rect.x},${e.rect.y} ${e.rect.w}x${e.rect.h}` : ''
  const code = e.src ? `  src/protos/${e.src}${e.component ? ` (${e.component})` : ''}` : ''
  return [`<${e.tag || '?'}>`, e.text && `"${e.text.replace(/\s+/g, ' ').slice(0, 80)}"`, name].filter(Boolean).join(' ') + r + code
}
// A decision made on a variant in the page comes as a comment with an action and no element; the
// line under it says what is already done and what is left for the agent. A pick or unpick is made
// by the server as it arrives, so it comes done (a reply is only a note), unless it failed or, for
// an unpick, there was no pick there to take back.
const ACTIONS = {
  pick: 'done: marked in the page and now the working variant; a reply is only a note',
  unpick: 'done: the pick is off in the page; a reply is only a note',
  more: 'new variants in this prototype, named after this one',
  build: 'build this variant into the codebase',
  'try-it': 'add useHints for this variant only: useful demo values, steps and scenarios; preserve the working design; reply --done after checking it',
  'copy-options': 'add useCopy for this variant only: headline and primary text by default, or the requested lines; keep current words first, add 2 to 4 alternatives; reply --done after checking fit',
  copy: 'make this the line\'s text in the variant: put it first in that line\'s useCopy options',
}
const FAILED = {
  // Marked: meta.ts has the pick and only the working variant didn't move; proto pick does both and
  // changes nothing that is already so.
  pick: (c, why) => c.marked ? `marked in the page, but the working variant didn't move (${why}): run proto pick ${c.route.replace('/', ' ')}` : `not marked (${why}): run proto pick ${c.route.replace('/', ' ')}`,
  unpick: (c, why) => c.nothing ? `nothing changed: ${c.route.split('/')[1]} wasn't the pick, so there was nothing to take back; tell the user` : `not taken off (${why}): run proto pick ${c.route.split('/')[0]} --off`,
}
const secs = ms => `${(ms / 1000).toFixed(2)} s`
const spanOf = c => c.to === undefined ? secs(c.at) : `${(c.at / 1000).toFixed(2)}–${secs(c.to)}`
// The source around where a commented element is written (its src, `today/parts.tsx:30`), so a batch
// can be acted on without opening each file first. Measured on a 12-comment batch: the comments
// were done in 48 s, two of the tool calls in it only reading these lines.
const SNIP = 5
function printSource(dir, src) {
  const m = String(src).match(/^(.*):(\d+)$/)
  if (!m) return
  let lines
  try { lines = readFileSync(join(dir, 'src', 'protos', m[1]), 'utf8').split(/\r?\n/) } catch { return }
  const at = Number(m[2]), from = Math.max(1, at - SNIP), to = Math.min(lines.length, at + SNIP)
  const w = String(to).length
  for (let i = from; i <= to; i++) {
    const l = lines[i - 1], cut = l.length > 200 ? l.slice(0, 200) + ' …' : l
    console.log(`   ${i === at ? '>' : ' '} ${String(i).padStart(w)}| ${cut}`)
  }
}

function printBatch(dir, b) {
  const vp = b.viewport ? ` · page ${b.viewport.w}x${b.viewport.h}${b.viewport.phone ? ' (phone)' : ''}` : ''
  // A comment the user deleted in the page after sending it is withdrawn: left out, only counted.
  const live = b.comments.filter(c => !c.withdrawn), gone = b.comments.length - live.length
  console.log(`batch ${b.id} · ${live.length} comment${live.length === 1 ? '' : 's'}${gone ? ` (${gone} withdrawn in the page)` : ''}${vp} · ${b.theme}`)
  for (const c of live) {
    console.log(`\n${c.n}. ${c.route}`)
    console.log(`   ${c.text.split('\n').join('\n   ')}`)
    if (c.action) console.log(`   action: ${c.action} (${c.failed && FAILED[c.action] ? FAILED[c.action](c, c.failed) : ACTIONS[c.action] || ''})`)
    // A comment pinned with a long press is on a spot; its element is only where that spot is.
    if (c.point) console.log(`   at: ${c.point.x},${c.point.y} (a spot, pinned with a long press)`)
    // On the motion (the page's motion dock): a moment or a range of its take, and how to see it.
    if (c.take) console.log(`   at: ${spanOf(c)} of the motion (its take is ${secs(c.take)}): see it with proto shoot ${c.route} ${c.to !== undefined ? `--frames 8 --at ${c.at}-${c.to}` : `--at ${c.at}`}`)
    if (c.target) console.log(`   ${c.point ? 'in' : 'on'}: ${where(c.target)}`)
    if (c.target?.src) printSource(dir, c.target.src)
    // Written in the page's device view: about that layout, which a shot at that size shows.
    if (c.view) console.log(`   view: ${c.view.size} ${c.view.w}x${c.view.h} (shoot it: proto shoot ${c.route} --size ${c.view.w}x${c.view.h})`)
    for (const [i, t] of (c.tags || []).entries()) console.log(`   with @${i + 1}: ${where(t)}`)
    for (const img of c.images || []) console.log(`   image: ${join(inboxDir(dir), 'taken', b.id, img.file)}${img.name ? `  (${img.name})` : ''}`)
  }
  console.log(`\nReply to all at once: proto reply ${b.id} 1 "…" 2 "…" … --done   (or ${b.id}/<n> "…" for one, ${b.id} "…" for the batch)\n`)
}

async function inbox() {
  const dir = sessionDir()
  const s = need(dir)
  if (!flags.wait) {
    const got = take(dir)
    got.forEach(b => printBatch(dir, b))
    if (!got.length) console.log('no new comments')
    const w = readJson(waiterFile(dir), null)
    console.log(w && alive(w.pid) ? `listening (pid ${w.pid})` : 'not listening: run `proto inbox --wait` in the background')
    return
  }
  const w = readJson(waiterFile(dir), null)
  if (w && alive(w.pid) && w.pid !== process.pid) return console.log(`already listening (pid ${w.pid}); nothing to do`)
  const minutes = Number(flags.timeout) || 115
  writeJson(waiterFile(dir), { pid: process.pid, at: new Date().toISOString(), until: new Date(Date.now() + minutes * 60e3).toISOString() })
  const done = () => { const now = readJson(waiterFile(dir), null); if (now?.pid === process.pid) rmSync(waiterFile(dir), { force: true }) }
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { done(); process.exit(0) })
  console.log(`listening for comments on ${s.url || s.localUrl || 'the page'}`)
  const end = Date.now() + minutes * 60e3
  // Wakes the moment the page's server renames a batch into new/ (it arrives whole), or after a
  // second to check the server is still up. Polling once a second added half a second on average
  // between Send and this waking. The watcher is closed before a batch is moved out of new/:
  // Windows can refuse a rename in a directory something holds open.
  const fresh = join(inboxDir(dir), 'new')
  mkdirSync(fresh, { recursive: true })
  const arrival = () => new Promise(ok => {
    let w = null
    const go = () => { clearTimeout(t); try { w?.close() } catch { /* gone */ } ok() }
    const t = setTimeout(go, 1000)
    try { w = watch(fresh, go) } catch { /* no watcher here: the second's check still runs */ }
  })
  while (Date.now() < end) {
    if (batchesIn(dir, 'new').length) {
      // A reviewer often sends twice in a row: a moment's grace takes both in one wake.
      await sleep(1500)
      const got = take(dir)
      if (got.length) { done(); got.forEach(b => printBatch(dir, b)); return }
    }
    if (!alive(readSession(dir)?.pid)) { done(); return console.log('the server stopped, so no comments can come. `proto up`, then listen again.') }
    await arrival()
  }
  done()
  console.log(`no comments in ${minutes} min. Listen again: proto inbox --wait`)
}

function reply() {
  const dir = sessionDir()
  need(dir)
  const [ref, ...words] = args
  // Many at once: proto reply <batch> 1 "…" 2 "…" [--done], one write and one line for a whole batch.
  const pairs = !ref?.includes('/') && words.length >= 2 && words.length % 2 === 0 && words.every((w, i) => i % 2 || /^\d+$/.test(w))
  const text = pairs ? '' : words.join(' ').trim()
  if (!ref || (!text && !flags.done && !pairs)) die('proto reply <batch>[/<n>] "…" [--done]   or   proto reply <batch> 1 "…" 2 "…" … [--done]')
  const [prefix, n] = ref.split('/')
  const ids = batchesIn(dir, 'taken').filter(id => id.startsWith(prefix))
  if (ids.length !== 1) die(ids.length ? `"${prefix}" matches ${ids.length} batches; give more of the id` : `no taken batch "${prefix}" (run proto inbox first)`)
  const file = join(inboxDir(dir), 'taken', ids[0], 'batch.json')
  const b = readJson(file, null)
  const at = new Date().toISOString()
  // Whose mark the page puts beside the reply.
  const by = flags.as === 'codex' ? 'codex' : 'claude'
  if (pairs) {
    const answered = []
    for (let i = 0; i < words.length; i += 2) {
      const c = b.comments.find(x => x.n === Number(words[i])) || die(`batch ${ids[0]} has no comment ${words[i]} (1-${b.comments.length})`)
      if (c.withdrawn) console.log(`(comment ${words[i]} was withdrawn in the page: the user deleted it after sending)`)
      c.reply = { text: words[i + 1], at, by }
      if (flags.done) c.done = true
      answered.push(words[i])
    }
    b.done = b.comments.every(c => c.done)
    writeJson(file, b)
    return console.log(`${ids[0]}: replied to ${answered.join(', ')}${flags.done ? ', done' : ''}${b.done ? ' (batch done)' : ''}`)
  }
  if (n) {
    const c = b.comments.find(x => x.n === Number(n)) || die(`batch ${ids[0]} has no comment ${n} (1-${b.comments.length})`)
    if (c.withdrawn) console.log(`(comment ${n} was withdrawn in the page: the user deleted it after sending)`)
    if (text) c.reply = { text, at, by }
    if (flags.done) c.done = true
  } else {
    if (text) b.reply = { text, at, by }
    if (flags.done) b.comments.forEach(c => { c.done = true })
  }
  b.done = b.comments.every(c => c.done)
  writeJson(file, b)
  console.log(`${ids[0]}${n ? `/${n}` : ''}: ${text ? 'replied' : ''}${text && flags.done ? ', ' : ''}${flags.done ? 'done' : ''}${b.done ? ' (batch done)' : ''}`)
}

// How close one variant (or an element of it) is to a screenshot of the real thing (compare.mjs).
async function compare() {
  const dir = sessionDir()
  const s = need(dir)
  if (!await running(s)) die('the server is stopped. Run: proto up')
  const clicked = new Set(argv.filter((a, i) => argv[i - 1] === '--click'))
  const route = args.filter(a => !clicked.has(a))[0]
  if (!route || !route.includes('/') || typeof flags.ref !== 'string') die('usage: proto compare <slug>/<letter>[/<state>] --ref <png> [--el <css>] [--size <w>x<h>] [--click <css>]')
  if (flags.size !== undefined && !/^\d+x\d+$/.test(String(flags.size))) die('--size is the layout viewport in CSS px, the width the reference was taken at: --size 1440x900')
  // Relative to where Claude stands, or to the app (where `.proto/ref/` lives).
  const ref = [resolve(flags.ref), resolve(dir, flags.ref)].find(f => existsSync(f))
  if (!ref) die(`--ref: no file ${flags.ref} here or in ${tilde(dir)}`)
  const extra = [`--ref=${ref}`, ...['el', 'size'].filter(k => typeof flags[k] === 'string').map(k => `--${k}=${flags[k]}`)]
  argv.forEach((a, i) => { if (a === '--click' && argv[i + 1]) extra.push(`--click=${argv[i + 1]}`); else if (a.startsWith('--click=')) extra.push(a) })
  const out = resolve(flags.out || join(dir, '.proto', 'shots'))
  const r = run(process.execPath, [join(SKILL, 'scripts', 'compare.mjs'), s.localUrl, out, route, ...extra], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

// How smoothly one variant runs (perf.mjs): at rest, or while --drag moves an element in it, after
// any --click steps to reach a state. Headless, at --dpr 2 by default.
async function perf() {
  const dir = sessionDir()
  const s = need(dir)
  if (!await running(s)) die('the server is stopped. Run: proto up')
  const clicked = new Set(argv.filter((a, i) => argv[i - 1] === '--click'))
  const route = args.filter(a => !clicked.has(a))[0]
  if (!route || !route.includes('/')) die('usage: proto perf <slug>/<letter>[/<state>] [--drag <css>] [--click <css>] [--size <w>x<h>] [--dpr 2] [--hz <screen Hz>] [--seconds 3]')
  const extra = ['drag', 'size', 'dpr', 'hz', 'seconds'].filter(k => typeof flags[k] === 'string').map(k => `--${k}=${flags[k]}`)
  if (flags.size !== undefined && !/^\d+x\d+$/.test(String(flags.size))) die('--size is a viewport in CSS px: --size 1440x900')
  argv.forEach((a, i) => { if (a === '--click' && argv[i + 1]) extra.push(`--click=${argv[i + 1]}`); else if (a.startsWith('--click=')) extra.push(a) })
  const r = run(process.execPath, [join(SKILL, 'scripts', 'perf.mjs'), s.localUrl, route, ...extra], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

async function snap() {
  const dir = sessionDir()
  const s = need(dir)
  if (!await running(s)) die('the server is stopped. Run: proto up')
  if (!args.length) die('usage: proto snap <slug>[/<letter>]…')
  const readMeta = slug => {
    const f = join(dir, 'src', 'protos', slug, 'meta.ts')
    if (!existsSync(f)) die(`no prototype "${slug}"`)
    return JSON.parse(readFileSync(f, 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  }
  const spec = args.flatMap(arg => {
    const [slug, only] = arg.split('/')
    const meta = readMeta(slug)
    const ids = Object.keys(meta.variants || {}).filter(id => !only || id === only)
    if (!ids.length) die(`no variant "${only}" in ${slug}`)
    return ids.map(id => ({ route: `${slug}/${id}`, proto: slug, id, name: meta.variants[id], title: meta.title || slug, kind: meta.kind || 'web', screen: meta.screen }))
  })
  const out = resolve(flags.out || join(dir, '.proto', 'snaps'))
  mkdirSync(out, { recursive: true })
  const specFile = join(out, 'spec.json')
  writeFileSync(specFile, JSON.stringify(spec))
  const r = run(process.execPath, [join(SKILL, 'scripts', 'snap.mjs'), s.localUrl, out, String(flags.width || 672), specFile], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

// ---------- design kit ----------
// What a project's prototypes stand on (its tokens, its rebuilt chrome, the packages they need,
// Currents already matched to the real screen), saved once so a later session starts from it
// instead of rebuilding it. One folder per kit beside the sessions, git-ignored with them:
// .prototypes/_kits/<name>/ (a session's folder never starts with _, and gc and rm only touch
// sessions). Every project file a piece came from is kept with its hash, and the project's commit,
// so `proto kit` can say when the real app has moved on from it.
const kitsDir = () => join(projectRoot(), '.prototypes', '_kits')
const kitDir = name => join(kitsDir(), name)
const readKit = name => readJson(join(kitDir(name), 'kit.json'), null)
const kitNames = () => { try { return readdirSync(kitsDir()).filter(n => existsSync(join(kitDir(n), 'kit.json'))).sort() } catch { return [] } }
function kitName() {
  const n = typeof flags.kit === 'string' ? flags.kit : 'main'
  if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) die(`a kit's name is lowercase letters, digits and dashes: "${n}"`)
  return n
}
const kitFlag = name => name === 'main' ? '--kit' : `--kit=${name}`
const VARIANT_FILE = /^[A-Z]{1,2}\.(tsx|vue)$/
const hashOf = f => { try { return createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16) } catch { return null } }
const headOf = project => { const r = run('git', ['-C', project, 'rev-parse', '--short', 'HEAD']); return r.status === 0 ? r.stdout.trim() : null }
const slash = p => p.split(sep).join('/')
const filesIn = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? filesIn(join(d, e.name)) : [join(d, e.name)])
const metaIn = f => { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')) } catch { return {} } }

/**
 * The project files a piece of the kit was written from: what its text imports (`@project/…`, or a
 * relative path that leads out of .prototypes: token CSS, fonts, images), plus what --sources names
 * (the theme config, the components its chrome was measured from). Paths from the project's root,
 * with forward slashes on every system, each with its hash.
 */
function sourcesOf(texts, project) {
  const out = new Set()
  const take = p => {
    for (const f of [p, ...['.ts', '.tsx', '.js', '.mjs', '.css', '.vue', '.json'].map(e => p + e), ...['index.ts', 'index.tsx', 'index.js'].map(i => join(p, i))]) {
      let file = false
      try { file = statSync(f).isFile() } catch { /* not this one */ }
      if (!file) continue
      const r = relative(project, f)
      if (!r.startsWith('..') && !r.split(sep).includes('.prototypes')) out.add(slash(r))
      return
    }
  }
  for (const [text, from] of texts) {
    for (const m of text.matchAll(/@project\/([^'"`)\s?#]+)/g)) take(join(project, m[1]))
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|@import\s+(?:url\()?\s*|url\(\s*)['"]?(\.\.?\/[^'"`)\s?#]+)/g)) take(resolve(from, m[1]))
  }
  for (const f of String(typeof flags.sources === 'string' ? flags.sources : '').split(',').map(x => x.trim()).filter(Boolean)) {
    const p = resolve(project, f), r = relative(project, p)
    if (r.startsWith('..')) die(`--sources: ${f} is outside the project`)
    if (!existsSync(p) || !statSync(p).isFile()) die(`--sources: no file ${f} in the project`)
    out.add(slash(r))
  }
  return Object.fromEntries([...out].sort().map(r => [r, hashOf(join(project, r))]))
}
// Which of those files are not what they were when the kit was saved.
function drift(sources, project) {
  const changed = [], gone = []
  for (const [r, h] of Object.entries(sources || {})) {
    const now = hashOf(join(project, r))
    if (now === null) gone.push(r)
    else if (now !== h) changed.push(r)
  }
  return { changed, gone, n: changed.length + gone.length }
}
const driftSay = d => [d.changed.length && `changed: ${d.changed.join(', ')}`, d.gone.length && `gone: ${d.gone.join(', ')}`].filter(Boolean).join('; ')
// Commits since the save: a file nobody listed may have moved too.
function commitsSince(project, commit) {
  if (!commit) return 0
  const now = headOf(project)
  if (!now || now === commit) return 0
  const r = run('git', ['-C', project, 'rev-list', '--count', `${commit}..HEAD`])
  return r.status === 0 ? Number(r.stdout.trim()) : 0
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One line per kit, for `proto up`. */
function kitLine(name, project) {
  const k = readKit(name), d = drift(k.sources, project), later = commitsSince(project, k.commit)
  const screens = Object.keys(k.screens || {})
  return `kit ${name}: ${d.n ? `out of date (${driftSay(d)})` : 'up to date'}, saved ${k.savedAt.slice(0, 10)}${later ? `, ${plural(later, 'commit')} since` : ''}${screens.length ? `, Currents: ${screens.join(', ')}` : ''} · proto kit${name === 'main' ? '' : ` --kit=${name}`}`
}

function kitStatus() {
  const project = projectRoot(), names = kitNames()
  if (!names.length) {
    console.log('no design kit in this project yet. Once Current matches its reference: proto kit save <slug> --sources <the files its tokens and chrome came from>')
    return
  }
  const show = typeof flags.kit === 'string' ? [kitName()] : names
  for (const name of show) {
    const k = readKit(name) || die(`no kit "${name}" (there is: ${names.join(', ')})`)
    const d = drift(k.sources, project), later = commitsSince(project, k.commit)
    const screens = Object.entries(k.screens || {})
    console.log(`kit ${name} · ${k.stack} · ${k.kind === 'phone' ? `phone${k.screen ? ` ${k.screen.join('x')}` : ''}` : 'web'} · saved ${k.savedAt.slice(0, 16).replace('T', ' ')} from ${k.from}`)
    console.log(`  read first: ${tilde(join(kitDir(name), 'design-system.md'))}`)
    const pk = Object.entries(k.packages || {})
    console.log(`  has: theme.css${k.parts.length ? `, ${k.parts.join(', ')}` : ''}${pk.length ? `, packages ${pk.map(([p, v]) => `${p}@${v}`).join(' ')}` : ''}`)
    console.log(`  sources: ${Object.keys(k.sources).length} tracked, ${d.n ? driftSay(d) : 'all unchanged'}`)
    if (later) console.log(`  the project is ${plural(later, 'commit')} past the save (${k.commit}): check the screens you build on still look like it`)
    for (const [sn, sc] of screens) {
      const sd = drift(sc.sources, project)
      console.log(`  Current "${sn}": from ${sc.from}, ${plural(sc.refs.length, 'reference')}, ${sd.n ? driftSay(sd) : 'its sources unchanged'}`)
    }
    console.log(`  start on it: proto add <slug> --title "…" --variants "A:Current,B:…" ${kitFlag(name)}${screens.length ? ' [--current <screen>]' : ''}`)
  }
}

// The kit's design-system.md as first written: what can be read off the files, and the headings
// the agent fills in for the next session. Never rewritten once it exists.
function kitDoc(k, kd) {
  const exported = k.parts.flatMap(f => {
    const p = join(kd, 'parts', f)
    if (!statSync(p).isFile()) return [`- ${f}/`]
    const names = [...readFileSync(p, 'utf8').matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m => m[1])
    return [`- ${f}${names.length ? `: ${names.join(', ')}` : ''}`]
  })
  return [
    `# Design kit: ${k.name}`, '',
    'Read this before prototyping on this project. `proto kit` says whether the app has moved on since it was saved.', '',
    '## The product', '',
    `- Platform and frame: ${k.kind === 'phone' ? `phone, screen ${k.screen ? k.screen.join('x') : '393x852'} pt` : 'web'}`,
    '- What it is, its language and direction:', '',
    '## Where the look comes from', '',
    ...(Object.keys(k.sources).length ? Object.keys(k.sources).map(r => `- \`${r}\``) : ['- (no project files tracked: name them with --sources)']), '',
    '## Tokens (theme.css)', '',
    '- The colors, type and radii worth knowing by name:',
    '- Values that are invented, not from the source:', '',
    '## Chrome (parts)', '',
    ...(exported.length ? exported : ['- (none)']),
    '- What each one is for, and what it does not cover yet:', '',
    '## Icons, fonts and assets', '',
    ...(Object.keys(k.packages).length ? Object.entries(k.packages).map(([p, v]) => `- \`${p}@${v}\``) : []),
    '- Where fonts and images are imported from, and any stand-ins:', '',
    '## Traps', '',
    '- What took rounds to match, and why, so the next session gets it right the first time:', '',
  ].join('\n')
}

/** `proto kit save <slug>`: the session's theme and that prototype's shared files, as the kit. */
function kitSave() {
  const dir = sessionDir(), s = need(dir), project = projectRoot()
  const slug = args[1]
  const pdir = join(dir, 'src', 'protos', slug || '-')
  if (!slug || !existsSync(join(pdir, 'meta.ts'))) die('usage: proto kit save <slug> [--sources <file,…>] [--kit=<name>], with the prototype whose Current matched its reference')
  const name = kitName(), kd = kitDir(name), was = readKit(name)
  if (was && was.stack !== s.stack) die(`kit ${name} is for ${was.stack} and this session is ${s.stack}: save under another name (--kit=<name>)`)
  mkdirSync(kd, { recursive: true })
  const theme = readFileSync(join(dir, 'src', 'theme.css'), 'utf8')
  writeFileSync(join(kd, 'theme.css'), theme)
  // Everything in the prototype's folder but its variants and meta.ts, as it is now, replaces the kit's.
  const parts = readdirSync(pdir).filter(f => f !== 'meta.ts' && !VARIANT_FILE.test(f) && !f.startsWith('.')).sort()
  rmSync(join(kd, 'parts'), { recursive: true, force: true })
  mkdirSync(join(kd, 'parts'))
  for (const f of parts) cpSync(join(pdir, f), join(kd, 'parts', f), { recursive: true })
  // Each file is read where it lives in the prototype, so its relative imports resolve from there.
  const texts = [[theme, join(dir, 'src')], ...filesIn(join(kd, 'parts')).map(p => [readFileSync(p, 'utf8'), dirname(join(pdir, relative(join(kd, 'parts'), p)))])]
  // The packages the session added on top of the template (an icon set): the next one gets them too.
  const tpl = STACKS[s.stack], base = new Set(Object.keys({ ...SHELL, ...tpl.deps, ...tpl.craft, ...BASE, ...tpl.dev }))
  const pkg = readJson(join(dir, 'package.json'), {})
  const packages = Object.fromEntries(Object.entries({ ...pkg.devDependencies, ...pkg.dependencies }).filter(([p]) => !base.has(p)).sort())
  const meta = metaIn(join(pdir, 'meta.ts'))
  const k = {
    name, stack: s.stack, savedAt: new Date().toISOString(), from: `${basename(dir)}/${slug}`, commit: headOf(project),
    kind: meta.kind === 'phone' ? 'phone' : 'web', ...(Array.isArray(meta.screen) ? { screen: meta.screen } : {}),
    parts, packages, sources: sourcesOf(texts, project), screens: was?.screens || {},
  }
  writeJson(join(kd, 'kit.json'), k)
  const doc = join(kd, 'design-system.md'), first = !existsSync(doc)
  if (first) writeFileSync(doc, kitDoc(k, kd))
  console.log(`${was ? 'updated' : 'saved'} kit ${name}: theme.css${parts.length ? `, ${parts.join(', ')}` : ''}${Object.keys(packages).length ? `, packages ${Object.keys(packages).join(' ')}` : ''}`)
  console.log(`tracking ${plural(Object.keys(k.sources).length, 'source')}${Object.keys(k.sources).length ? `: ${Object.keys(k.sources).join(', ')}` : ' (name them with --sources, or the kit can\'t tell when it is out of date)'}`)
  console.log(`${first ? 'fill in' : 'bring up to date'}: ${tilde(doc)}`)
}

/** `proto kit screen <name> <slug>[/<letter>]`: a Current that matches its reference, with the reference. */
function kitScreen() {
  const dir = sessionDir(), s = need(dir), project = projectRoot()
  const screen = args[1], [slug, letter = 'A'] = String(args[2] || '').split('/')
  if (!screen || !/^[a-z0-9][a-z0-9-]*$/.test(screen) || !slug) die('usage: proto kit screen <name> <slug>[/<letter>] [--sources <file,…>], with a Current that matches its reference')
  const name = kitName(), k = readKit(name) || die(`no kit "${name}" yet: proto kit save ${slug} first`)
  if (k.stack !== s.stack) die(`kit ${name} is for ${k.stack} and this session is ${s.stack}`)
  const ext = STACKS[s.stack].ext, file = join(dir, 'src', 'protos', slug, `${letter}.${ext}`)
  if (!existsSync(file)) die(`no variant ${slug}/${letter} in this session`)
  const sd = join(kitDir(name), 'screens', screen)
  rmSync(sd, { recursive: true, force: true })
  mkdirSync(join(sd, 'ref'), { recursive: true })
  const text = readFileSync(file, 'utf8')
  writeFileSync(join(sd, `current.${ext}`), text)
  const refDir = join(dir, '.proto', 'ref', slug)
  const refs = existsSync(refDir) ? readdirSync(refDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort() : []
  for (const f of refs) cpSync(join(refDir, f), join(sd, 'ref', f))
  // A file of its own folder that the kit's parts don't have would be missing in the next session.
  const local = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]\.\/([^'"]+)['"]/g)].map(m => m[1])
  const missing = local.filter(m => !k.parts.some(p => p === m || p.replace(/\.[^.]+$/, '') === m || p === m.split('/')[0]))
  k.screens = { ...k.screens, [screen]: { from: `${basename(dir)}/${slug}/${letter}`, savedAt: new Date().toISOString(), refs, sources: sourcesOf([[text, dirname(file)]], project) } }
  writeJson(join(kitDir(name), 'kit.json'), k)
  console.log(`saved Current "${screen}" in kit ${name}: ${slug}/${letter}, ${plural(refs.length, 'reference')}, tracking ${plural(Object.keys(k.screens[screen].sources).length, 'source')}`)
  if (!refs.length) console.log(`no references in ${tilde(refDir)}: the next session has nothing to check this Current against`)
  if (!Object.keys(k.screens[screen].sources).length) console.log('no source files tracked for it: name the screen\'s own files with --sources, or the kit can\'t tell when the real screen changed')
  if (missing.length) console.log(`warning: it imports ${missing.map(m => `./${m}`).join(', ')}, which the kit's parts don't have: proto kit save ${slug}${name === 'main' ? '' : ` --kit=${name}`} first`)
}

// The kit `proto add --kit` names, checked against the session.
function kitFor(s) {
  const name = kitName(), k = readKit(name)
  if (!k) die(`no design kit "${name}" in this project${kitNames().length ? ` (there is: ${kitNames().join(', ')})` : ''}`)
  if (k.stack !== s.stack) die(`kit ${name} was saved from a ${k.stack} session and this one is ${s.stack}`)
  if (flags.current !== undefined && (typeof flags.current !== 'string' || !k.screens?.[flags.current])) die(`--current names a Current saved in kit ${name}${Object.keys(k.screens || {}).length ? `: ${Object.keys(k.screens).join(', ')}` : ' (it has none yet)'}`)
  return { name, k, kd: kitDir(name) }
}

/**
 * Puts the kit under a prototype: its parts (never over a file the prototype has), its theme (only
 * over the template's, never over tokens the session already has), its packages, and with --current
 * that screen's Current as A (only over A's stub) and its references. Then says whether the app
 * has moved on, so the agent knows to check or to go straight on.
 */
function useKit(dir, pdir, slug, { name, k, kd }, a) {
  const kept = []
  for (const f of k.parts) {
    if (existsSync(join(pdir, f))) kept.push(f)
    else cpSync(join(kd, 'parts', f), join(pdir, f), { recursive: true })
  }
  const themeFile = join(dir, 'src', 'theme.css'), mine = readFileSync(themeFile, 'utf8'), theirs = readFileSync(join(kd, 'theme.css'), 'utf8')
  if (mine !== theirs) {
    if (mine === readFileSync(join(APP, 'src', 'theme.css'), 'utf8')) writeFileSync(themeFile, theirs)
    else kept.push('src/theme.css')
  }
  const pkgFile = join(dir, 'package.json'), pkg = readJson(pkgFile, {})
  const want = Object.entries(k.packages || {}).filter(([p]) => !pkg.dependencies?.[p] && !pkg.devDependencies?.[p])
  if (want.length) {
    pkg.dependencies = { ...pkg.dependencies, ...Object.fromEntries(want) }
    writeJson(pkgFile, pkg)
    install(dir)
  }
  console.log(`on kit ${name}: theme.css, ${k.parts.join(', ') || 'no parts'}${want.length ? `, installed ${want.map(([p]) => p).join(' ')}` : ''}${kept.length ? ` (kept this session's own ${kept.join(', ')})` : ''}`)
  const project = projectRoot(), d = drift(k.sources, project), later = commitsSince(project, k.commit)
  if (d.n) console.log(`the kit is out of date (${driftSay(d)}): bring theme.css and the parts in line with those files, check Current against a fresh screenshot, then proto kit save ${slug}${name === 'main' ? '' : ` --kit=${name}`}`)
  let refs = []
  if (a) {
    const sc = k.screens[flags.current], sd = join(kd, 'screens', flags.current)
    const ext = STACKS[k.stack].ext
    if (!existsSync(a.file) || readFileSync(a.file, 'utf8') === a.stub) writeFileSync(a.file, readFileSync(join(sd, `current.${ext}`)))
    else console.log(`${slug}/A already has its own code; the saved Current "${flags.current}" is ${tilde(join(sd, `current.${ext}`))}`)
    const refDir = join(dir, '.proto', 'ref', slug)
    mkdirSync(refDir, { recursive: true })
    for (const f of sc.refs) if (!existsSync(join(refDir, f))) cpSync(join(sd, 'ref', f), join(refDir, f))
    refs = sc.refs
    const sdrift = drift(sc.sources, project)
    if (sdrift.n) console.log(`Current "${flags.current}" may not match the app any more (${driftSay(sdrift)}): take a fresh screenshot and match it again before the other variants`)
  }
  if (!d.n && later) console.log(`the project is ${plural(later, 'commit')} past the kit (${k.commit}); its tracked files are unchanged`)
  if (a && refs.length) console.log(`check it once: proto shoot ${slug}/A --ref .proto/ref/${slug}/${refs[0]}`)
}

// ---------- fonts ----------
// The pairings in references/fonts.json, checked against Google Fonts. --draw picks at random, so
// two sessions with the same brief don't land on the same faces; no family appears twice in a draw.
function fonts() {
  const cat = readJson(join(SKILL, 'references', 'fonts.json'), null) || die('references/fonts.json is missing')
  const avoid = new Set(String(flags.avoid || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean))
  const fams = p => ['display', 'body', 'utility'].filter(r => p[r]).map(r => p[r].family)
  let pool = cat.pairings.filter(p => p.script === (flags.hebrew ? 'hebrew' : 'latin') && !fams(p).some(f => avoid.has(f.toLowerCase())))
  if (flags.draw) {
    const n = Number(flags.draw) || 1, out = [], used = new Set()
    pool = pool.map(p => [Math.random(), p]).sort((a, b) => a[0] - b[0]).map(x => x[1])
    for (const p of pool) { if (out.length >= n) break; if (fams(p).some(f => used.has(f))) continue; fams(p).forEach(f => used.add(f)); out.push(p) }
    pool = out
  }
  for (const p of pool) {
    const specs = [...new Set(['display', 'body', 'utility'].filter(r => p[r]).map(r => p[r].spec))]
    console.log(`${p.mood} (${p.script}): ${fams(p).join(' / ')}`)
    console.log(`  font(${specs.map(s => `'${s}'`).join(', ')})`)
  }
  if (flags.hebrew && !flags.draw) console.log(`\nEvery Google family with Hebrew: ${cat.hebrew.join(', ')}`)
}

const commands = {
  up, add, plan, done, pick, work, ask, archive, shoot, compare, perf, handoff, snap, inbox, reply, gc: () => gc(false), ls,
  stop: async () => { await stop(); console.log('stopped (files kept; proto up restarts it on the same link)') },
  rm: () => rm(),
  keep: () => { const dir = sessionDir(); need(dir); patchSession(dir, { keep: !flags.off }); console.log(flags.off ? 'no longer kept' : 'kept until deleted by hand') },
  url: () => { const s = need(sessionDir()); console.log(s.url || s.localUrl || 'not started') },
  stack: () => { const d = detectStack(projectRoot()); console.log(`${d.stack} (${d.why})`) },
  fonts,
  kit: () => !args[0] ? kitStatus() : args[0] === 'save' ? kitSave() : args[0] === 'screen' ? kitScreen() : die(`proto kit ${args[0]}? It is proto kit, proto kit save or proto kit screen`),
}
// The help is this file's opening comment, however many lines it grows to.
if (!commands[cmd]) {
  const head = readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).slice(1)
  console.log(head.slice(0, head.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(cmd ? 1 : 0)
}
await commands[cmd]()
