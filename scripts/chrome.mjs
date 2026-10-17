// Finds a Chromium browser for the headless screenshots: Chrome first, then Chromium, then
// Edge (on every Windows machine). Set CHROME to a browser's executable to choose one.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join, relative, resolve, isAbsolute } from 'node:path'

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  const env = process.env
  const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
  const paths = {
    darwin: ['Google Chrome', 'Chromium', 'Microsoft Edge'].map(app => `/Applications/${app}.app/Contents/MacOS/${app}`),
    win32: ['Google/Chrome/Application/chrome.exe', 'Chromium/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].flatMap(p => roots.map(r => join(r, p))),
  }[process.platform] ?? []
  const found = paths.find(p => existsSync(p))
  if (found) return found
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' })
    if (r.status === 0) return r.stdout.split(/\r?\n/)[0].trim()
  }
  console.error('No Chrome, Chromium or Edge found. Install Chrome, or set CHROME to a Chromium browser\'s executable.')
  process.exit(1)
}

// Headless, in a process group of its own, so stopping it stops its helpers too (renderers, the
// crash handler). A helper left running keeps the script's pipe open, so the script never
// exits, and keeps its memory.
// The --user-data-dir profile in args belongs to this Chrome: stopChrome deletes it, and so does the
// script's exit (process.exit, an error, Ctrl+C) when the script never stopped Chrome itself.
// On Windows Chrome's own temp files (a 160 KB GUID.tmp or two per run) go in the profile too, so they
// leave with it.
export function startChrome(args) {
  sweepProfiles()
  const profile = args.find(a => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)
  const env = profile && process.platform === 'win32' ? { ...process.env, TEMP: profile, TMP: profile } : process.env
  const chrome = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=0', ...args, 'about:blank'], { env, stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
  chrome.profile = profile
  track(chrome)
  return chrome
}
// Also stops a Chrome this file did not start (a script's own copy of the launch code), and deletes the
// --user-data-dir it was spawned with, as long as that profile is in the temp folder.
export function stopChrome(chrome) {
  if (chrome.stopped) return
  chrome.stopped = true
  live.delete(chrome)
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'])
  else try { process.kill(-chrome.pid, 'SIGKILL') } catch { /* already gone */ }
  chrome.kill('SIGKILL')
  chrome.stderr?.destroy()
  // Windows keeps the profile's files locked until Chrome has really exited, a moment after taskkill
  // returns. (Elsewhere open files delete fine, and the killed child stays a zombie until the event loop
  // reaps it, so waiting would only stall.)
  if (process.platform === 'win32') for (const t0 = Date.now(); alive(chrome.pid) && Date.now() - t0 < 3000;) sleep(25)
  const profile = chrome.profile ?? chrome.spawnargs?.find(a => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)
  if (profile && inTemp(profile)) removeProfile(profile)
}
// Only a folder inside the temp folder is a throwaway profile; a real one elsewhere is never deleted.
// Both sides are resolved, so a short (8.3) and a long spelling of the same folder agree.
const inTemp = dir => {
  try { const r = relative(realpathSync.native(tmpdir()), realpathSync.native(resolve(dir))); return !!r && !r.startsWith('..') && !isAbsolute(r) } catch { return false }
}

// Deletes a profile, retrying while Chrome's helpers still hold files. rmSync's own maxRetries is no help
// here: on Node 24 it gave up on Windows' EPERM at once, which leaked every profile (2,600 folders, 93 GB
// in a week). Says so on stderr when the profile stays.
export function removeProfile(dir, { budget = 5000 } = {}) {
  const t0 = Date.now()
  for (let wait = 25; ; wait = Math.min(wait * 2, 800)) {
    try { rmSync(dir, { recursive: true, force: true }); return true } catch (e) {
      if (Date.now() - t0 + wait > budget) { console.error(`chrome: could not delete the profile ${dir}: ${e.code || e.message}`); return false }
    }
    sleep(wait)
  }
}

// A script killed outright (a tool's timeout, Task Manager) runs no handler and leaves its profile, so
// each start deletes the profiles older than a day. It spends about 2 s at most, so a backlog goes over
// several starts, and skips a profile it can't delete yet.
const STALE = /^(proto-(shoot|compare|perf|snap|smoke)|panel-verify)-/
// Whether a browser has this profile open, by the mark Chrome itself checks before it shares a profile. On
// Windows a running Chrome holds <profile>/lockfile open, so deleting it fails (a free one goes now, as its
// folder is about to). Elsewhere SingletonLock is a link to "<host>-<pid>": in use while that process runs,
// and taken as in use when it names another machine or can't be read.
export function inUse(dir, platform = process.platform) {
  if (platform === 'win32') {
    try { unlinkSync(join(dir, 'lockfile')); return false } catch (e) { return e.code !== 'ENOENT' }
  }
  let target
  try { target = readlinkSync(join(dir, 'SingletonLock')) } catch (e) { return e.code !== 'ENOENT' }
  const at = target.lastIndexOf('-'), pid = Number(target.slice(at + 1))
  return at < 1 || target.slice(0, at) !== hostname() || !Number.isInteger(pid) || alive(pid)
}
export function sweepProfiles({ budget = 2000, age = 86_400_000, root = tmpdir(), platform = process.platform } = {}) {
  const t0 = Date.now()
  let names
  try { names = readdirSync(root) } catch { return }
  for (const name of names) {
    if (Date.now() - t0 > budget) return
    if (!STALE.test(name)) continue
    const dir = join(root, name)
    try {
      const s = lstatSync(dir)
      if (s.isDirectory() && !s.isSymbolicLink() && Date.now() - s.mtimeMs > age && !inUse(dir, platform)) rmSync(dir, { recursive: true, force: true })
    } catch { /* in use, or gone */ }
  }
}

// Chromes not stopped yet. The script's exit stops them; Ctrl+C, a closed console and SIGTERM exit the
// script (with 1, as the scripts' own handlers do) so that runs too. A kill that ends the script outright
// runs nothing, which the sweep covers.
const live = new Set()
let hooked = false
function track(chrome) {
  if (!hooked) {
    hooked = true
    process.on('exit', () => { for (const c of [...live]) stopChrome(c) })
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])]) process.on(sig, () => process.exit(1))
  }
  live.add(chrome)
}
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
// Signal 0 only asks whether the process still runs; on Windows libuv checks its exit code.
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

// The page marks <html data-ready="1"> once the shell has drawn. Mid-navigation documentElement can be
// null and a page error is only "not yet", so the check never throws. `evaluate` runs an expression in
// the page and resolves to its value. False if the page wasn't ready within tries × every ms.
export async function waitReady(evaluate, { tries = 100, every = 100 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await Promise.resolve().then(() => evaluate('document.documentElement?.dataset.ready === "1"')).catch(() => false)) return true
    await new Promise(r => setTimeout(r, every))
  }
  return false
}
