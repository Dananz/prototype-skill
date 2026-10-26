// The share host as `proto share` sees it: the pinned tools it runs on, the hosts it knows
// (~/.config/prototype/hosts.json, no secrets), the owner token (the macOS Keychain, else a file
// only this user can read), the local host under `wrangler dev`, and the owner API.
//
// Phase 0 is local only: the only wrangler commands here are `wrangler dev` and `wrangler d1
// execute --local`, so nothing logs in to or calls a Cloudflare account.
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ShareError } from '../app/share/scope.mjs'

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)))
const PINS = { wrangler: '4.149.0', sharp: '0.35.5' }
const PORTS = [8787, 8799]
const LOCAL = 'local'

// Read at each call, not at import: HOME is what the tests move.
const toolsDir = () => process.env.PROTO_SHARE_TOOLS || join(homedir(), '.prototypes', 'share-tools')
const hostDir = () => join(homedir(), '.prototypes', 'host')
const configDir = () => join(homedir(), '.config', 'prototype')
const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const has = bin => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0
const versionOf = name => readJson(join(toolsDir(), 'node_modules', name, 'package.json'), {}).version

/**
 * wrangler and sharp at their pinned versions in ~/.prototypes/share-tools, installed the first
 * time (pnpm when it is there, else npm), never into a session's package.json. sharp is null if it
 * would not install: images then stay as they are.
 */
export async function ensureTools() {
  const dir = toolsDir()
  const wrangler = join(dir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  const sharpDir = join(dir, 'node_modules', 'sharp')
  if (versionOf('wrangler') !== PINS.wrangler || versionOf('sharp') !== PINS.sharp) {
    console.log('Installing the share tools (once)…')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'prototype-share-tools', private: true, dependencies: PINS }, null, 2) + '\n')
    // confirmModulesPurge: a folder npm filled first is replaced without a question no one can answer.
    const r = has('pnpm')
      ? spawnSync('pnpm', ['install', '--ignore-workspace', '--config.confirmModulesPurge=false', '--reporter=silent'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' })
      : spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' })
    if (r.status !== 0 || versionOf('wrangler') !== PINS.wrangler) throw new ShareError(`Installing the share tools into ${dir} failed (see above). Check the network and run the command again.`)
  }
  return { wrangler, sharp: existsSync(sharpDir) ? sharpDir : null }
}

// ---------- hosts ----------

/** Host = { name, url, stage: 'local', base, pathMode, default, owner } */
export const readHosts = () => readJson(join(configDir(), 'hosts.json'), []).filter(h => h && typeof h.name === 'string')

/** Adds or replaces the host by name. One host is the default: this one when it says so, or when it is alone. */
export function saveHost(host) {
  let hosts = readHosts().filter(h => h.name !== host.name)
  if (host.default) hosts = hosts.map(h => ({ ...h, default: false }))
  hosts.push({ ...host, default: host.default || !hosts.some(h => h.default) })
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(join(configDir(), 'hosts.json'), JSON.stringify(hosts, null, 2) + '\n')
}

export const defaultHost = () => { const hosts = readHosts(); return hosts.find(h => h.default) || hosts[0] || null }

// ---------- the owner token ----------

// The Keychain on macOS. PROTO_SHARE_TOKEN_STORE=file sends tokens to the file store instead: the
// tests set it, since `security` writes to the login keychain whatever HOME says.
const inKeychain = () => process.platform === 'darwin' && process.env.PROTO_SHARE_TOKEN_STORE !== 'file'
const service = name => `prototype-share-${name}`
const tokenFile = name => join(configDir(), `token-${name}`)

export function getToken(name) {
  if (inKeychain()) {
    const r = spawnSync('security', ['find-generic-password', '-s', service(name), '-w'], { encoding: 'utf8' })
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null
  }
  try { return readFileSync(tokenFile(name), 'utf8').trim() || null } catch { return null }
}

/**
 * The `security` call that stores a token: the command goes in on stdin (`security -i`), so the
 * token never shows in `ps` the way an argument would. Tokens are base64url, so nothing needs quoting.
 */
export function keychainAdd(name, token) {
  if (!/^[A-Za-z0-9_-]+$/.test(token) || !/^[A-Za-z0-9_-]+$/.test(name)) throw new ShareError('The owner token or host name has characters the Keychain command cannot take')
  return { args: ['-i'], input: `add-generic-password -U -a prototype -s ${service(name)} -w ${token}\n` }
}

export function setToken(name, token) {
  if (inKeychain()) {
    const { args, input } = keychainAdd(name, token)
    const r = spawnSync('security', args, { input, encoding: 'utf8' })
    if (r.status !== 0) throw new ShareError(`Could not save the owner token in the Keychain: ${r.stderr.trim()}`)
    return
  }
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(tokenFile(name), token + '\n', { mode: 0o600 })
  chmodSync(tokenFile(name), 0o600)
}

// ---------- the local host ----------

const portOf = host => Number(new URL(host.url).port || 80)
const pidFile = () => join(hostDir(), 'host.pid')
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const configFile = () => join(hostDir(), 'wrangler.jsonc')
/** Whether a command line is this host's wrangler: started with `-c` and this host's own config. */
export const runsConfig = (command, config) => ` ${command.trim()} `.includes(` -c ${config} `)
// A pid from the file is ours only while it is still the wrangler running this host's config: pids
// are reused, and the user may run a wrangler dev of their own (-ww: the whole line, untruncated).
const ours = pid => !!pid && alive(pid) && runsConfig(spawnSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '', configFile())
const healthy = async port => { try { return (await fetch(`http://127.0.0.1:${port}/_health`, { signal: AbortSignal.timeout(2000) })).ok } catch { return false } }
// Nothing answers at host:port. Refused, or an address this machine doesn't have (no IPv6), is free.
const unanswered = (host, port) => new Promise(ok => {
  const s = connect({ host, port })
  s.setTimeout(1000, () => { s.destroy(); ok(false) })
  s.once('connect', () => { s.destroy(); ok(false) })
  s.once('error', e => ok(e.code !== 'ETIMEDOUT'))
})
const binds = port => new Promise(ok => { const s = createServer().once('error', () => ok(false)).listen(port, '127.0.0.1', () => s.close(() => ok(true))) })
/**
 * A port is free only when nothing listens on it by either loopback name. A bind on 127.0.0.1
 * alone succeeds beside a server on ::, ::1 or 0.0.0.0, and browsers try ::1 first for localhost,
 * so a link would reach that other server.
 */
export async function portFree(port) {
  return await unanswered('127.0.0.1', port) && await unanswered('::1', port) && await binds(port)
}

/** Whether the local host this Mac knows is up and answering. */
export async function localRunning(host = readHosts().find(h => h.name === LOCAL)) {
  return !!host && ours(Number(readJson(pidFile(), 0))) && healthy(portOf(host))
}

// Whether *.localhost reaches this Mac from here: a throwaway server on the port, asked for
// /_health under a random subdomain. Safari is checked by hand (references/share.md).
async function subdomainsResolve(port) {
  const { createServer: http } = await import('node:http')
  const server = http((req, res) => res.end('ok'))
  await new Promise((ok, no) => server.once('error', no).listen(port, '127.0.0.1', ok))
  try {
    const res = await fetch(`http://${randomBytes(5).toString('hex')}.localhost:${port}/_health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch { return false } finally { server.close() }
}

function wrangler(tools, args, opts = {}) {
  return spawnSync(process.execPath, [tools.wrangler, ...args], { cwd: hostDir(), encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, ...opts })
}

// SQL literals for the few rows setup writes itself; the values are ids, hashes and a name.
const lit = v => typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`

function d1(tools, config, state, sql) {
  const r = wrangler(tools, ['d1', 'execute', 'DB', '--local', '--persist-to', state, '-c', config, '--json', '--command', sql])
  if (r.status !== 0) throw new ShareError(`The local host's database refused a command:\n${(r.stderr || r.stdout).trim().slice(-2000)}`)
  try { return JSON.parse(r.stdout).flatMap(x => x.results || []) } catch { return [] }
}

function ownerName(given) {
  if (typeof given === 'string' && given.trim()) return given.trim()
  const r = has('gh') ? spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8', timeout: 15_000 }) : { status: 1 }
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
  throw new ShareError('Pass --name: gh is not logged in')
}

/**
 * Starts the host on this Mac, or returns it when it already runs. The first time it also makes
 * the owner and this machine's token. name: the owner's name when none exists yet (else gh's login).
 */
export async function startLocal({ name } = {}) {
  const known = readHosts().find(h => h.name === LOCAL)
  if (await localRunning(known)) return known
  await stopLocal()
  const tools = await ensureTools()
  let port = 0
  for (let p = PORTS[0]; p <= PORTS[1] && !port; p++) if (await portFree(p)) port = p
  if (!port) throw new ShareError(`Ports ${PORTS[0]} to ${PORTS[1]} are all taken on this Mac. Free one and run the command again.`)
  const pathMode = known?.pathMode ?? !await subdomainsResolve(port)
  const base = `localhost:${port}`
  const dir = hostDir(), state = join(dir, 'state'), config = configFile()
  mkdirSync(state, { recursive: true })
  // Locally `--persist-to` makes the KV namespace and the database itself, so their ids are any string.
  const template = readFileSync(join(SKILL, 'host', 'wrangler.template.jsonc'), 'utf8')
  writeFileSync(config, template
    .replace('"main": "worker.mjs"', `"main": ${JSON.stringify(join(SKILL, 'host', 'worker.mjs'))}`)
    .replace('{{KV_ID}}', 'local-kv').replace('{{DB_ID}}', 'local-db').replace('{{BASE}}', base).replace('{{PATH_MODE}}', pathMode ? '1' : '0'))
  const schema = wrangler(tools, ['d1', 'execute', 'DB', '--local', '--persist-to', state, '-c', config, '--file', join(SKILL, 'host', 'schema.sql')])
  if (schema.status !== 0) throw new ShareError(`Could not set up the local host's database:\n${(schema.stderr || schema.stdout).trim().slice(-2000)}`)

  // The owner and this machine's token: made once, and again only if one of them was lost (a
  // deleted state folder, or a token store that lost the item).
  let owner = d1(tools, config, state, 'SELECT id, name FROM owners ORDER BY created_at LIMIT 1')[0]
  const token = getToken(LOCAL)
  const tokenKnown = token && d1(tools, config, state, `SELECT 1 AS ok FROM owner_tokens WHERE revoked_at IS NULL AND sha256 = ${lit(createHash('sha256').update(token).digest('hex'))}`).length
  if (!owner || !tokenKnown) {
    const now = Date.now()
    if (!owner) {
      owner = { id: `o_${randomBytes(8).toString('hex')}`, name: ownerName(name) }
      d1(tools, config, state, `INSERT INTO owners (id, name, created_at) VALUES (${lit(owner.id)}, ${lit(owner.name)}, ${now})`)
    }
    const fresh = randomBytes(32).toString('base64url')
    d1(tools, config, state, `INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (${lit(createHash('sha256').update(fresh).digest('hex'))}, ${lit(owner.id)}, ${lit(hostname())}, ${now})`)
    setToken(LOCAL, fresh)
  }

  const logFile = join(dir, 'host.log')
  const log = openSync(logFile, 'w')
  // Its own process group, so stopping it also stops the workerd it runs.
  const child = spawn(process.execPath, [tools.wrangler, 'dev', '-c', config, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0', '--persist-to', state, '--show-interactive-dev-session=false'], {
    cwd: dir, detached: true, stdio: ['ignore', log, log], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  closeSync(log)
  child.unref()
  writeFileSync(pidFile(), String(child.pid))
  for (const end = Date.now() + 30_000; Date.now() < end; await sleep(250)) {
    if (await healthy(port)) {
      const host = { name: LOCAL, url: `http://${base}`, stage: 'local', base, pathMode, default: known ? !!known.default : true, owner: owner.name }
      saveHost(host)
      return host
    }
    if (!alive(child.pid)) break
  }
  await stopLocal()
  const tail = (() => { try { return readFileSync(logFile, 'utf8').trim().split('\n').slice(-15).join('\n') } catch { return '' } })()
  throw new ShareError(`The local share host did not start within 30 s (log: ${logFile}):\n${tail}`)
}

/** Stops the local host if it runs; says whether it did. */
export async function stopLocal() {
  const pid = Number(readJson(pidFile(), 0))
  rmSync(pidFile(), { force: true })
  if (!ours(pid)) return false
  const signal = sig => { try { process.kill(-pid, sig) } catch { try { process.kill(pid, sig) } catch { /* gone */ } } }
  signal('SIGTERM')
  for (let i = 0; i < 50 && alive(pid); i++) await sleep(100)
  if (alive(pid)) signal('SIGKILL')
  return true
}

// ---------- the owner API ----------

/** Where the owner API is reached: on this Mac by 127.0.0.1, which the host answers on as well as localhost. */
const apiOrigin = host => host.stage === 'local' ? `http://127.0.0.1:${portOf(host)}` : host.url.replace(/\/$/, '')

export function client(host, token) {
  const origin = apiOrigin(host)
  const call = async (method, path, { body, headers = {} } = {}) => {
    let res
    try {
      res = await fetch(origin + path, { method, body, headers: { authorization: `Bearer ${token}`, ...headers }, signal: AbortSignal.timeout(60_000) })
    } catch (e) {
      throw new ShareError(`Could not reach the share host "${host.name}" at ${origin}: ${e?.cause?.code || e?.message || e}`)
    }
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch { /* an HTML error page */ }
    if (!res.ok) throw new ShareError(`The share host "${host.name}" answered ${res.status}${data?.error ? `: ${data.error}` : ''}`)
    return data
  }
  return {
    create: async () => (await call('POST', '/api/shares')).id,
    put: async (id, gz, meta) => {
      const header = Buffer.from(JSON.stringify(meta)).toString('base64url')
      const { version } = await call('PUT', `/api/shares/${id}`, { body: gz, headers: { 'content-type': 'application/gzip', 'x-share-meta': header } })
      return { version }
    },
    list: () => call('GET', '/api/shares'),
    remove: async id => { await call('DELETE', `/api/shares/${id}`) },
  }
}

/** The link people open: one origin per share where *.localhost resolves, else the path form on 127.0.0.1. */
export function linkOf(host, id) {
  const port = portOf(host)
  return host.pathMode ? `http://127.0.0.1:${port}/s/${id}/` : `http://${id}.localhost:${port}/`
}
