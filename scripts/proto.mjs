#!/usr/bin/env node
// proto: one live prototype app per agent session, served locally or on the tailnet.
//
//   proto up [--name "Session name"] [--lang en|he] [--stack react|vue]   create or restart, print the URL; an existing
//             session's copy of the app (shell, config, packages) is brought up to date first
//   proto add <slug> --title "…" --variants "A:Name,B:Name" [--ask "…"] [--kind phone] [--screen 402x874]
//             [--from <slug>/<letter>[,<slug>/<letter>…]]   built from those variants: nested under the first
//             [--from-picks]   built from every variant the user picked in this session
//             [--next]   the first parent's next versions: a pick among them is built into it
//             [--kit[=<name>]] [--current <screen>]   on the project's design kit: its theme, parts and
//             packages, and with --current that screen's saved Current as A (with its references)
//   proto done <slug>/<letter>[ …] | <slug>   that variant is built: the page drops its Building mark, and a comment
//                                   answered with --until on it is done once nothing it waits on is building
//   proto shoot [route…] [--theme dark] [--focus] [--copy] [--click <css>]  screenshots, e.g. hero hero/A hero/A/open
//             [--ref <png>]   instead, the variant's screen beside that screenshot of the real one
//             [--as built]    with --ref: the png is the variant built in the codebase (<route>-vs-built.png)
//             [--at <ms>]     instead, the variant's motion (useMotion) at that moment of its take
//             [--frames <n>] [--at <ms>-<ms>]   n frames of the take on one sheet, with its curves
//             [--size <w>x<h>]   instead of desktop and phone, that viewport (a layout from the page's device view)
//             [--parallax <x>,<y>]   parallax() layers held at that point of their travel (1,1 and -1,-1: the ends)
//   proto shoot [slug…] --sheet [--state <id>] [--theme dark]   every variant on one contact sheet per prototype
//   proto shoot --pin <batch>[/<n>] [--margin <px>] [--state <id>] [--hover] [--after <ms>]
//             what a comment from the page is on, as the user saw it: their page size and theme at 2x,
//             the way to it opened, its box plus a margin (pin-<batch>-<n>.png), the region around it
//             (-context.png) and the comment's pictures beside it (-vs-ref.png); no /<n>: every pinned one
//   proto compare <slug>/<letter>[/<state>] --ref <png> [--el <css>] [--size <w>x<h>] [--click <css>]
//             how far an element of the variant (default: the whole variant) is from a screenshot of
//             the real one, as % of pixels off, per column and per third, with a difference image
//   proto perf <slug>/<letter>[/<state>] [--drag <css>] [--click <css>] [--size <w>x<h>] [--dpr 2] [--hz <n>] [--seconds 3]
//             frames per second at rest (or while dragging that element), how busy the main and GPU
//             threads are, and the design's slowest functions; run it on anything that animates
//   proto handoff <slug>/<letter>   a checklist of what that variant has, for building it into the codebase
//   proto brief <slug>   the decision brief: the ask, the pick and why, the other directions, the changes
//             asked on the pick and every comment with its answer (.proto/decisions/<slug>.md)
//   proto snap <slug>[/<letter>]… [--width 672]   static HTML snapshots for a shared document
//   proto pick <slug> <number> [--off]   the user chose this variant: marked in the page
//   proto fav [<slug>] | <slug>/<number>[ …] [--off]   the user's favorites (the page's stars): list them, or star some
//   proto work <slug>/<letter> [--ask "…"] [--off]   the variant being worked on: pinned in the page
//   proto ask "…" [--to <slug>/<letter>]   a change the user asked for, kept with that variant
//   proto ask --each "…" "…" …   several at once (a batch of comments); each ask keeps the variant as it was first
//   proto history <slug>/<letter> [--save "…"]   its earlier versions (kept before each ask), or keep one now;
//             the page shows any of them beside the variant now (History, in the variant's tools)
//   proto intake set <questions.json|->   ask the user questions in the page before building (a from-scratch
//             request, or too little context): the page shows them as their own screen, and the answers
//             arrive in `proto inbox` as an intake batch. See references/intake.md for the file's shape.
//   proto intake [status] | clear   what is open and whether it was answered, or take the questions away
//   proto inbox --listen <config.json> | --unlisten   one persistent wakeup subscription (url, id, threadId)
//   proto inbox --status   check the listener without taking pending comments
//   proto inbox --reconcile [--json]   lifecycle status and exact host task action, no comments taken
//   proto inbox --finish <slug> | --close finished|abandoned   finish feedback (pending work blocks cleanup)
//   proto inbox --reopen [--again]   reopen the same listener (--again: user-authorized opt-in)
//   proto inbox --host-enabled <id> | --host-disabled <id>   confirm an observed host task state
//   proto inbox [--wait] [--timeout <min>]   comments sent from the page; --wait blocks until some arrive
//   proto reply <batch>[/<n>] "…" [--done | --until <slug>[/<letter>]] [--as claude|codex|agent]   answer a comment (or a whole batch) in the page;
//                                   --until keeps it open until that work is built (proto done closes it)
//   proto reply <batch> 1 "…" 2 "…" … [--done | --until <slug>]   answer many comments of a batch in one call
//   proto kit [--kit=<name>]   the project's design kit: what it has, and whether the app moved on since
//   proto kit save <slug> [--sources <file,…>] [--kit=<name>]   the session's theme.css and that prototype's
//             parts, packages and screen, kept for the next session (--sources: the files they came from)
//   proto kit screen <name> <slug>[/<letter>] [--sources <file,…>]   a Current that matches its reference
//   proto plan <slug>   each placeholder shows its direction's one-line plan from .proto/briefs/<slug>.json
//   proto fonts [--hebrew]   the title-and-body pairings (references/fonts.json) and the faces never used for a title
//   proto share setup [--name <owner>] [--plan-checked] [--account <id>]   the maintainer's: deploys the share host
//             (workers.dev) on the separate prtype.dev Cloudflare account; again to update or repair it (only when the user asks)
//   proto share setup --domain prtype.dev   the host behind prtype.dev: short links, GitHub sign-in to comment
//   proto share setup --local [--name <owner>]   a share host on this Mac (wrangler dev); links open only here
//   proto share setup --github [--client-id <id>] [--restart]   the local host's GitHub OAuth App (secret on stdin)
//   proto share signin [--no-open] [--again]   sign in with GitHub to share (prtype.dev with no setup; a new link needs
//             it): prints and opens the link, waits up to five minutes, keeps this Mac's token in the Keychain
//   proto share signout      revoke this Mac's token on the host and forget it here
//   proto share admin users [--pending] | approve <login> | ban <login> | rm <id> | reports   the host's maintainer:
//             who is waiting, let them in or ban them, take any link down, read "Report this link"
//   proto share <slug>[/<n>…] | --all [--title "…"] [--message "…"] [--yes] [--host local|online]   build, review,
//             publish, print the link; --message: what viewers read first, at most 280 characters
//             (only when the user asks; read the review's warnings to them before --yes)
//   proto share ls [--all]   this session's links (or every share on the host), changed since shared, new comments,
//             who is in each link now, views, the variants changed since, and an online host's usage today
//   proto share update <id> [--note "…"] [--message "…" | --message=] [--yes]   the same link at a new version,
//             its comments kept; --message sets the viewers' message, --message= clears it
//   proto share comments [<id>] [--new]   viewer comments on this session's links, fenced as quoted feedback
//   proto share take <commentId…> | --new [<id>]   send viewer comments to the inbox, as the page's Send to Claude
//             does (only when the user asks for it in chat)
//   proto share rm <id>      take a link down (it then says it was removed)
//   proto share file <slug>[/<n>…] [--out <file.html>]   the same build as one HTML file, comments off
//   proto share stop         stop the local host (the next share starts it again)
//   proto archive <slug> [--off]    proto keep [--off]      proto url    proto stack
//   proto stop    proto rm    proto ls    proto gc
//
// Variants: the page shows each by number (A is 1, Z 26, AA 27, AC 29), and that is how the user names
// them. Wherever a command takes <slug>/<letter>, <slug>/<number> works too (hero/29 is hero/AC).
//
// Common flags: --project <dir> (default: git root of the cwd), --session <id>
// (default: PROTO_SESSION_ID, CODEX_THREAD_ID, CLAUDE_CODE_SESSION_ID, CLAUDE_SESSION_ID, in that order).
// Reply identity: --as claude|codex|agent, then PROTO_AGENT, then the detected agent (or agent).
// Optional PROTO_AGENT_PID (or CLAUDE_PID) identifies the long-lived agent for comment recovery.

import { spawn, spawnSync } from 'node:child_process'
import { listenerFile, listenerStatus, saveListener, reconcileListener, pendingListenerWork } from '../app/listener.mjs'
import { createHash, randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assignmentNeeded, buildUpNeeded, isCurrent } from '../app/assignment.mjs'
import { idOf, letterOf, numberOf } from '../app/numbers.mjs'
import { snapshot, versionLabel, versionsOf } from '../app/history.mjs'
import { writeBrief } from '../app/brief.mjs'
import { report as reportShared } from '../app/share/owner.mjs'
import { sharedLines } from '../app/share/viewer-text.mjs'
import { BASE, SHELL, STACKS, syncApp } from './app-sync.mjs'
import { skillUpdate } from './self-update.mjs'
import { locked as lockApp, projectApp, registerSession } from './project.mjs'

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)))
// The languages the page speaks (app/shell/i18n.ts). --lang sets the session's: the language the
// conversation with the user is in.
const LANGS = ['en', 'he']
const langFlag = () => {
  if (flags.lang === undefined) return null
  if (!LANGS.includes(flags.lang)) die(`--lang must be one of ${LANGS.join(', ')}`)
  return flags.lang
}
const APP = join(SKILL, 'app')
const INDEX = join(homedir(), '.prototypes', 'sessions.json')
const IDLE_HOURS = 6
const MAX_HEAP_MB = 1024
const DELETE_DAYS = 14
const LOCAL_PORTS = [5180, 5279]
const TAILNET_PORTS = [9500, 9599]
// The template's packages and stacks live with the app sync (scripts/app-sync.mjs).

// ---------- arguments ----------
const argv = process.argv.slice(2)
const cmd = argv[0]
const flags = {}
const args = []
// Flags that are only on or off never take the next word, so `add --from-picks mix` or
// `pick --off hero` still reads the slug as the slug.
const SWITCHES = new Set(['from-picks', 'reference-only', 'next', 'off', 'done', 'wait', 'unlisten', 'status', 'reconcile', 'json', 'reopen', 'focus', 'copy', 'kit', 'each', 'hebrew', 'hover', 'yes', 'all', 'local', 'new', 'sync-only', 'plan-checked', 'github', 'restart', 'no-open', 'again', 'no-serve', 'join'])
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { args.push(a); continue }
  const [k, v] = a.slice(2).split(/=(.*)/s)
  flags[k] = v !== undefined ? v : !SWITCHES.has(k) && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
}

// A variant as the agent reads it: the number the user sees, with its letter ID (#29 (AC)).
const shown = id => numberOf(id) ? `#${numberOf(id)} (${id})` : String(id)
// A prototype's variants as the user knows them, by number, in the page's order.
const choices = meta => Object.keys(meta?.variants || {}).sort((a, b) => a.length - b.length || a.localeCompare(b)).map(id => numberOf(id) ? `#${numberOf(id)}` : id).join(', ')
// A route with the number the user saw beside it: hero/AC (#29), so a reply can say #29.
const routeShown = r => { const n = numberOf(String(r).split('/')[1]); return n ? `${r} (#${n})` : String(r) }
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
  const id = flags.session || process.env.PROTO_SESSION_ID || process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID
  if (!id || id === true) die('no session id. Pass --session <id> on every call, or set PROTO_SESSION_ID to one stable, unique name for this conversation.')
  return String(id)
}
// The project's one app (scripts/project.mjs). Every command still names its conversation, which
// owns what it makes there.
function sessionDir() {
  sessionId()
  return projectApp(projectRoot())
}
const sessionFile = dir => join(dir, 'session.json')
const readSession = dir => readJson(sessionFile(dir), null)
// The page hot-reloads session.json, so a write that changes nothing is skipped. Read right
// before it is written, since the dev server writes it too (a pick made in the page).
// session.json is read, changed and written by several processes at once (subagents' parallel
// `proto done`, the dev server stamping edits), so each change is made under a lock: a directory,
// which only one of them can create. One held past 5 s was left by a crash and is taken over.
// app/server.mjs takes the same lock.
const locked = (dir, fn) => lockApp(dir, fn)
// patch: the fields to change, or a function of the session as it is now that returns them.
function patchSession(dir, patch) {
  return locked(dir, () => {
    const was = readSession(dir), s = { ...was, ...(typeof patch === 'function' ? patch(was) : patch) }
    if (JSON.stringify(s) !== JSON.stringify(was)) writeJson(sessionFile(dir), s, scratchOf(dir))
    return s
  })
}
function need(dir) {
  if (!existsSync(sessionFile(dir))) die(`no prototype session here yet (${tilde(dir)}). Run: proto up`)
  beat(dir)
  return readSession(dir)
}
// Who is running these commands, written as they run: the page tells "the session that took my
// comments is gone" (T3 Code restarted, the terminal closed) from "the agent is working on them" by
// whether its long-lived process is still alive. Never use the short-lived CLI's own pid.
const agentPid = () => Number(process.env.PROTO_AGENT_PID || process.env.CLAUDE_PID) || 0
function detectedAgent() {
  const by = process.env.PROTO_AGENT || (process.env.CODEX_THREAD_ID ? 'codex' : process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID ? 'claude' : null)
  if (by && !['claude', 'codex', 'agent'].includes(by)) die('PROTO_AGENT must be claude, codex or agent')
  return by
}
function replyAgent() {
  const by = flags.as ?? detectedAgent() ?? 'agent'
  if (!['claude', 'codex', 'agent'].includes(by)) die('reply identity must be claude, codex or agent (--as or PROTO_AGENT)')
  return by
}
function beat(dir) {
  const agent = detectedAgent()
  registerSession(dir, sessionId(), { agent })
  if (agent) patchSession(dir, { agent })
  const pid = agentPid()
  if (!pid) return
  try { writeJson(join(dir, '.proto', 'inbox', 'agent.json'), { pid, session: sessionId(), at: new Date().toISOString() }) } catch { /* the page then just doesn't know */ }
}

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

// ---------- image tools ----------
// What makes the session's images (references/images.md): the codex-image skill when it is installed
// beside this one or in a known skills folder; else, with the Codex CLI on the PATH, a line to suggest
// installing it; and inside Codex, a line to suggest the host's latest image model for the assets.
const CODEX_IMAGE_REPO = 'https://github.com/Dananz/codex-image'
function imageTools() {
  const home = homedir()
  const skill = [dirname(SKILL), join(home, '.claude', 'skills'), join(home, '.agents', 'skills'), join(home, '.codex', 'skills')]
    .map(d => join(d, 'codex-image')).find(d => existsSync(join(d, 'SKILL.md')))
  const exe = process.platform === 'win32' ? ['codex.cmd', 'codex.exe', 'codex'] : ['codex']
  const cli = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':').some(d => d && exe.some(e => existsSync(join(d, e))))
  const lines = []
  if (skill) lines.push(`images: codex-image at ${tilde(skill)}: every generated image goes through it (references/images.md)`)
  else if (cli) lines.push(`images: codex-image is not installed and the Codex CLI is: suggest it to the user once, git clone ${CODEX_IMAGE_REPO} ${tilde(join(dirname(SKILL), 'codex-image'))}`)
  if (detectedAgent() === 'codex') lines.push('images: running in Codex: suggest making the assets with the latest image model the host offers, named by version, once (references/images.md)')
  if (!lines.length) lines.push('images: no codex-image here; another image tool of the host if it has one (references/images.md)')
  return lines
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
  cpSync(join(APP, 'adapters', kit.tweaks), join(dir, 'src', 'tweaks.ts'))
  cpSync(join(APP, 'adapters', kit.copy), join(dir, 'src', 'copy.ts'))
  cpSync(join(APP, 'adapters', kit.motion), join(dir, 'src', 'motion.ts'))
  if (kit.slot) cpSync(join(APP, 'adapters', kit.slot), join(dir, 'src', 'slot.ts'))
  writeJson(join(dir, 'package.json'), {
    name: `prototype-${basename(dir)}`, private: true, type: 'module',
    dependencies: { ...SHELL, ...kit.deps, ...kit.craft }, devDependencies: { ...BASE, ...kit.dev },
  })
  writeJson(sessionFile(dir), {
    id: `p-${randomBytes(4).toString('hex')}`, agent: detectedAgent() ?? 'agent', name: basename(project), lang: langFlag() ?? 'en', project, path: tilde(project), stack,
    createdAt: new Date().toISOString(), port: null, tailnetPort: null, pid: null,
    url: null, localUrl: null, keep: false, idleHours: IDLE_HOURS, deleteDays: DELETE_DAYS,
  })
  remember(dir)
  console.log(`created ${tilde(dir)} (${stack}: ${why})`)
}

// ---------- update ----------
/**
 * Brings an existing session's app up to date with the template (scripts/app-sync.mjs), so a fix
 * to the shell reaches a session made before it. Vite picks up changed shell code by itself; new
 * packages, its config and the server need the dev server started again, which `up` then does.
 */
async function update(dir) {
  let r
  try { r = syncApp(dir) } catch (e) { die(e.message) }
  const { changed, deps, restartWorthy } = r
  if (!changed.length && !deps) return
  console.log(`updated the app: ${changed.length} file${changed.length === 1 ? '' : 's'}${deps ? ', packages' : ''}`)
  if (deps || restartWorthy) await stop(dir, 'updated')
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
  // A newer skill first: a clone that moved runs `up` again on the new code (PROTO_NO_UPDATE=1 skips it).
  const fresh = skillUpdate(SKILL)
  for (const line of fresh.lines) console.log(line)
  if (fresh.updated) {
    const again = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, PROTO_NO_UPDATE: '1' } })
    process.exit(again.status ?? 1)
  }
  // Reconcile before app sync changes source mtimes or GC can discard task identity.
  const dir = sessionDir()
  if (existsSync(sessionFile(dir))) locked(dir, () => reconcileListener(dir, { touch: true }))
  // PROTO_NO_GC=1 (the smoke run sets it) leaves every other session and tailnet rule alone.
  if (process.env.PROTO_NO_GC !== '1') await gc(true)
  const project = projectRoot()
  if (!existsSync(sessionFile(dir))) scaffold(dir, project)
  else if (!flags['no-serve']) await update(dir)
  beat(dir)
  let s = readSession(dir)
  // --name names this conversation; the page's title is the project's.
  registerSession(dir, sessionId(), { name: typeof flags.name === 'string' ? flags.name : undefined, lang: langFlag() ?? undefined })
  if (langFlag() && langFlag() !== (s.lang ?? 'en')) s = patchSession(dir, { lang: langFlag() })
  // --no-serve: the app and the registry only, no install, server or tailnet (the CLI checks).
  if (flags['no-serve']) return console.log(`dir ${dir}`)
  if (!existsSync(join(dir, 'node_modules', 'vite'))) install(dir)

  if (!await running(s)) {
    const port = await localPort(s)
    s = patchSession(dir, { port, stoppedAt: null, stopReason: null })
    mkdirSync(join(dir, '.proto'), { recursive: true })
    const log = openSync(join(dir, '.proto', 'dev.log'), 'a')
    // A ceiling on the server's JS heap: it idles near 200 MB, so this only stops a runaway,
    // which exits and is restarted by the next `proto up`.
    const child = spawn(process.execPath, [`--max-old-space-size=${MAX_HEAP_MB}`, join(dir, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: dir, detached: true, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, PROTO_SKILL: SKILL } })
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
  for (const line of imageTools()) console.log(line)
  printListener(dir)
}

function add() {
  const dir = sessionDir()
  const s = need(dir)
  let slug = args[0]
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) die('give a slug like "hero-sections" (lowercase, digits, dashes)')
  // The project's tree is shared: a slug another conversation made gets a fresh one (home-2), unless
  // --join adds to that prototype.
  const sid = sessionId(), taken = readMeta(dir, slug)
  if (taken?.session && taken.session !== sid && !flags.join) {
    let n = 2
    while (existsSync(join(dir, 'src', 'protos', `${slug}-${n}`))) n++
    console.log(`"${slug}" is ${taken.title || slug}, made in another conversation, so this one is "${slug}-${n}" (--join adds to it instead).`)
    slug = `${slug}-${n}`
  }
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
    if ((flags['from-picks'] || refs.length > 1) && flags.slot === undefined && !current().slot) set.referenceOnly = true
    else if (flags['reference-only'] !== true && !flags.next) drop.push('referenceOnly')
    if (refs.length > 1) set.also = refs.slice(1)
    else drop.push('also')
    if (flags['from-picks']) console.log(`from ${refs.join(', ')}`)
  }
  // A prototype made to stand in for one element of a variant: that variant must already hold the
  // element in a <Slot>, so the page has something to plug the pick into.
  let slotIn = null
  if (flags['reference-only']) {
    if (flags.slot !== undefined) die('--reference-only and --slot cannot be used together')
    if (current().slot) die('this prototype already fills a slot; keep its connection with --slot')
    if (!set.from && !current().from) die('--reference-only needs a parent (--from)')
    set.referenceOnly = true
  }
  // The variant's next versions: separate designs that succeed it, so a pick among them is built
  // into it (and on up, through parents that are next versions too).
  if (flags.next) {
    if (flags.slot !== undefined) die('--next and --slot cannot be used together')
    if (current().slot) die('this prototype already fills a slot; keep its connection with --slot')
    if (!set.from && !current().from) die('--next needs a parent (--from)')
    set.referenceOnly = true
    set.next = true
  } else if (flags.from !== undefined || flags['from-picks'] || flags['reference-only'] || flags.slot !== undefined) drop.push('next')
  if (flags.slot !== undefined) {
    if (!kit.slot) die('--slot needs the React stack for now')
    if (flags.slot === true || !/^[a-z][a-z0-9-]*$/.test(flags.slot)) die('--slot takes the slot\'s id, like cta')
    const [parent, letter = ''] = (flags.from === undefined || flags.from === true ? '' : String(flags.from).split(',')[0].trim()).split('/')
    if (!parent || !letter) die('--slot needs --from <slug>/<letter>: the variant that holds the slot')
    const file = ['tsx', 'jsx'].map(x => join(dir, 'src', 'protos', parent, `${letter}.${x}`)).find(f => existsSync(f))
    if (!file || !new RegExp(`<Slot\\s+proto="${parent}"\\s+id="${flags.slot}"`).test(readFileSync(file, 'utf8'))) die(`${parent}/${letter} has no <Slot proto="${parent}" id="${flags.slot}" …>: wrap the element in it first (SKILL.md, "Plug a variant into what it was made from")`)
    set.slot = flags.slot
    drop.push('referenceOnly')
    slotIn = { parent, letter, id: flags.slot }
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
  // A saved Current is A, first in the list, whether or not --variants named it.
  if (flags.current && !current().variants.A && !list.some(e => e.split(':')[0] === 'A')) added.A = 'Current'
  for (const entry of list) {
    const [id, ...rest] = entry.split(':')
    if (!/^[A-Z]{1,2}$/.test(id)) die(`variant ids are capital letters (A, B … AA): "${id}"`)
    const name = rest.join(':').trim() || id
    added[id] = name
    const file = join(pdir, `${id}.${kit.ext}`)
    if (!existsSync(file)) { writeFileSync(file, stubOf(stub, id, name)); fresh.push(id) }
  }
  if (design) {
    useKit(dir, pdir, slug, design, flags.current && { file: join(pdir, `A.${kit.ext}`), stub: stubOf(stub, 'A', added.A ?? current().variants.A) })
    // A saved Current is already built.
    if (flags.current && fresh.includes('A')) fresh.splice(fresh.indexOf('A'), 1)
  }
  // meta.ts goes last, so the page sees the prototype with all its variants at once. It is read
  // again just before: a pick made in the page meanwhile is written by the dev server, and stays.
  // The variant list goes last, where it is easiest to read.
  // session: the conversation that made it; owner: the one working on it now (scripts/project.mjs).
  const { variants, ...head } = { ...current(), ...set, ...(existsSync(metaFile) ? {} : { session: sid }), owner: sid }
  for (const k of drop) delete head[k]
  const meta = { ...head, variants: { ...variants, ...added } }
  // How many directions it was started with: the page's More variants asks for that many again.
  if (!existsSync(metaFile) && !meta.count && Object.keys(meta.variants).length) meta.count = Object.keys(meta.variants).length
  writeWhole(metaFile, `// Prototype: ${String(meta.title).replace(/[\r\n\u2028\u2029]+/g, ' ')}. Variant files are named by their letter; names live here.\nexport default ${JSON.stringify(meta, null, 2)}\n`, scratchOf(dir))
  // The parent learns where its slot is held; a pointer already set there is kept.
  if (slotIn) {
    const pf = join(dir, 'src', 'protos', slotIn.parent, 'meta.ts'), ptext = readFileSync(pf, 'utf8')
    const pm = JSON.parse(ptext.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
    pm.slots = { ...pm.slots, [slotIn.id]: { ...pm.slots?.[slotIn.id], variant: slotIn.letter } }
    writeWhole(pf, withMeta(ptext, pm), scratchOf(dir))
  }
  // A new variant is building until `proto done`: the page marks it, and an edit that throws keeps
  // its last good frame instead of an error.
  if (fresh.length) {
    const at = new Date().toISOString()
    patchSession(dir, now => ({ building: { ...now.building, ...Object.fromEntries(fresh.map(id => [`${slug}/${id}`, at])) } }))
  }
  console.log(`${pdir}: ${Object.keys(meta.variants).map(id => `${id}.${kit.ext}`).join(' ') || 'no variants'}`)
  if (s.url) console.log(`${s.url}${slug}`)
  if (kit.slot && typeof meta.from === 'string' && meta.from.includes('/') && !meta.slot && !meta.referenceOnly) console.log(`assignment needed: if these variants replace part of ${meta.from}, wrap that element in <Slot> and connect ${slug} with --from ${meta.from} --slot <id> before presenting them. Use --reference-only only for a separate design that uses the parent as a reference.`)
}

// A placeholder for a variant, from one of app/stubs/: its name kept on one line, which the
// "Placeholder while" header needs.
// Its words follow the session's language (`proto up --lang`); the header stays English, the tools read it.
const stubOf = (template, id, name) => localStub(template.replaceAll('__ID__', () => id).replaceAll('__NAME__', () => name.replace(/[\r\n]+/g, ' ')))
const STUB_WORDS = {
  he: { 'Planning the look': 'מתכנן את המראה', 'Plan and look chosen': 'התוכנית והמראה נבחרו', 'Writing the first screen': 'כותב את המסך הראשון',
    'Content and interactions': 'תוכן ואינטראקציות', 'Checks and screenshots': 'בדיקות וצילומי מסך', '>Building<': '>בבנייה<' },
}
const RTL_LANGS = new Set(['he'])
function localStub(text) {
  const lang = readSession(sessionDir())?.lang
  const words = STUB_WORDS[lang]
  if (!words) return text
  const [head, ...body] = text.split('\n')
  let out = body.join('\n')
  // Step labels are quoted strings; '>Building<' is the text of an element.
  for (const [en, local] of Object.entries(words)) out = en.startsWith('>') ? out.replaceAll(en, local) : out.replaceAll(`'${en}'`, `'${local}'`)
  if (RTL_LANGS.has(lang)) out = out.replace('dir="ltr"', `dir="rtl" lang="${lang}"`)
  return [head, out].join('\n')
}
// What one line of a direction's plan holds (.proto/briefs/<slug>.json), shown on its placeholder.
const PLAN_KEYS = ['name', 'concept', 'display', 'body', 'surface', 'ink', 'accent', 'signature']

// The one-line plans are written: each variant still on its placeholder shows its own (name, concept,
// display face, colors) until its first real write. A variant already written is left alone.
function plan() {
  const dir = sessionDir()
  const s = need(dir)
  const slug = args[0]
  const pdir = join(dir, 'src', 'protos', slug || '')
  if (!slug || !existsSync(join(pdir, 'meta.ts'))) die('which prototype? proto plan <slug> (after proto add)')
  const file = join(dir, '.proto', 'briefs', `${slug}.json`)
  const brief = readJson(file, null) || die(`write the one-line plans to ${tilde(file)} first: { "facts": "…", "directions": { "A": { ${PLAN_KEYS.map(k => `"${k}"`).join(', ')} } } }`)
  // Each direction once, its font specs without a font('…') around them, and its script: the
  // brief's "script" (or the direction's own), else the one its name and concept are written in.
  const spec = v => String(v ?? '').trim().replace(/^font\(\s*['"]?|['"]?\s*\)$/g, '')
  const scriptOf = d => d.script || brief.script || (/[֐-׿]/.test(`${d.name} ${d.concept}`) ? 'hebrew' : /[؀-ۿ]/.test(`${d.name} ${d.concept}`) ? 'arabic' : 'latin')
  const directions = Object.entries(brief.directions || {}).map(([id, d]) => {
    const p = { ...d, display: spec(d.display), body: spec(d.body), script: scriptOf(d) }
    return [id, { ...p, family: p.display.split(':')[0].trim(), rtl: ['hebrew', 'arabic', 'persian', 'urdu'].includes(p.script) }]
  })
  // Title faces come from the catalog's display faces for the direction's script, or the brand's own
  // faces listed in "brandFonts". A script the catalog has no pairings for keeps only the
  // never-for-titles list, which otherwise just words the refusal.
  const cat = readJson(join(SKILL, 'references', 'fonts.json'), {})
  const never = new Map((cat.neverTitle || []).map(n => [n.family.toLowerCase(), n.why]))
  const titles = script => new Set((cat.pairings || []).filter(p => p.script === script).map(p => p.display.family.toLowerCase()))
  const brand = new Set((brief.brandFonts || []).map(f => String(f).toLowerCase()))
  const banned = directions.map(([id, d]) => {
    const f = d.family.toLowerCase(), ok = titles(d.script)
    return [id, d.family, !f ? 'no display face' : brand.has(f) ? '' : never.get(f) || (!ok.size || ok.has(f) ? '' : `not a ${d.script} title face in the catalog`)]
  }).filter(([, , why]) => why)
  if (banned.length) die(`not a title face: ${banned.map(([id, f, why]) => `${id} ${f || '?'} (${why})`).join(', ')}. Title faces come from \`proto fonts\` (references/fonts.json), or the brand's own faces in "brandFonts". Choose another for ${banned.map(([id]) => id).join(', ')}.`)
  const kit = STACKS[s.stack]
  const card = readFileSync(join(APP, 'stubs', kit.plan), 'utf8')
  const shown = []
  for (const [id, d] of directions) {
    const f = join(pdir, `${id}.${kit.ext}`)
    if (!existsSync(f) || !/^(\/\/|<!--) Placeholder while /.test(readFileSync(f, 'utf8'))) continue
    const data = { ...Object.fromEntries(PLAN_KEYS.map(k => [k, d[k] ? String(d[k]) : null])), displayFamily: d.family, bodyFamily: d.body.split(':')[0].trim() || null }
    writeFileSync(f, stubOf(card, id, String(d.name || id)).replace('__PLAN__', () => JSON.stringify(data)))
    shown.push(id)
  }
  console.log(shown.length ? `plans shown: ${shown.join(', ')}` : 'no placeholders left to show a plan on')
}

// A variant is built (its checks passed): the page drops its Building mark and shows its errors
// again. `proto done <slug>` ends every variant of that prototype.
async function done() {
  const dir = sessionDir()
  need(dir)
  if (!args.length) die('which variant? proto done <slug>/<letter> (or <slug> for all of its variants)')
  const ended = endBuilding(dir, args)
  // One line: agents read this command's output through `tail -1`.
  const { closed, pending, shared } = locked(dir, () => closeWaiting(dir))
  await reportShared(dir, shared, 'done')
  console.log(`${ended.length ? `built: ${ended.join(', ')}` : `nothing was building there (${args.join(', ')})`}${closed.length ? ` · closed ${closed.join(', ')}` : ''}${pending.length ? ` · assignment pending for ${pending.join(', ')} (run proto inbox)` : ''}`)
}

// The Building marks among `building` that belong to each <slug>/<letter> (or every variant of a <slug>).
const marksOf = (building = {}, refs) => Object.keys(building).filter(k => refs.some(ref => ref.includes('/') ? k === ref : k.startsWith(`${ref}/`)))

// Ends the Building mark of each <slug>/<letter> (or every variant of a <slug>); returns the keys ended.
function endBuilding(dir, refs) {
  let ended = []
  patchSession(dir, now => {
    const building = { ...now.building }
    ended = marksOf(building, refs)
    for (const k of ended) delete building[k]
    return { building }
  })
  return ended
}

// A comment answered with `proto reply … --until <slug>` waits on that work, which the page shows
// as "Claude is on it" with the reply. Once none of it is building, it is done. Without this, a
// comment whose answer was a new prototype stayed "on it" after the prototype was built, since
// nothing came back to close it. Returns closed and pending assignment refs. Run under the lock.
function closeWaiting(dir) {
  const building = readSession(dir)?.building
  const closed = [], pending = [], shared = []
  for (const id of batchesIn(dir, 'taken')) {
    const file = join(inboxDir(dir), 'taken', id, 'batch.json')
    const b = readJson(file, null)
    const ready = (b?.comments || []).filter(c => c.until?.length && !c.done && !marksOf(building, c.until).length)
    if (!ready.length) continue
    for (const c of ready) {
      if (pendingAssignment(dir, c)) pending.push(`${id}/${c.n}`)
      else { c.done = true; closed.push(`${id}/${c.n}`); if (c.from) shared.push(c) }
    }
    b.done = b.comments.every(c => c.done)
    writeJson(file, b)
  }
  return { closed, pending, shared }
}

// meta.ts with its object replaced. Through a function: a replacement string would read `$&` or `$$`
// in a variant's name as a pattern and write something else.
const withMeta = (text, meta) => text.replace(/export default[\s\S]*$/, () => `export default ${JSON.stringify(meta, null, 2)}\n`)

// The same rule as the page's pick (app/server.mjs plug): a prototype with a slot plugs its pick
// into the prototype it was made from; the variant called Current, or no pick, is the original.
// Says what it did ({ where, parent, letter, was, now }: `was` and `now` are the slot's `use`
// before and after, '' for none), or null when nothing changed.
function plug(dir, slug, meta, id, off) {
  if (!meta.slot || typeof meta.from !== 'string' || !id) return null
  const [parent, from] = meta.from.split('/')
  const f = join(dir, 'src', 'protos', parent, 'meta.ts')
  let text, pm
  try { text = readFileSync(f, 'utf8'); pm = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')) } catch { return null }
  const slot = pm.slots?.[meta.slot]
  if (!slot) return null
  const use = `${slug}/${id}`
  if (off && slot.use !== use) return null
  const next = off || isCurrent(meta.variants?.[id]) ? '' : use
  if ((slot.use || '') === next) return null
  const { use: _, ...rest } = slot
  pm.slots[meta.slot] = next ? { ...rest, use: next } : rest
  writeWhole(f, withMeta(text, pm), scratchOf(dir))
  return { where: `${meta.from} (${meta.slot})`, parent, letter: String(slot.variant || from || ''), was: slot.use || '', now: next }
}
// What a plug-in says in the history of the two variants it touches, after the "Picked" line, with
// the words the page's strip shows (app/server.mjs plugLines is the same). The working variant stays.
function notePlug(dir, did, slug, id) {
  const title = s => { try { return readMeta(dir, s)?.title || s } catch { return s } }
  const [was, wasId] = did.was.split('/')
  const into = [title(did.parent), did.letter].filter(Boolean).join(' ')
  const lines = [
    [`${slug}/${id}`, did.now ? `Plugged into ${into}` : `Original back in ${into}`],
    ...(did.letter ? [[`${did.parent}/${did.letter}`, did.now ? `Plugged in ${title(slug)} ${id}` : `Original back, took out ${title(was)} ${wasId}`]] : []),
  ]
  const at = new Date().toISOString()
  patchSession(dir, now => {
    const asks = { ...now.asks }
    for (const [key, text] of lines) asks[key] = [...(asks[key] || []), { at, text }]
    return { asks }
  })
}

// The user chose a variant ("go with A"): the page marks it and lists it first. The other
// variants stay, and so does everything built from this prototype.
// The CLI's twin of the page's pickParents (app/server.mjs): a pick also picks the variant the prototype
// was built from (`from: "<parent>/<letter>"`), and so on up the chain; `also` parents, archived
// parents and ones already picked are left alone. Returns the routes it picked.
function pickParents(dir, slug) {
  const picked = [], seen = new Set([slug])
  let from
  try { from = readMeta(dir, slug)?.from } catch { return picked }
  while (typeof from === 'string' && from.includes('/')) {
    const [parent, letter] = from.split('/')
    if (!letter || seen.has(parent)) break
    seen.add(parent)
    const f = join(dir, 'src', 'protos', parent, 'meta.ts')
    let text, pm
    try { text = readFileSync(f, 'utf8'); pm = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')) } catch { break }
    if (!pm.archived && pm.variants?.[letter] && !pm.picked) {
      pm.picked = letter
      writeWhole(f, withMeta(text, pm), scratchOf(dir))
      picked.push(`${parent}/${letter}`)
    }
    from = pm.from
  }
  return picked
}

function pick() {
  const dir = sessionDir()
  need(dir)
  // proto pick hero 29, hero AC or hero/29: the variant by the number the page shows, or its letter.
  const [slug, given] = args[0]?.includes('/') ? args[0].split('/') : args
  const id = idOf(given) || given
  const metaFile = join(dir, 'src', 'protos', slug || '', 'meta.ts')
  if (!slug || !existsSync(metaFile)) die('which prototype? proto pick <slug> <number>')
  const text = readFileSync(metaFile, 'utf8')
  const meta = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  const was = meta.picked
  if (flags.off) delete meta.picked
  else if (!id || !meta.variants?.[id]) die(`which variant of ${slug}? (${choices(meta)})`)
  else meta.picked = id
  stampOwner(meta)
  // Before the pick is marked: if the parent can't be written, nothing is marked and this can be run again.
  const letter = flags.off ? was : id
  const plugged = plug(dir, slug, meta, letter, !!flags.off)
  writeWhole(metaFile, withMeta(text, meta), scratchOf(dir))
  const parents = flags.off ? [] : pickParents(dir, slug)
  // The pick is what gets worked on next; its history starts here.
  if (!flags.off) setWork(dir, { proto: slug, variant: id }, `Picked ${id}`)
  if (plugged) try { notePlug(dir, plugged, slug, letter) } catch { /* a trace in the history, never a failed pick */ }
  const back = flags.off || isCurrent(meta.variants?.[letter])
  console.log((flags.off ? `${slug}: no pick` : `${slug}: picked ${shown(id)} · ${meta.variants[id]}`) + (plugged ? ` · ${back ? 'original back in' : 'plugged into'} ${plugged.where}` : '') + (parents.length ? ` · also picked ${parents.join(', ')}` : ''))
  if (!flags.off) {
    const pending = assignmentNeeded(dir, slug, id) || buildUpNeeded(dir, slug, id)
    if (pending) console.log(pending)
  }
}

// ---------- favorites ----------
// The user's stars, for finding variants again among many: `favorites` in meta.ts (letter IDs),
// which the page's Favorite (its menu, or S) writes too. They ask nothing of the agent.
//   proto fav                      every prototype's favorites, by number
//   proto fav <slug>               that prototype's
//   proto fav <slug>/<n> […] [--off]   star (or unstar) those variants
function fav() {
  const dir = sessionDir()
  need(dir)
  const root = join(dir, 'src', 'protos')
  const sorted = list => [...new Set(list)].sort((a, b) => a.length - b.length || a.localeCompare(b))
  const line = (slug, m) => `${slug}: ${(m.favorites || []).length ? m.favorites.map(id => `${numberOf(id) ? `#${numberOf(id)}` : id} · ${m.variants?.[id] ?? id}`).join(', ') : 'no favorites'}`
  const marks = args.filter(a => a.includes('/'))
  if (!marks.length) {
    const slugs = args.length ? args : (existsSync(root) ? readdirSync(root) : []).filter(s => existsSync(join(root, s, 'meta.ts')))
    const rows = []
    for (const slug of slugs) {
      const m = readMeta(dir, slug)
      if (!m) die(`no prototype "${slug}" here`)
      if (args.length || m.favorites?.length) rows.push(line(slug, m))
    }
    return console.log(rows.join('\n') || 'no favorites yet')
  }
  const bySlug = new Map()
  for (const spec of marks) { const t = target(dir, spec); bySlug.set(t.proto, [...(bySlug.get(t.proto) || []), t.variant]) }
  for (const [slug, ids] of bySlug) {
    const f = join(root, slug, 'meta.ts'), text = readFileSync(f, 'utf8'), m = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
    const was = Array.isArray(m.favorites) ? m.favorites : []
    const now = sorted(flags.off ? was.filter(x => !ids.includes(x)) : [...was, ...ids])
    if (now.length) m.favorites = now
    else delete m.favorites
    stampOwner(m)
    writeWhole(f, withMeta(text, m), scratchOf(dir))
    console.log(line(slug, m))
  }
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
  if (!meta) die(`no prototype "${proto || ''}" here: give <slug>/<number>`)
  if (!variant || !meta.variants?.[variant]) die(`which variant of ${proto}? (${choices(meta)})`)
  return { proto, variant, name: meta.variants[variant] }
}
// The conversation working on a prototype now takes its comments (app/server.mjs). The variant
// list stays last in meta.ts.
function stampOwner(m) {
  const { variants } = m
  delete m.variants
  m.owner = sessionId()
  if (variants) m.variants = variants
  return m
}
function own(dir, slug) {
  const f = join(dir, 'src', 'protos', slug, 'meta.ts'), sid = sessionId()
  if (!existsSync(f)) return
  const text = readFileSync(f, 'utf8'), m = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  if (m.owner !== sid) writeWhole(f, withMeta(text, stampOwner(m)), scratchOf(dir))
}
/** Points the session at a variant; the one it leaves goes first in `before` (three kept). */
function setWork(dir, t, ask) {
  own(dir, t.proto)
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
    keepVersion(dir, t, [ask], at)
  }
  patchSession(dir, patch)
}
// Each ask is about to change the variant: keep it as it is now first (app/history.mjs), so the
// page can show it beside what the change made. Never in the way of the ask itself.
function keepVersion(dir, t, texts, at) {
  try { for (const text of texts) snapshot(dir, t.proto, t.variant, text, { at }) }
  catch (e) { console.error(`proto: couldn't keep ${t.proto}/${t.variant} as it was (${e.message}); the ask is noted`) }
}

function work() {
  const dir = sessionDir()
  const s = need(dir)
  if (flags.off) { patchSession(dir, { work: null }); return console.log('no working variant') }
  if (!args[0]) return console.log(s.work ? `working on ${routeShown(`${s.work.proto}/${s.work.variant}`)}` : 'no working variant')
  const t = target(dir, args[0])
  setWork(dir, t, typeof flags.ask === 'string' ? flags.ask.trim() : '')
  console.log(`working on ${routeShown(`${t.proto}/${t.variant}`)} · ${t.name}`)
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
  own(dir, t.proto)
  keepVersion(dir, t, texts, at)
  patchSession(dir, now => ({ asks: { ...now.asks, [key]: [...(now.asks?.[key] || []), ...texts.map(text => ({ at, text }))] } }))
  const n = versionsOf(dir, t.proto, t.variant).length
  console.log(`${key}: ${(s.asks?.[key]?.length || 0) + texts.length} asks${n ? ` · ${n} earlier version${n === 1 ? '' : 's'} kept (proto history ${key})` : ''}`)
}

// proto brief <slug>: the prototype's decision brief (app/brief.mjs), for the team and for whoever
// builds it: kept at .proto/decisions/<slug>.md and printed.
function briefCmd() {
  const dir = sessionDir()
  need(dir)
  const slug = String(args[0] || '').split('/')[0]
  if (!slug) die('which prototype? proto brief <slug>')
  const made = writeBrief(dir, slug)
  if (!made) die(`no prototype "${slug}" here`)
  console.log(made.markdown)
  console.log(`(kept at ${made.file}${made.picked ? '' : '; nothing is picked yet'}${made.open ? `; ${made.open} comment${made.open === 1 ? '' : 's'} still open` : ''})`)
}

// proto history <slug>/<letter> [--save "…"]: the variant's earlier versions, kept before each
// change asked for (proto ask, proto work --ask, a pick in the page); --save keeps one now, by hand.
// The page shows any of them beside the variant as it is now (History, in the variant's tools).
function history() {
  const dir = sessionDir()
  need(dir)
  if (!args[0]) die('which variant? proto history <slug>/<number> [--save "…"]')
  const t = target(dir, args[0]), key = `${t.proto}/${t.variant}`
  if (flags.save !== undefined) {
    const note = typeof flags.save === 'string' ? flags.save : ''
    const kept = snapshot(dir, t.proto, t.variant, '', { note })
    if (!kept) die(`${routeShown(key)} has no file to keep`)
    console.log(kept.created ? `kept ${routeShown(key)} as version ${kept.n}` : `nothing changed since version ${kept.n}; not kept again`)
    return
  }
  const all = versionsOf(dir, t.proto, t.variant)
  if (!all.length) return console.log(`${routeShown(key)} has no earlier versions yet: one is kept before each change asked for (proto ask), or now with --save "…"`)
  console.log(`${routeShown(key)} · ${t.name}: ${all.length} earlier version${all.length === 1 ? '' : 's'}, then now`)
  for (const v of all) console.log(`  ${v.n}. ${v.at.slice(0, 16).replace('T', ' ')}  ${versionLabel(v)}`)
  console.log(`In the page: ${key}, History in its tools (or ${(readSession(dir).url || readSession(dir).localUrl || '').replace(/\/$/, '')}/${key}/~history)`)
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
  if (meta.archived) endBuilding(dir, [args[0]])
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
  const listener = listenerStatus(dir)
  if (listener.id && listener.hostEnabled) {
    printListener(dir)
    die('disable the owned host task and confirm with proto inbox --host-disabled <id> before deleting its local identity')
  }
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
    // Retain listener identity/opt-out for explicit reopening, and never delete pending
    // feedback. GC cannot disable another thread's task. Explicit rm can retire the record.
    if (!s.keep && !existsSync(listenerFile(dir)) && !pendingListenerWork(dir) && age > (s.deleteDays ?? DELETE_DAYS)) {
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
  if (flags.pin !== undefined) return shootPin(dir, s, out)
  const clicked = new Set(argv.filter((a, i) => argv[i - 1] === '--click'))
  let routes = args.filter(a => !clicked.has(a)).length ? args.filter(a => !clicked.has(a)) : ['']
  if (flags.parallax !== undefined && !/^-?(0|1|0?\.\d+)(,-?(0|1|0?\.\d+))$/.test(String(flags.parallax))) die('--parallax is <x>,<y>, each from -1 to 1: 1,1 and -1,-1 are the two ends of the travel')
  const extra = ['theme', 'focus', 'copy', 'parallax'].filter(k => flags[k]).map(k => `--${k}=${flags[k] === true ? '1' : flags[k]}`)
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

// --pin <batch>[/<n>]: the comment (or every comment of the batch that is on an element) as its
// writer saw it. The batch is read where it is (taken, or still new: reading it does not take it),
// and shoot.mjs gets one entry per comment: its route (in --state's state when given), the page
// size and theme it was written in (a device view's size, when it was written in one), its element
// and the controls that open the way there, and its pictures.
async function shootPin(dir, s, out) {
  const ref = flags.pin === true ? '' : String(flags.pin)
  const [prefix, nth, more] = ref.split('/')
  if (!prefix || more !== undefined || (nth !== undefined && !/^\d+$/.test(nth))) die('--pin takes a batch, or one comment of it, as proto inbox prints them: proto shoot --pin <batch>/<n>')
  for (const k of ['sheet', 'ref', 'as', 'at', 'frames', 'size', 'click', 'copy', 'focus', 'parallax']) if (flags[k] !== undefined) die(`--pin shoots what a comment is on: not with --${k}`)
  if (args.length) die(`--pin finds its route in the comment: leave out ${args.join(' ')}`)
  const found = ['taken', 'new'].flatMap(sub => batchesIn(dir, sub).filter(id => id.startsWith(prefix)).map(id => ({ id, sub })))
  if (found.length !== 1) die(found.length ? `"${prefix}" matches ${found.length} batches; give more of the id` : `no batch "${prefix}" in the inbox (proto inbox prints their ids)`)
  const folder = join(inboxDir(dir), found[0].sub, found[0].id)
  const b = readJson(join(folder, 'batch.json'), null)
  if (!b) die(`batch ${found[0].id}: its batch.json could not be read`)
  const whole = n => n.target && !n.withdrawn && !n.action
  let list
  if (nth !== undefined) {
    const c = b.comments.find(x => x.n === Number(nth))
    if (!c) die(`batch ${b.id} has no comment ${nth} (1-${b.comments.length})`)
    if (c.withdrawn) die(`${b.id}/${nth} was withdrawn in the page`)
    if (c.action) die(`${b.id}/${nth} is a ${c.action} decision: nothing to shoot`)
    if (!c.target) die(`${b.id}/${nth} is not on an element: nothing to shoot`)
    list = [c]
  } else {
    list = b.comments.filter(whole)
    const left = b.comments.filter(c => !c.withdrawn && !whole(c)).map(c => c.n)
    if (left.length) console.error(`batch ${b.id}: ${left.join(', ')} ${left.length === 1 ? 'is' : 'are'} not on an element (decisions, or on the motion only), so not shot`)
    if (!list.length) die(`batch ${b.id} has no comment on an element`)
  }
  const num = (k, d, lo, hi) => {
    if (flags[k] === undefined) return d
    const v = Number(flags[k])
    if (!Number.isInteger(v) || v < lo || v > hi) die(`--${k} is a whole number from ${lo} to ${hi}`)
    return v
  }
  const margin = num('margin', 24, 0, 400), after = num('after', 0, 0, 10000)
  if (flags.state === true) die('--state takes a state id from the prototype\'s meta.ts: --state row-menu')
  if (flags.theme !== undefined && !['dark', 'light'].includes(flags.theme)) die('--theme is dark or light')
  const pins = list.map(c => {
    let route = c.route
    if (flags.state) {
      const [slug, letter] = route.split('/')
      let meta = null
      try { meta = readMeta(dir, slug) } catch { /* not plain JSON */ }
      const ids = (meta?.states || []).map(x => x.id)
      if (!ids.includes(flags.state)) die(`${slug} has no state "${flags.state}"${ids.length ? ` (it has ${ids.join(', ')})` : ''}`)
      route = `${slug}/${letter}/${flags.state}`
    }
    const page = c.view ? { width: c.view.w, height: c.view.h, framed: true, view: c.view.size } : { width: b.viewport?.w || 1440, height: b.viewport?.h || 900 }
    if (!c.view && !b.viewport?.w) console.error(`batch ${b.id} has no page size; shooting at 1440x900`)
    return {
      batch: b.id, n: c.n, route, text: c.text, theme: flags.theme || b.theme || 'light', ...page,
      target: c.target, point: c.point, ...(c.region ? { region: c.region } : {}), ...(c.take ? { take: c.take, at: c.at } : {}),
      images: (c.images || []).map(im => ({ file: join(folder, im.file), name: im.name })),
      margin, after, hover: !!flags.hover,
      // The stage the design was in when the comment was made, and the design's saved settings
      // (its localStorage) when the batch was sent: batches from before these were recorded have neither.
      ...(c.target.stage ? { stage: c.target.stage } : {}),
      ...(b.storage ? { storage: b.storage } : {}),
    }
  })
  mkdirSync(out, { recursive: true })
  const spec = join(out, `.pin-${process.pid}.json`)
  writeJson(spec, pins)
  const r = run(process.execPath, [join(SKILL, 'scripts', 'shoot.mjs'), s.localUrl, out, ...pins.map(p => p.route), `--pin=${spec}`], { stdio: 'inherit' })
  rmSync(spec, { force: true })
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
  // A <Slot> in a file stands for the variant the page has plugged in: that is what the build is of,
  // so its files join the list (nested slots too, as the list grows). An archived child plugs
  // nothing in, as in the page.
  const fileOf = (proto, letter) => [STACKS[s.stack]?.ext, 'tsx', 'jsx', 'vue'].filter(Boolean).map(x => join(dir, 'src', 'protos', proto, `${letter}.${x}`)).find(f => existsSync(f))
  const metaIn = slug => { try { return readMeta(dir, slug) } catch { return null } }
  const slots = []
  for (let i = 0; i < files.length; i++) {
    for (const m of readFileSync(files[i].file, 'utf8').matchAll(/<Slot\s+proto="([^"]+)"\s+id="([^"]+)"/g)) {
      const use = metaIn(m[1])?.slots?.[m[2]]?.use
      const [from, letter] = String(use || '').split('/')
      const f = from && letter && !metaIn(from)?.archived && fileOf(from, letter)
      if (!f || slots.some(x => x.proto === m[1] && x.id === m[2])) continue
      slots.push({ proto: m[1], id: m[2], use, file: f, in: files[i].file })
      for (const x of variantFiles(join(dir, 'src', 'protos'), f)) {
        if (!files.some(y => y.file === x.file)) files.push({ ...x, by: x.by || files[i].file, ...(x.by ? {} : { via: `${m[1]}/${m[2]}` }) })
      }
    }
  }
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

  section('Files', files.map(x => `${x.file}${x.via ? ` (plugged into ${rel(x.by)} by slot ${x.via})` : x.by ? ` (imported by ${rel(x.by)})` : ''}`))
  section('Slots', slots.map(x => `${x.id} in ${rel(x.in)} is ${x.use} (${rel(x.file)}), not the markup written there: build the plugged-in design in its place`))
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
    const file = join(inboxDir(dir), 'taken', id, 'batch.json')
    const b = readJson(file, null)
    if (b) {
      // Who took it, so a batch whose taker died before answering is told from one being worked on.
      if (agentPid() && !b.done) { b.takenBy = { pid: agentPid(), at: new Date().toISOString() }; try { writeJson(file, b) } catch { /* the page then reads it as taken */ } }
      taken.push(b)
    }
    else tell(id, 'was taken, but its batch.json could not be read')
  }
  return taken
}

// Comments a session took and never answered, because it ended (T3 Code restarted, the terminal
// closed): handed to the agent that takes the inbox next, in full and once. The batch becomes that
// agent's, so if this one ends too, the next gets it.
function orphans(dir) {
  const found = []
  for (const id of batchesIn(dir, 'taken')) {
    const file = join(inboxDir(dir), 'taken', id, 'batch.json')
    const b = readJson(file, null)
    if (!b?.takenBy?.pid || b.done || alive(b.takenBy.pid)) continue
    const open = b.comments.filter(c => !c.done && !c.withdrawn && ((!c.reply && !c.until) || c.assignment || c.buildUp))
    if (!open.length) continue
    const now = agentPid()
    locked(dir, () => {
      const cur = readJson(file, null)
      if (cur?.takenBy?.pid !== b.takenBy.pid) return
      if (now) cur.takenBy = { pid: now, at: new Date().toISOString() }; else delete cur.takenBy
      writeJson(file, cur)
    })
    found.push({ ...b, comments: open, orphaned: true })
  }
  return found
}

// An element as the agent reads it: what it is, where it sits, and where it is written, the file
// from the app's folder with its line and the component (`src/protos/today/parts.tsx:30 (PriceCard)`).
const where = e => {
  if (!e) return ''
  // The variant as a whole (the box in the Comments panel): no element, the design's own root.
  if (e.whole) {
    const r = e.rect ? ` at ${e.rect.x},${e.rect.y} ${e.rect.w}x${e.rect.h}` : ''
    const code = e.src ? `  src/protos/${e.src}${e.component ? ` (${e.component})` : ''}` : ''
    return `the whole variant (its root <${e.tag || '?'}>${r})${code}`
  }
  const name = e.shoot ? `[data-shoot=${e.shoot}]` : e.within ? `in [data-shoot=${e.within}]` : e.selector || ''
  const r = e.rect ? ` at ${e.rect.x},${e.rect.y} ${e.rect.w}x${e.rect.h}` : ''
  const code = e.src ? `  src/protos/${e.src}${e.component ? ` (${e.component})` : ''}` : ''
  // In something that opens (a menu, a popup, a tab's panel): the controls that open the way to it.
  const route = e.route?.length ? `  (opened by ${e.route.join(' > ')})` : ''
  return [`<${e.tag || '?'}>`, e.text && `"${e.text.replace(/\s+/g, ' ').slice(0, 80)}"`, name].filter(Boolean).join(' ') + r + code + route
}
// A decision made on a variant in the page comes as a comment with an action and no element; the
// line under it says what is already done and what is left for the agent. A pick or unpick is made
// by the server as it arrives. A pick's note stays pending; plain picks come done, unless failed or, for
// an unpick, there was no pick there to take back.
const ACTIONS = {
  pick: 'done: marked in the page and now the working variant; a reply is only a note',
  unpick: 'done: the pick is off in the page; a reply is only a note',
  'more-variants': 'new variants in this prototype (the route is the prototype; count says how many): continue its letters with proto add <slug> --variants "…", each a new direction, different from the existing variants and from each other',
  build: 'build this variant into the codebase',
  'try-it': 'add useHints for this variant only: useful demo values, steps and scenarios; preserve the working design; reply --done after checking it',
  'copy-options': 'add useCopy for this variant only: headline and primary text by default, or the requested lines; keep current words first, add 2 to 4 alternatives; reply --done after checking fit. On an element with quoted words (highlighted in the page): options for those words only, as one useCopy line on that element (data-copy)',
  copy: 'make this the line\'s text in the variant: put it first in that line\'s useCopy options',
  'share-fix': 'asked from a share review, before the link goes out: change the prototype so the findings quoted in the text are gone, the way the user\'s words say (inline or swap an asset, use a hosted font, take out a secret); never by quieting the review. Check it with proto share file (it prints the same review without publishing), then reply --done saying what changed: the user makes the link again from the page. Do not publish it yourself unless they ask',
  intake: 'the answers to your questions: plan the directions from them (a question left to you is yours to decide; say what you picked), then reply --done',
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
function printSource(dir, src, base = join(dir, 'src', 'protos')) {
  const m = String(src).match(/^(.*):(\d+)$/)
  if (!m) return
  let lines
  try { lines = readFileSync(join(base, m[1]), 'utf8').split(/\r?\n/) } catch { return }
  const at = Number(m[2]), from = Math.max(1, at - SNIP), to = Math.min(lines.length, at + SNIP)
  const w = String(to).length
  for (let i = from; i <= to; i++) {
    const l = lines[i - 1], cut = l.length > 200 ? l.slice(0, 200) + ' …' : l
    console.log(`   ${i === at ? '>' : ' '} ${String(i).padStart(w)}| ${cut}`)
  }
}

// Which use of a shared component a comment is on. `uses` (from the page) is the chain of places the
// components around the element are used, innermost first. When any component in that chain is used in more
// than one place in the prototype, or drawn in a loop (it has a key), the comment is on that one use,
// so its line is printed with the source around it: the change goes there, not into the component.
function printUses(dir, t, route) {
  const uses = (t.uses || []).filter(u => u && u.at)
  if (!uses.length) return
  const one = u => `${u.component || '?'} at ${u.at}${u.key != null ? ` (key ${u.key})` : ''}${u.props ? ` {${u.props}}` : ''}`
  console.log(`   used: ${uses.map(one).join(' <- ')}`)
  const slug = String(route || '').split('/')[0]
  for (const [index, u] of uses.entries()) {
    let count = 0
    if (u.component && /^[A-Za-z_$][\w$]*$/.test(u.component)) {
      const re = new RegExp(`<${u.component}[\\s/>]`, 'g')
      const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(tsx|jsx|vue)$/.test(e.name)) count += (readFileSync(f, 'utf8').match(re) || []).length } }
      try { walk(join(dir, 'src', 'protos', slug)) } catch { /* no such prototype */ }
    }
    if (count < 2 && u.key == null) continue
    const why = u.key != null ? `drawn in a loop${count > 1 ? `, and written in ${count} places` : ''}` : `used in ${count} places`
    console.log(`   shared: ${u.component} is ${why}; this comment is on the one at ${u.at}${u.key != null ? ` with key ${u.key}` : ''}${u.props ? `, passed ${u.props}` : ''}. Change that one use, not ${u.component} itself, unless the words say all of them.`)
    printSource(dir, u.at)
    if (index) console.log(`   through: pass this use's variation through ${uses.slice(0, index).reverse().map(one).join(' -> ')}; changing those shared definitions alone would change the other uses too.`)
    break
  }
}

// A pick or unpick on a prototype made to stand in for part of another is plugged in there (or out
// again) by the page or `proto pick`: the source of that variant needs no edit for it.
function standsIn(dir, c) {
  if (c.action !== 'pick' && c.action !== 'unpick') return ''
  const slug = c.route.split('/')[0]
  try {
    const m = readMeta(dir, slug)
    return m?.slot && typeof m.from === 'string' ? `; ${slug} fills the ${m.slot} slot of ${m.from}, which follows the pick by itself: no source edit` : ''
  } catch { return '' }
}

// A follow-up is the user answering a reply in the page: `re` names the comment (batch, number)
// whose reply it answers, which can be a follow-up too. The turns before it, oldest first, from
// whichever folder holds each batch (one never taken can be answered too), so the agent reads the
// new words as the next line of that exchange. A reply is the comment's own, else its batch's, as
// the page shows it.
const WHO = { claude: 'Claude', codex: 'Codex', agent: 'Agent' }
const oneLine = (s, k) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > k ? `${t.slice(0, k - 1)}…` : t }
function turnsBefore(dir, re) {
  const turns = [], seen = new Set()
  for (let r = re; r && !seen.has(`${r.batch}/${r.n}`) && turns.length < 20;) {
    seen.add(`${r.batch}/${r.n}`)
    const b = ['taken', 'new'].map(sub => readJson(join(inboxDir(dir), sub, r.batch, 'batch.json'), null)).find(Boolean)
    const c = b?.comments?.find(x => x.n === r.n)
    if (!c) { turns.unshift({ gone: `${r.batch}/${r.n}` }); break }
    turns.unshift({ text: c.from ? `(quoted feedback from @${c.from.viewer}, from a link)` : c.text, reply: c.reply ?? b.reply ?? null })
    r = c.re
  }
  return turns
}

// The answers to the questions the agent asked: each question with what was answered, and where the
// files are. A question left unanswered is the agent's to decide.
function printIntake(dir, b, c) {
  const it = c.intake
  console.log(`\n${c.n}. intake: the answers to your questions${it.ask ? `  ("${oneLine(it.ask, 120)}")` : ''}`)
  for (const q of it.questions) {
    const a = it.answers[q.id] || []
    const label = id => q.options.find(o => o.id === id)?.label ?? id.replace(/^\+/, '')
    const own = a.filter(x => x.startsWith('+')).map(x => `${x.slice(1)} (their own words)`)
    const known = a.filter(x => !x.startsWith('+') && x !== '*')
    const text = q.kind === 'text' ? a.join(' ') : [...known.map(label), ...own].join(', ')
    const files = it.files.filter(f => f.question === q.id)
    const state = it.decided.includes(q.id) || a[0] === '*' ? "left to you (\"Let Claude decide\")" : text || (files.length ? '' : 'not answered, so yours to decide')
    console.log(`   ${q.title}\n     -> ${[state, ...files.map(f => `${f.for ? `${label(f.for)}: ` : ''}${join(inboxDir(dir), 'taken', b.id, f.file)}  (${f.name})`)].filter(Boolean).join('\n     -> ')}`)
  }
  console.log(`   action: ${c.action} (${ACTIONS.intake})`)
}

function pendingAssignment(dir, c) {
  if (c.action !== 'pick' || !c.assignment || c.done || c.withdrawn) return ''
  const [slug, id] = c.route.split('/')
  if (readMeta(dir, slug)?.picked !== id) return ''
  return assignmentNeeded(dir, slug, id)
}

function actionText(dir, c) {
  const suffix = standsIn(dir, c)
  if (c.failed && FAILED[c.action]) return FAILED[c.action](c, c.failed) + suffix
  if (c.action === 'pick' && c.assignment && !c.done) {
    const [slug, id] = c.route.split('/')
    if (readMeta(dir, slug)?.picked !== id) return 'the selection has changed; do not apply this earlier pick. Handle any note, then reply --done'
    return `marked in the page; ${pendingAssignment(dir, c) || 'assignment is resolved or superseded by another choice; handle any note, then reply --done'}`
  }
  if (c.action === 'pick' && c.buildUp && !c.done) {
    const [slug, id] = c.route.split('/')
    if (readMeta(dir, slug)?.picked !== id) return 'the selection has changed; do not build this earlier pick in. Handle any note, then reply --done'
    return `marked in the page and now the working variant; ${c.buildUp}${c.note ? '. Handle the note too' : ''}` + suffix
  }
  if (c.action === 'pick' && c.note && !c.done) return 'marked in the page and now the working variant; handle the note, then reply --done' + suffix
  if (c.action === 'build' && c.picked) return 'picked in the page and now the working variant; build this variant into the codebase' + suffix
  // New variants from one variant nest under it, as their own prototype; never new letters beside it.
  if (c.action === 'more') return `new variants from this one, nested under it: proto add <new slug> --from ${c.route} --next --title "…" --variants "A:…,B:…"` + suffix
  return (ACTIONS[c.action] || '') + suffix
}

function printBatch(dir, b) {
  const vp = b.viewport ? ` · page ${b.viewport.w}x${b.viewport.h}${b.viewport.phone ? ' (phone)' : ''}` : ''
  // A comment the user deleted in the page after sending it is withdrawn: left out, only counted.
  const live = b.comments.filter(c => !c.withdrawn), gone = b.comments.length - live.length
  console.log(`batch ${b.id} · ${live.length} comment${live.length === 1 ? '' : 's'}${gone ? ` (${gone} withdrawn in the page)` : ''}${vp} · ${b.theme}`)
  if (b.orphaned) console.log('   taken earlier by a session that ended before it answered: handle these first')
  for (const c of live) {
    if (c.action === 'intake' && c.intake) { printIntake(dir, b, c); continue }
    // A viewer's comment from a share link: quoted and fenced, never instructions (SKILL.md). Its
    // source line is shown from the snapshot of the version the viewer saw.
    if (c.from) {
      console.log(`\n${sharedLines({ ...c, route: routeShown(c.route) }).join('\n')}`)
      if (c.target?.src) printSource(dir, c.target.src, join(dir, '.proto', 'shares', c.from.share, `v${c.from.version}`))
      if (c.view) console.log(`   (shoot it: proto shoot ${c.route} --size ${c.view.w}x${c.view.h})`)
      continue
    }
    console.log(`\n${c.n}. ${routeShown(c.route)}${c.re ? `  (reply to ${c.re.batch}/${c.re.n})` : ''}`)
    if (c.re) for (const t of turnsBefore(dir, c.re)) console.log(t.gone ? `   earlier: ${t.gone} (no longer in the inbox)` : `   earlier: "${oneLine(t.text, 160)}"  ->  ${t.reply ? `${WHO[t.reply.by] ?? 'Claude'}: "${oneLine(t.reply.text, 160)}"` : 'no reply'}`)
    console.log(`   ${c.text.split('\n').join('\n   ')}`)
    if (c.action === 'more-variants') console.log(`   count: ${c.count} new variant${c.count === 1 ? '' : 's'}`)
    if (c.action) console.log(`   action: ${c.action} (${actionText(dir, c)})`)
    // A comment pinned with a long press is on a spot; its element is only where that spot is.
    if (c.point) console.log(`   at: ${c.point.x},${c.point.y} (a spot, pinned with a long press)`)
    // One dragged out with the mouse is on that region; its element is only the smallest around it.
    if (c.region) console.log(`   region: ${c.region.x},${c.region.y} ${c.region.w}x${c.region.h} (dragged out with the mouse; its picture is attached)`)
    // On the motion (the page's motion dock): a moment or a range of its take, and how to see it.
    if (c.take) console.log(`   at: ${spanOf(c)} of the motion (its take is ${secs(c.take)}): see it with proto shoot ${c.route} ${c.to !== undefined ? `--frames 8 --at ${c.at}-${c.to}` : `--at ${c.at}`}`)
    if (c.target) console.log(`   ${c.point || c.region ? 'in' : 'on'}: ${where(c.target)}`)
    if (c.target?.src) printSource(dir, c.target.src)
    if (c.target?.uses) printUses(dir, c.target, c.route)
    // Written in the page's device view: about that layout, which a shot at that size shows.
    if (c.view) console.log(`   view: ${c.view.size} ${c.view.w}x${c.view.h} (shoot it: proto shoot ${c.route} --size ${c.view.w}x${c.view.h})`)
    for (const [i, t] of (c.tags || []).entries()) console.log(t.commentRef
      ? `   with comment ${t.commentRef.n}: ${t.commentRef.proto}/${t.commentRef.variant} (${t.commentRef.id}) “${t.commentRef.quote}”`
      : t.variantRef
      ? `   with @${t.variantRef.label}: variant ${routeShown(`${t.variantRef.proto}/${t.variantRef.variant}`)} ·${t.variantRef.name} (${where(t)})`
      : `   with @${i + 1}: ${t.source ? `${t.source.proto}/${t.source.variant}${t.source.state ? `/${t.source.state}` : ''} · ` : ''}${where(t)}`)
    for (const img of c.images || []) console.log(`   image: ${join(inboxDir(dir), 'taken', b.id, img.file)}${img.name ? `  (${img.name})` : ''}`)
  }
  if (live.some(c => c.target && !c.action)) console.log(`\nSee one as the user saw it (their page size, the way to it opened, beside their pictures): proto shoot --pin ${b.id}/<n>`)
  console.log(`\nReply to all at once: proto reply ${b.id} 1 "…" 2 "…" … --done   (or ${b.id}/<n> "…" for one, ${b.id} "…" for the batch)\n`)
}

// proto intake set <file|->  |  proto intake [status]  |  proto intake clear
const KINDS = new Set(['one', 'many', 'text'])
function intakeShape(raw) {
  let d
  try { d = JSON.parse(raw) } catch (e) { die(`the questions are not JSON: ${e.message}`) }
  if (!d || typeof d !== 'object' || Array.isArray(d)) die('the questions file is one JSON object: { ask, title?, questions: [...] }')
  if (!Array.isArray(d.questions) || !d.questions.length) die('questions is a list of at least one question')
  if (d.questions.length > 12) die('ask at most 12 questions: the ones whose answers would change what you build')
  const seen = new Set()
  const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : ''
  const questions = d.questions.map((q, i) => {
    const at = `question ${i + 1}`
    const id = str(q.id, 40)
    if (!/^[a-z][\w-]*$/.test(id)) die(`${at}: id is a short lowercase word (job, feel, who)`)
    if (seen.has(id)) die(`${at}: id "${id}" is used twice`)
    seen.add(id)
    if (!str(q.title, 160)) die(`${at} (${id}): title is the question, in the user's words`)
    if (!KINDS.has(q.kind)) die(`${at} (${id}): kind is one (pick one), many (pick several) or text (free text)`)
    const out = { id, title: str(q.title, 160), why: str(q.why, 240), kind: q.kind }
    if (q.kind === 'text') return { ...out, placeholder: str(q.placeholder, 160) }
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8) die(`${at} (${id}): options is 2 to 8 choices`)
    const oseen = new Set()
    out.options = q.options.map((o, j) => {
      const oid = str(o?.id, 40), label = str(o?.label, 80)
      if (!/^[a-z][\w-]*$/.test(oid) || !label) die(`${at} (${id}) option ${j + 1}: needs an id (short lowercase word) and a label`)
      if (oseen.has(oid)) die(`${at} (${id}): option id "${oid}" is used twice`)
      oseen.add(oid)
      const demo = o.demo && typeof o.demo === 'object' ? o.demo : null
      if (demo && !(typeof demo.html === 'string' || typeof demo.image === 'string')) die(`${at} (${id}) option "${oid}": demo is { html } (inline styles or SVG, drawn 160 by 120) or { image } (a path under src/assets/)`)
      if (demo?.image && !/^src\/assets\/[\w./-]+\.(png|jpe?g|webp|svg|gif)$/i.test(demo.image)) die(`${at} (${id}) option "${oid}": demo.image is a file under src/assets/`)
      return { id: oid, label, ...(str(o.sub, 120) ? { sub: str(o.sub, 120) } : {}), ...(demo ? { demo: demo.html ? { html: String(demo.html).slice(0, 8000) } : { image: demo.image } } : {}), ...(o.files === false ? { files: false } : {}) }
    })
    if (q.files) out.files = true
    return out
  })
  return { ask: str(d.ask, 500), title: str(d.title, 120), questions }
}
function intake() {
  const dir = sessionDir()
  need(dir)
  const file = join(dir, '.proto', 'intake', 'current.json')
  const sub = args[0] || 'status'
  if (sub === 'set') {
    const src = args[1]
    if (!src) die('proto intake set <questions.json>   (or - to read it from the standard input)')
    let raw
    try { raw = src === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(src), 'utf8') } catch (e) { die(`cannot read ${src}: ${e.message}`) }
    const shaped = intakeShape(raw)
    const cur = readJson(file, null)
    if (cur?.status === 'open' && !flags.replace) die('questions are already open in the page (the user has not answered yet). Wait for the answers (proto inbox --wait), or replace them with --replace.')
    const id = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}-${randomBytes(2).toString('hex')}`
    mkdirSync(dirname(file), { recursive: true })
    writeJson(file, { id, status: 'open', createdAt: new Date().toISOString(), ...shaped })
    const s = need(dir)
    console.log(`asked ${shaped.questions.length} question${shaped.questions.length === 1 ? '' : 's'} in the page: ${s.url || s.localUrl || ''}`)
    console.log('the user answers there; proto inbox --wait hears when they do. Do not build before the answers arrive.')
    return
  }
  if (sub === 'clear') { rmSync(file, { force: true }); return console.log('questions taken away') }
  if (sub !== 'status') die(`proto intake ${sub}? It is set <file>, status or clear`)
  const cur = readJson(file, null)
  if (!cur) return console.log('no questions asked in this session')
  console.log(cur.status === 'open' ? `open: ${cur.questions.length} questions waiting for the user's answers` : `answered ${cur.answeredAt} (batch ${cur.batch}): run proto inbox to read it`)
}

function printListener(dir) {
  const persistent = listenerStatus(dir)
  if (flags.json) return console.log(JSON.stringify(persistent))
  if (persistent.hostAction) console.log(`host action required: ${JSON.stringify(persistent.hostAction)}; verify ownership in references/listener.md, perform it with the host tool, then confirm with proto inbox --host-${persistent.hostAction.action === 'enable' ? 'enabled' : 'disabled'} ${persistent.id}`)
  if (persistent.lifecycle === 'opted-out') return console.log('not listening: explicit user opt-out retained; only user-authorized proto inbox --reopen --again restores it')
  if (persistent.lifecycle === 'closed') return console.log(`not listening: prototype feedback closed (${persistent.reason}); proto inbox --reopen only when explicitly resuming review`)
  if (persistent.hostAction) return console.log('not listening: waiting for host task enable confirmation')
  if (persistent.configured) return console.log(`persistent listener (${persistent.id})${persistent.error ? `; retrying: ${persistent.error}` : '; listening'}`)
  const waiter = readJson(waiterFile(dir), null)
  if (waiter && alive(waiter.pid)) return console.log(`listening (pid ${waiter.pid}); keep its host background wakeup active`)
  console.log('not listening: page comments cannot wake this conversation yet')
  console.log('T3 Code (Codex or Claude): reuse list_scheduled_tasks or create schedule_task with schedule: {type: "webhook"}, bindToCurrentThread: true; register its private config with proto inbox --listen <config.json>. Read references/listener.md in the skill directory and connect before ending the turn.')
  if (detectedAgent() === 'codex') console.log('Codex: a running exec_command session does not by itself wake an idle conversation. Use the host webhook or an explicitly supported background completion wakeup.')
  console.log('Only if this host offers no wakeup mechanism, read proto inbox on active turns and tell the user automatic replies are unavailable.')
}

// A taken batch's comments from share links are `working` on the host: their viewers see "In
// progress". Only the status goes; Claude's reply never leaves this Mac.
const sharedTaken = (dir, batches) => reportShared(dir, batches.flatMap(b => b.comments.filter(c => c.from && !c.withdrawn && !c.done)), 'working')

async function inbox() {
  const dir = sessionDir()
  const s = need(dir)
  const operations = ['status', 'reconcile', 'listen', 'wait', 'unlisten', 'close', 'finish', 'reopen', 'host-enabled', 'host-disabled'].filter(k => flags[k] !== undefined)
  if (operations.length > 1) die(`${operations.map(k => `--${k}`).join(', ')} cannot be combined; choose one inbox listener operation at a time`)
  if (flags.json && !flags.status && !flags.reconcile) die('--json requires --status or --reconcile')
  try {
    locked(dir, () => reconcileListener(dir, {
      close: flags.close, finish: flags.finish, reopen: !!flags.reopen, optIn: !!flags.again, optOut: !!flags.unlisten,
      hostEnabled: flags['host-enabled'] ? true : flags['host-disabled'] ? false : undefined,
      taskId: flags['host-enabled'] || flags['host-disabled'],
      touch: !flags.status && !flags.reconcile,
    }))
  } catch (e) { die(e.message) }
  if (operations.some(k => !['listen', 'wait'].includes(k))) return printListener(dir)
  if (flags.listen) {
    const config = readJson(resolve(String(flags.listen)), null)
    let url
    try { url = new URL(config?.url) } catch { die('--listen needs a JSON file with { url, id, threadId }') }
    if (!(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) || url.username || url.password) die('listener URL must use HTTPS (HTTP is allowed only on loopback)')
    if (typeof config.id !== 'string' || !config.id.trim() || typeof config.threadId !== 'string' || !config.threadId.trim()) die('listener config needs its host task id and owning threadId')
    const refusal = locked(dir, () => {
      const was = readJson(listenerFile(dir), null), waiter = readJson(waiterFile(dir), null)
      if (was?.lifecycle && was.lifecycle !== 'active') return 'listener closed or explicitly opted out; explicitly reopen it before registering'
      if (was?.id && (was.id !== config.id || was.url !== config.url || was.threadId !== config.threadId)) return 'one persistent listener is already registered; reuse its exact task and owning thread'
      if (waiter && alive(waiter.pid)) return 'a background waiter is already listening; cancel that harness job before switching to a persistent listener'
      saveListener(dir, { ...was, url: config.url, id: config.id, threadId: config.threadId, session: sessionId(), lifecycle: 'active', hostEnabled: was?.hostEnabled ?? true, lastActivityAt: new Date().toISOString() })
    })
    if (refusal) die(refusal)
    return console.log(`persistent listener registered (${config.id}); reused across comments and server restarts`)
  }
  const persistent = listenerStatus(dir)
  if (flags.wait && persistent.lifecycle !== 'missing') return printListener(dir)
  if (!flags.wait) {
    const lost = orphans(dir)
    const got = [...lost, ...take(dir)]
    await sharedTaken(dir, got)
    got.forEach(b => printBatch(dir, b))
    if (!got.length) console.log('no new comments')
    stillOpen(dir, got.map(b => b.id))
    printListener(dir)
    return
  }
  // Comments a session that ended took and never answered come first, as an arrival does.
  const lost = orphans(dir)
  if (lost.length) { await sharedTaken(dir, lost); lost.forEach(b => printBatch(dir, b)); stillOpen(dir, lost.map(b => b.id)); return }
  const minutes = Number(flags.timeout) || 115
  const existing = locked(dir, () => {
    const w = readJson(waiterFile(dir), null)
    if (readJson(listenerFile(dir), null)) return 'persistent listener already registered; no background waiter needed'
    if (w && alive(w.pid) && w.pid !== process.pid) return `already listening (pid ${w.pid}); nothing to do`
    writeJson(waiterFile(dir), { pid: process.pid, at: new Date().toISOString(), until: new Date(Date.now() + minutes * 60e3).toISOString() })
  })
  if (existing) return console.log(existing)
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
      if (got.length) await sharedTaken(dir, got)
      if (got.length) { done(); got.forEach(b => printBatch(dir, b)); stillOpen(dir, got.map(b => b.id)); return }
    }
    if (!alive(readSession(dir)?.pid)) { done(); return console.log('the server stopped, so no comments can come. `proto up`, then listen again.') }
    await arrival()
  }
  done()
  console.log(`no comments in ${minutes} min. Listen again: proto inbox --wait`)
}

async function reply() {
  const dir = sessionDir()
  need(dir)
  const [ref, ...words] = args
  // Many at once: proto reply <batch> 1 "…" 2 "…" [--done], one write and one line for a whole batch.
  const pairs = !ref?.includes('/') && words.length >= 2 && words.length % 2 === 0 && words.every((w, i) => i % 2 || /^\d+$/.test(w))
  const text = pairs ? '' : words.join(' ').trim()
  if (!ref || (!text && !flags.done && !pairs)) die('proto reply <batch>[/<n>] "…" [--done | --until <slug>]   or   proto reply <batch> 1 "…" 2 "…" … [--done | --until <slug>]')
  // --until: the comment's answer is work still building (a new prototype, new variants): it stays
  // open, with this reply, and closes itself when `proto done` ends the last of those marks.
  const until = flags.until && !flags.done ? String(flags.until).split(',').map(x => x.trim()).filter(Boolean) : null
  if (flags.until === true || until?.length === 0) die('--until takes what the comment waits on: <slug> or <slug>/<letter>, several joined by commas')
  for (const u of until || []) {
    const [slug, letter] = u.split('/')
    const meta = join(dir, 'src', 'protos', slug, 'meta.ts')
    if (!existsSync(meta)) die(`--until: no prototype "${slug}" in this session; proto add it first, then reply`)
    if (letter && !readFileSync(meta, 'utf8').includes(`"${letter}":`)) die(`--until: "${slug}" has no variant ${letter}`)
  }
  const [prefix, n] = ref.split('/')
  const ids = batchesIn(dir, 'taken').filter(id => id.startsWith(prefix))
  if (ids.length !== 1) die(ids.length ? `"${prefix}" matches ${ids.length} batches; give more of the id` : `no taken batch "${prefix}" (run proto inbox first)`)
  const file = join(inboxDir(dir), 'taken', ids[0], 'batch.json')
  const at = new Date().toISOString()
  // Whose mark the page puts beside the reply.
  const by = replyAgent()
  // Every comment named is checked before the lock is taken: dying while holding it would leave it.
  const all = readJson(file, null)?.comments || []
  for (const k of pairs ? words.filter((w, i) => i % 2 === 0) : n ? [n] : []) if (!all.some(x => x.n === Number(k))) die(`batch ${ids[0]} has no comment ${k} (1-${all.length})`)
  const targets = pairs ? all.filter(c => words.filter((w, i) => i % 2 === 0).includes(String(c.n))) : n ? all.filter(c => c.n === Number(n)) : all
  if (flags.done) for (const c of targets) {
    const pending = pendingAssignment(dir, c)
    if (pending) die(`cannot mark ${ids[0]}/${c.n} done: ${pending}`)
  }
  const comment = (b, k) => {
    const c = b.comments.find(x => x.n === Number(k))
    if (c.withdrawn) console.log(`(comment ${k} was withdrawn in the page: the user deleted it after sending)`)
    return c
  }
  // Under the lock `proto done` closes comments in: a batch is read and written whole.
  const shared = []
  locked(dir, () => {
    const b = readJson(file, null)
    const building = until ? marksOf(readSession(dir)?.building, until).length : 0
    const answered = []
    // What happens to each comment answered: done, waiting on --until (done at once when none of
    // that is building), or left open.
    const settle = c => {
      if (flags.done) c.done = true
      else if (until) { c.until = until; if (!building && !pendingAssignment(dir, c)) c.done = true }
      answered.push(c)
    }
    if (pairs) {
      for (let i = 0; i < words.length; i += 2) {
        const c = comment(b, words[i])
        c.reply = { text: words[i + 1], at, by }
        settle(c)
      }
    } else if (n) {
      const c = comment(b, n)
      if (text) c.reply = { text, at, by }
      settle(c)
    } else {
      if (text) b.reply = { text, at, by }
      b.comments.forEach(settle)
    }
    b.done = b.comments.every(c => c.done)
    writeJson(file, b)
    shared.push(...answered.filter(c => c.from && c.done))
    // One line, as `proto done`'s. A comment left open shows "Claude is on it" until something closes it, so say so.
    const what = flags.done ? 'done'
      : until ? (building ? `open until ${until.join(', ')} is built (${building} building)${answered.some(c => pendingAssignment(dir, c)) ? '; assignment pending' : ''}` : answered.some(c => !c.done) ? 'still open: assignment pending' : `done (nothing in ${until.join(', ')} is building)`)
      : answered.some(c => !c.done) ? 'still open in the page: --done closes it, or --until <slug> once that is built' : ''
    const head = pairs ? `replied to ${answered.map(c => c.n).join(', ')}` : text ? 'replied' : ''
    console.log(`${ids[0]}${n ? `/${n}` : ''}: ${[head, what].filter(Boolean).join(', ')}${b.done ? ' (batch done)' : ''}`)
  })
  // Done on the host too, for comments from links: their viewers see "Done". Only the status goes.
  await reportShared(dir, shared, 'done')
}

// Comments taken and not done, which the page still shows as "Claude is on it": printed when
// comments arrive, the moment the agent is reading about comments, so one answered with "building
// now" and never closed is not lost. The page lists the last 20 batches; so does this.
function stillOpen(dir, skip) {
  const building = readSession(dir)?.building
  const clip = (s, k) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > k ? `${t.slice(0, k - 1)}…` : t }
  const lines = []
  for (const id of batchesIn(dir, 'taken').slice(-20)) {
    if (skip.includes(id)) continue
    for (const c of readJson(join(inboxDir(dir), 'taken', id, 'batch.json'), null)?.comments || []) {
      if (c.done || c.withdrawn) continue
      const left = c.until ? marksOf(building, c.until).length : 0
      lines.push(`  ${id}/${c.n} ${c.from ? `(from a link, by @${c.from.viewer})` : `"${clip(c.text, 50)}"`}: ${c.assignment || c.buildUp ? actionText(dir, c) : c.until ? `closes itself when ${c.until.join(', ')} is built (${left} building)` : c.reply ? `replied "${clip(c.reply.text, 50)}", never closed` : 'not answered'}`)
    }
  }
  if (lines.length) console.log(`Still open from earlier (the page says "Agent is on it"); once each one's work is in: proto reply <batch>/<n> "…" --done\n${lines.join('\n')}\n`)
}

// How close one variant (or an element of it) is to a screenshot of the real thing (compare.mjs).
async function compare() {
  const dir = sessionDir()
  const s = need(dir)
  if (!await running(s)) die('the server is stopped. Run: proto up')
  if (flags.pin !== undefined) return shootPin(dir, s, resolve(flags.out || join(dir, '.proto', 'shots')))
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
  if (flags.pin !== undefined) return shootPin(dir, s, resolve(flags.out || join(dir, '.proto', 'shots')))
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
    if (k.style?.length) console.log(`  image style: ${k.style.join(', ')} (in ${tilde(join(kitDir(name), 'style'))})`)
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
    '## Image style', '',
    ...(k.style?.length ? k.style.map(f => `- \`style/${f}\``) : []),
    '- The guide and anchor every generated image follows (references/images.md), or the project images it takes its style from:', '',
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
  const style = keepStyle(dir, slug, kd, meta)
  if (style.length) k.style = [...new Set([...(was?.style || []), ...style])].sort()
  else if (was?.style) k.style = was.style
  writeJson(join(kd, 'kit.json'), k)
  const doc = join(kd, 'design-system.md'), first = !existsSync(doc)
  if (first) writeFileSync(doc, kitDoc(k, kd))
  console.log(`${was ? 'updated' : 'saved'} kit ${name}: theme.css${parts.length ? `, ${parts.join(', ')}` : ''}${Object.keys(packages).length ? `, packages ${Object.keys(packages).join(' ')}` : ''}`)
  console.log(`tracking ${plural(Object.keys(k.sources).length, 'source')}${Object.keys(k.sources).length ? `: ${Object.keys(k.sources).join(', ')}` : ' (name them with --sources, or the kit can\'t tell when it is out of date)'}`)
  console.log(`${first ? 'fill in' : 'bring up to date'}: ${tilde(doc)}`)
}

// The picked direction's asset style guide and anchor (src/assets/style/<slug>-<letter>.md and
// <slug>-<letter>-anchor.png, references/images.md) go into the kit's style/, which a save never
// clears. Before a pick there is no one style to keep, so it says so instead.
function keepStyle(dir, slug, kd, meta) {
  const from = join(dir, 'src', 'assets', 'style')
  const mine = existsSync(from) ? readdirSync(from).filter(f => f.startsWith(`${slug}-`)) : []
  if (!mine.length) return []
  if (!meta.picked) {
    console.log(`style guides for ${slug} not kept: nothing is picked yet. proto pick ${slug} <letter>, then save again`)
    return []
  }
  const files = mine.filter(f => f.startsWith(`${slug}-${meta.picked}.`) || f.startsWith(`${slug}-${meta.picked}-`))
  if (!files.length) return []
  mkdirSync(join(kd, 'style'), { recursive: true })
  for (const f of files) cpSync(join(from, f), join(kd, 'style', f))
  console.log(`kept ${slug}/${meta.picked}'s image style: ${files.join(', ')} (in ${tilde(join(kd, 'style'))}; name them in design-system.md)`)
  return files
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
  const style = (k.style || []).filter(f => existsSync(join(kd, 'style', f)))
  if (style.length) {
    const to = join(dir, 'src', 'assets', 'style')
    mkdirSync(to, { recursive: true })
    for (const f of style) if (!existsSync(join(to, f))) cpSync(join(kd, 'style', f), join(to, f))
    console.log(`image style: src/assets/style/${style.join(', src/assets/style/')}. Every generated image starts from this guide, with its anchor as the first reference (references/images.md)`)
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
  for (const p of cat.pairings.filter(p => p.script === (flags.hebrew ? 'hebrew' : 'latin'))) {
    const roles = ['display', 'body', 'utility'].filter(r => p[r])
    console.log(`${p.mood} (${p.script}): ${roles.map(r => p[r].family).join(' / ')}`)
    console.log(`  font(${[...new Set(roles.map(r => p[r].spec))].map(s => `'${s}'`).join(', ')})`)
  }
  if (flags.hebrew) console.log(`\nEvery Google family with Hebrew: ${cat.hebrew.join(', ')}`)
  console.log(`\nNever for a title: ${(cat.neverTitle || []).map(n => n.family).join(', ')}`)
}

const commands = {
  up, add, plan, done, pick, fav, work, ask, history, brief: briefCmd, archive, shoot, compare, perf, handoff, snap, intake, inbox, reply, gc: () => gc(false), ls,
  stop: async () => { await stop(); console.log('stopped (files kept; proto up restarts it on the same link)') },
  rm: () => rm(),
  keep: () => { const dir = sessionDir(); need(dir); patchSession(dir, { keep: !flags.off }); console.log(flags.off ? 'no longer kept' : 'kept until deleted by hand') },
  url: () => { const s = need(sessionDir()); console.log(s.url || s.localUrl || 'not started') },
  stack: () => { const d = detectStack(projectRoot()); console.log(`${d.stack} (${d.why})`) },
  fonts,
  kit: () => !args[0] ? kitStatus() : args[0] === 'save' ? kitSave() : args[0] === 'screen' ? kitScreen() : die(`proto kit ${args[0]}? It is proto kit, proto kit save or proto kit screen`),
  // setup, stop, signin, signout and admin are about the host and this Mac, not a session: they run
  // from any folder.
  share: () => import('./share.mjs').then(m => {
    const free = ['setup', 'stop', 'signin', 'signout', 'admin'].includes(args[0])
    return m.main(args, flags, { sessionDir: free ? null : sessionDir(), session: free ? null : need(sessionDir()), die })
  }),
}
// The page shows variants by number (app/numbers.mjs), so the user names them that way: a route
// given with a number (hero/29, hero/29/open) means that letter (hero/AC). Only where the slug is a
// prototype of this session, so a batch's comment (<batch>/2) or a file path is left as it is.
function numbersToLetters() {
  const id = flags.session || process.env.PROTO_SESSION_ID || process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID
  const shaped = a => typeof a === 'string' && /^[a-z0-9][a-z0-9-]*\/\d/.test(a)
  if (!id || id === true || !args.concat(['from', 'to', 'until'].map(k => flags[k])).some(a => shaped(a) || (typeof a === 'string' && a.split(',').some(shaped)))) return
  const isProto = slug => existsSync(join(projectApp(projectRoot()), 'src', 'protos', slug, 'meta.ts'))
  const byNumber = r => r.replace(/^([a-z0-9][a-z0-9-]*)\/(\d{1,3})(?=\/|$)/, (all, slug, n) => letterOf(n) && isProto(slug) ? `${slug}/${letterOf(n)}` : all)
  for (const [i, a] of args.entries()) args[i] = byNumber(a)
  for (const k of ['from', 'to', 'until']) if (typeof flags[k] === 'string') flags[k] = flags[k].split(',').map(r => byNumber(r.trim())).join(',')
}
if (commands[cmd]) numbersToLetters()
// The help is this file's opening comment, however many lines it grows to.
if (!commands[cmd]) {
  const head = readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).slice(1)
  console.log(head.slice(0, head.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(cmd ? 1 : 0)
}
await commands[cmd]()
