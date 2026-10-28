// proto share setup: the share host online, on the free Cloudflare account made for prtype.dev
// (decision 5), and `proto share setup --github` for the host on this Mac.
//
// The online setup runs from any folder and is safe to run again: it looks everything up before it
// makes it, so a re-run updates the code, applies new migrations, repairs a lost token, and on
// another Mac adds that Mac's token. Without --domain the host answers on its workers.dev name;
// with --domain prtype.dev it is reached through the site Worker that owns prtype.dev (site/), which
// hands the share paths to it over a service binding (HOST). Each step prints one line.
//
// Every account call goes through the pinned wrangler on its own login (wranglerEnv()); the few
// REST calls wrangler has no command for use its OAuth token, held in memory only. Secrets go to
// wrangler on stdin, never in argv, a log or a file this writes, and never to the terminal.
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { hostname as machine, tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShareError } from '../app/share/scope.mjs'
import { CRON } from '../host/lib/cron.mjs'
import { SKILL, ensureTools, getToken, hostDir, hostHash, readHosts, saveHost, setToken, startLocal, stopLocal, wranglerEnv } from './share-host.mjs'

const WORKER = 'proto-share'
const API = 'https://api.cloudflare.com/client/v4'
const ID = 'k3x9p2m4q7' // an id-shaped share that doesn't exist, for checks that must not start anything
const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA'
const lit = v => typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
const sha = s => createHash('sha256').update(s).digest('hex')
export const onlineDir = () => join(hostDir(), 'online')
// Outside every folder that holds a wrangler config: see step 5.
const accountDir = () => { const d = join(tmpdir(), 'proto-share-account'); mkdirSync(d, { recursive: true }); return d }
export const prodVarsFile = () => join(hostDir(), 'prod.vars')
export const devVarsFile = () => join(hostDir(), '.dev.vars')

// ---------- secrets files ----------

/**
 * A dotenv file of exactly the given keys: KEY=value lines, `#` comments and blank lines, values
 * optionally quoted. Refuses an unknown key or a missing one; an error names the key, never a value.
 */
export function parseVars(text, keys, what = 'the file') {
  const out = {}
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) throw new ShareError(`Line ${i + 1} of ${what} is not KEY=value`)
    if (!keys.includes(m[1])) throw new ShareError(`${what} has a key setup doesn't know: ${m[1]} (it takes ${keys.join(' and ')} only)`)
    let v = m[2].trim()
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1)
    out[m[1]] = v
  }
  for (const k of keys) if (!out[k]) throw new ShareError(`${what} has no ${k}`)
  return out
}

/** ~/.prototypes/host/prod.vars, the production OAuth App's id and secret; only at mode 600. */
export function readProdVars(file = prodVarsFile()) {
  if (!existsSync(file)) throw new ShareError(`No ${file}: it holds the prtype.dev OAuth App's GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (mode 600)`)
  // Only this user may read it: 600 or 400.
  const mode = statSync(file).mode & 0o777
  if (mode & 0o077) throw new ShareError(`${file} can be read by others (mode ${mode.toString(8)}): chmod 600 it, then run setup again`)
  return parseVars(readFileSync(file, 'utf8'), ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'], file)
}

/** Text with each secret replaced, for an error that quotes wrangler's output. */
export const redact = (text, secrets) => secrets.filter(Boolean).reduce((t, s) => t.split(s).join('[redacted]'), String(text || ''))

// ---------- the generated config ----------

/**
 * The online host's wrangler config. Free only: KV and D1, vars, one cron, workers.dev, logs. card:
 * the site is in front of the host (the domain stage), so its preview image (site/public/og-share.jpg)
 * is there for the short links' cards. subdomains: each share on its own origin (decision 23, the
 * domain stage): path mode off and the host's one route <id>.<base>, a wildcard route on the zone
 * (Free; custom domains take no wildcard). The site Worker still reaches the host for the apex through
 * its service binding. On workers.dev there are no per-share names: path mode, no route.
 */
export function onlineConfig({ accountId, kvId, dbId, base, signin = false, legacy = '', card = false, subdomains = false, hostVersion, skill = SKILL }) {
  const routed = subdomains
  return {
    name: WORKER,
    account_id: accountId,
    main: join(skill, 'host', 'worker.mjs'),
    compatibility_date: '2026-10-01',
    workers_dev: true,
    preview_urls: false,
    kv_namespaces: [{ binding: 'KV', id: kvId }],
    d1_databases: [{ binding: 'DB', database_name: WORKER, database_id: dbId, migrations_dir: join(skill, 'host', 'migrations') }],
    vars: { BASE: base, PATH_MODE: routed ? '0' : '1', SIGNIN: signin ? '1' : '0', LEGACY: legacy, CARD: card ? '/og-share.jpg' : '', HOST_VERSION: hostVersion },
    ...(routed ? { routes: shareRoutes(base) } : {}),
    triggers: { crons: [CRON] },
    // Workers Logs carry each request's CPU time (Task 0 item 8); Free keeps 200,000 events a day.
    observability: { enabled: true },
  }
}

// The per-share origins' route: every <id>.<base> to this Worker, on the zone <base>.
const shareRoutes = base => [{ pattern: `*.${base}/*`, zone_name: base }]

const ALLOWED = new Set(['name', 'account_id', 'main', 'compatibility_date', 'workers_dev', 'preview_urls', 'kv_namespaces', 'd1_databases', 'vars', 'triggers', 'observability'])
const D1_KEYS = new Set(['binding', 'database_name', 'database_id', 'migrations_dir'])

/**
 * Throws unless the config binds only what the Free plan has (KV, D1, one cron) and nothing paid.
 * routes: exactly the per-share wildcard on BASE's zone, nothing else (no custom domain).
 */
export function assertFreeConfig(config) {
  const routeOk = config.routes === undefined || JSON.stringify(config.routes) === JSON.stringify(shareRoutes(config.vars?.BASE))
  const extra = Object.keys(config).filter(k => !ALLOWED.has(k) && !(k === 'routes' && routeOk))
  if (extra.length) throw new ShareError(`The host's config has ${extra.join(', ')}, which a free host doesn't use (only KV, D1, vars, one cron and workers.dev)`)
  for (const d of config.d1_databases || []) {
    const bad = Object.keys(d).filter(k => !D1_KEYS.has(k))
    if (bad.length) throw new ShareError(`The host's D1 binding has ${bad.join(', ')}`)
  }
  if ((config.triggers?.crons || []).length > 1) throw new ShareError('The host needs one cron trigger, not more')
  return config
}

/** Writes the config (generated, never committed) where setup and the smoke deploy it from. */
export function writeOnlineConfig(file, options) {
  const config = assertFreeConfig(onlineConfig(options))
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, '// Made by proto share setup (scripts/share-online.mjs); it is written again on each run.\n' + JSON.stringify(config, null, 2) + '\n')
  return config
}

// ---------- the owner and this Mac's token ----------

/**
 * The owner (made once), meta.owner_id (written once) and this machine's token: a token missing
 * here or unknown to the host is minted, stored, and the rows this machine had before are revoked.
 * sql(text) runs one statement on the host's database and resolves with its rows.
 */
export async function ownerAndToken({ sql, name, tokenName, device = machine(), now = Date.now(), get = getToken, set = setToken }) {
  let owner = (await sql('SELECT id, name FROM owners ORDER BY created_at LIMIT 1'))[0]
  if (!owner) {
    owner = { id: `o_${randomBytes(8).toString('hex')}`, name: name() }
    await sql(`INSERT INTO owners (id, name, created_at) VALUES (${lit(owner.id)}, ${lit(owner.name)}, ${now})`)
  }
  await sql(`INSERT INTO meta (k, v) VALUES ('owner_id', ${lit(owner.id)}) ON CONFLICT(k) DO NOTHING`)
  const token = get(tokenName)
  const known = token && (await sql(`SELECT 1 AS ok FROM owner_tokens WHERE revoked_at IS NULL AND sha256 = ${lit(sha(token))}`)).length
  let minted = false
  if (!known) {
    const fresh = randomBytes(32).toString('base64url')
    await sql(`UPDATE owner_tokens SET revoked_at = ${now} WHERE owner_id = ${lit(owner.id)} AND device = ${lit(device)} AND revoked_at IS NULL`)
    await sql(`INSERT INTO owner_tokens (sha256, owner_id, device, created_at) VALUES (${lit(sha(fresh))}, ${lit(owner.id)}, ${lit(device)}, ${now})`)
    set(tokenName, fresh)
    minted = true
  }
  return { owner, minted }
}

// ---------- the site's service binding ----------

const BOUND = new RegExp(`"services"\\s*:\\s*\\[\\s*\\{\\s*"binding"\\s*:\\s*"HOST"\\s*,\\s*"service"\\s*:\\s*"${WORKER}"`)
const PLACEHOLDER = /(\n[ \t]*"observability"\s*:\s*\{[^}]*\})\s*\n[ \t]*\/\/ Added once the share host is deployed[^\n]*\n[ \t]*\/\/ "services"[^\n]*\n/

/**
 * site/wrangler.jsonc with the HOST binding to the share host in place of its placeholder comment.
 * Says whether it changed; a config with neither the binding nor the placeholder is a hand edit.
 */
export function bindSite(file) {
  const text = readFileSync(file, 'utf8')
  if (BOUND.test(text)) return false
  if (!PLACEHOLDER.test(text)) throw new ShareError(`${file} has no HOST binding and not the line setup replaces. Add "services": [{ "binding": "HOST", "service": "${WORKER}" }] to it, then run setup again`)
  writeFileSync(file, text.replace(PLACEHOLDER, `$1,\n  // The share host, reached for the share paths (proto share setup --domain added this).\n  "services": [{ "binding": "HOST", "service": "${WORKER}" }]\n`))
  return true
}

// ---------- the run ----------

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** What setup touches outside itself; the tests replace every part. */
export function defaultIo(tools) {
  return {
    // stdio: 'inherit' for `wrangler login`, which waits on the person's browser.
    wrangler: (args, { input, cwd, env = {}, inherit } = {}) => {
      mkdirSync(cwd || onlineDir(), { recursive: true })
      return spawnSync(process.execPath, [tools.wrangler, ...args], { cwd: cwd || onlineDir(), encoding: 'utf8', env: wranglerEnv(env), input, stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 2 ** 20 })
    },
    fetch: globalThis.fetch,
    log: line => console.log(line),
    sleep,
    getToken, setToken, saveHost, readHosts,
    hostname: machine(),
    ghLogin: () => {
      const r = spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8', timeout: 15_000 })
      return r.status === 0 ? r.stdout.trim() : ''
    },
    build: dir => spawnSync('pnpm', ['build'], { cwd: dir, stdio: 'inherit' }).status === 0,
    siteDir: join(SKILL, 'site'),
    prodVars: () => readProdVars(),
    hostVersion: hostHash(),
    // How long the checks wait: a new workers.dev name, and the first certificate on prtype.dev.
    waits: { up: 120_000, upEvery: 5000, tls: 15 * 60_000, tlsEvery: 15_000, zone: 60_000, zoneEvery: 10_000 },
  }
}

const tail = (r, secrets = []) => redact(((r.stderr || '') + '\n' + (r.stdout || '')).trim(), secrets).split('\n').slice(-15).join('\n')
const jsonOf = text => { try { return JSON.parse(text) } catch { return null } }

/**
 * proto share setup (online). flags: name, account, plan-checked, domain, subdomain. Resolves with
 * the host entry, or with null when it stopped at a step only Tomer can take (and said which).
 */
export async function setupOnline(flags, io) {
  const log = io.log
  const known = io.readHosts().find(h => h.name === 'online') || null
  const domain = typeof flags.domain === 'string' ? flags.domain.toLowerCase() : known?.stage === 'domain' ? known.base : null
  const must = (r, what, secrets) => {
    if (r.status !== 0) throw new ShareError(`${what} failed:\n${tail(r, secrets)}`)
    return r
  }

  // 2. Login: this tool's own wrangler login, for the prtype.dev account only.
  let who = jsonOf(io.wrangler(['whoami', '--json']).stdout)
  if (!who?.loggedIn) {
    log('A browser window opens: sign in to the Cloudflare account made for prtype.dev (not the dananz.com one) and click Allow.')
    must(io.wrangler(['login'], { inherit: true }), 'wrangler login')
    who = jsonOf(io.wrangler(['whoami', '--json']).stdout)
    if (!who?.loggedIn) throw new ShareError('Still not logged in to Cloudflare. Run proto share setup again and approve the login in the browser')
  }
  const accounts = who.accounts || []
  const wanted = typeof flags.account === 'string' ? flags.account : known?.accountId
  const account = wanted ? accounts.find(a => a.id === wanted || a.name === wanted) : accounts.length === 1 ? accounts[0] : null
  if (!account) throw new ShareError(wanted ? `No Cloudflare account "${wanted}" on this login (${accounts.map(a => a.name).join(', ')})` : `This login has ${accounts.length} accounts: pass --account with one of ${accounts.map(a => `"${a.name}"`).join(', ')}`)
  log(`Cloudflare: logged in as ${who.email}, account ${account.name}`)
  const env = { CLOUDFLARE_ACCOUNT_ID: account.id }
  const run = (args, opts = {}) => io.wrangler(args, { ...opts, env })
  const cfToken = jsonOf(must(run(['auth', 'token', '--json']), 'wrangler auth token').stdout)?.token
  if (!cfToken) throw new ShareError('wrangler auth token gave no token')
  const cf = async (method, path, body) => {
    const res = await io.fetch(API + path, { method, headers: { authorization: `Bearer ${cfToken}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return await res.json().catch(() => ({ success: false, errors: [{ message: `HTTP ${res.status}` }] }))
  }

  // 3. The free-plan guard: the separate account, a plan someone has looked at.
  const zones = await cf('GET', `/zones?account.id=${account.id}&per_page=50`)
  if (!zones.success) throw new ShareError(`Could not list the account's zones: ${(zones.errors || []).map(e => e.message).join('; ')}`)
  const others = zones.result.map(z => z.name).filter(n => n !== 'prtype.dev')
  if (others.length) throw new ShareError(`This is not the separate prtype.dev account (it has ${others.join(', ')}). Run XDG_CONFIG_HOME=~/.prototypes/share-tools/wrangler-home ~/.prototypes/share-tools/node_modules/.bin/wrangler logout, then proto share setup again and approve the login in a private browser window signed in to the prtype.dev account only.`)
  const planChecked = flags['plan-checked'] === true || known?.planChecked === true
  if (!planChecked) throw new ShareError('Cloudflare has no API that says whether an account is on Workers Free. Open dash.cloudflare.com › Workers & Pages › Plans on the prtype.dev account and check it says Free (and the account has no card), then run proto share setup --plan-checked. It is asked once.')
  log('Plan: Free (checked by hand), no card; KV, D1 and one cron only')

  // --domain: the zone must be on this account, Free, and active (its nameservers switched).
  if (domain) {
    const found = await cf('GET', `/zones?name=${encodeURIComponent(domain)}&account.id=${account.id}`)
    let zone = found.success ? found.result[0] : null
    if (!zone) {
      log(`${domain} is not on this Cloudflare account yet. In the dashboard: Add a domain › ${domain} › Free, skip the DNS scan's suggestions, and continue until it shows two nameservers.`)
      log("Run this again when it's added.")
      return null
    }
    const plan = zone.plan?.legacy_id
    if (plan && plan !== 'free') throw new ShareError(`${domain} is on the ${zone.plan?.name || plan} plan here; the share host stays on Free`)
    for (let end = Date.now() + io.waits.zone; zone.status !== 'active' && Date.now() < end; await io.sleep(io.waits.zoneEvery)) {
      const again = await cf('GET', `/zones/${zone.id}`)
      if (again.success) zone = again.result
    }
    if (zone.status !== 'active') {
      log(`${domain} waits for its nameservers. At Vercel: Domains › ${domain} › Nameservers › Edit, set ${(zone.name_servers || []).join(' and ')}, save.`)
      log(`Waiting for the nameserver change (up to 48 h, often under an hour). Run proto share setup --domain ${domain} again once Cloudflare emails that the site is active.`)
      return null
    }
    log(`${domain}: active on this account, Free`)
  }

  // 4. The workers.dev name: the account gets one before the first deploy, which fails without it.
  const owned = await cf('GET', `/accounts/${account.id}/workers/subdomain`)
  let sub = owned.success ? owned.result?.subdomain : null
  const name = () => (typeof flags.name === 'string' && flags.name.trim()) || known?.owner || io.ghLogin() || (() => { throw new ShareError('Pass --name: gh is not logged in') })()
  if (!sub) {
    if (!(owned.errors || []).some(e => e.code === 10007)) throw new ShareError(`Could not read the account's workers.dev name: ${(owned.errors || []).map(e => e.message).join('; ')}`)
    const want = (typeof flags.subdomain === 'string' ? flags.subdomain : `${name()}-proto`).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
    const made = await cf('PUT', `/accounts/${account.id}/workers/subdomain`, { subdomain: want })
    if (!made.success) throw new ShareError(`Could not register ${want}.workers.dev (${(made.errors || []).map(e => e.message).join('; ')}). Pick another with --subdomain <name>`)
    sub = made.result?.subdomain || want
    log(`workers.dev: registered ${sub}.workers.dev`)
  } else log(`workers.dev: ${sub}.workers.dev`)
  const workersDev = `${WORKER}.${sub}.workers.dev`

  // The OAuth App's id and secret, read before anything is made: a prod.vars that isn't right stops
  // the run here.
  const vars = io.prodVars()

  // 5. The KV namespace and the D1 database, looked up before anything is made. These run in a
  // folder of their own under the temp folder: wrangler looks for a config in the folder and every
  // folder above it, and `kv namespace create` may offer to add a binding to one it finds.
  const empty = accountDir()
  const kvList = () => jsonOf(must(run(['kv', 'namespace', 'list'], { cwd: empty }), 'wrangler kv namespace list').stdout) || []
  const kvFind = list => list.find(n => n.id === known?.kvId) || list.find(n => n.title === WORKER)
  let kv = kvFind(kvList())
  if (!kv) {
    const made = must(run(['kv', 'namespace', 'create', WORKER], { cwd: empty }), 'wrangler kv namespace create')
    const id = (made.stdout.match(/\b[0-9a-f]{32}\b/) || [])[0]
    kv = kvList().find(n => n.id === id) || kvFind(kvList())
    if (!kv) throw new ShareError(`wrangler made a KV namespace but setup can't find it:\n${tail(made)}`)
    log(`KV: made ${kv.title} (${kv.id})`)
  } else log(`KV: ${kv.title} (${kv.id})`)
  const dbList = () => jsonOf(must(run(['d1', 'list', '--json'], { cwd: empty }), 'wrangler d1 list').stdout) || []
  const dbFind = list => list.find(d => d.uuid === known?.dbId) || list.find(d => d.name === WORKER)
  let db = dbFind(dbList())
  if (!db) {
    must(run(['d1', 'create', WORKER], { cwd: empty }), 'wrangler d1 create')
    db = dbFind(dbList())
    if (!db) throw new ShareError('wrangler made the D1 database but setup can\'t find it in wrangler d1 list')
    log(`D1: made ${db.name} (${db.uuid})`)
  } else log(`D1: ${db.name} (${db.uuid})`)

  // 6. The config, on workers.dev or behind the site on the domain (sign-in on, the old name kept),
  // and the migrations, which don't depend on which.
  const configFile = join(onlineDir(), 'wrangler.jsonc')
  const configFor = base => writeOnlineConfig(configFile, { accountId: account.id, kvId: kv.id, dbId: db.uuid, base, signin: base === domain, legacy: base === domain ? workersDev : '', card: base === domain, subdomains: base === domain, hostVersion: io.hostVersion })
  configFor(workersDev)
  const applied = must(run(['d1', 'migrations', 'apply', 'DB', '--remote', '-c', configFile]), 'Applying the migrations')
  log(/No migrations to apply/i.test(applied.stdout) ? 'Migrations: up to date' : 'Migrations: applied')
  const sql = async text => {
    const r = must(run(['d1', 'execute', 'DB', '--remote', '-c', configFile, '--json', '--command', text]), 'The host\'s database')
    return (jsonOf(r.stdout) || []).flatMap(x => x.results || [])
  }
  // Where the host is live, as setup last left it in its own database: the host entry on this Mac
  // may be missing (another Mac, a lost hosts.json), and a plain run must never move a host on the
  // domain back to workers.dev with sign-in off.
  const stored = Object.fromEntries((await sql("SELECT k, v FROM meta WHERE k IN ('stage', 'base')")).map(r => [r.k, r.v]))
  if (stored.stage === 'domain' && !domain) throw new ShareError(`This host is live on ${stored.base}: a plain setup would move it back to workers.dev and turn sign-in off. Run proto share setup --domain ${stored.base}`)
  const remember = (stage, base) => sql(`INSERT INTO meta (k, v) VALUES ('stage', ${lit(stage)}), ('base', ${lit(base)}) ON CONFLICT(k) DO UPDATE SET v = excluded.v`)
  // Already behind this domain: deployed as it is. Else on workers.dev first; the domain's config
  // goes out only once the site reaches the host (below), so links never point at a dead end.
  // A host set up before setup kept its stage in the database has only this Mac's entry to say so.
  const onDomain = !!domain && ((stored.stage === 'domain' && stored.base === domain) || (!stored.stage && known?.stage === 'domain' && known.base === domain))
  const first = onDomain ? domain : workersDev
  configFor(first)
  log(`Config: ${configFile} (BASE ${first}${onDomain ? ', sign-in on' : ''})`)

  // 7, 8. The code.
  must(run(['deploy', '-c', configFile]), 'wrangler deploy')
  log(`Deployed ${WORKER}`)

  // 9. Secrets, on stdin: the OAuth App's always (they may have changed), VIEWER_KEY only once, so
  // a re-run never signs viewers out. They wait unused until sign-in is on (the domain).
  const viewerKey = randomBytes(32).toString('base64url')
  const secrets = [vars.GITHUB_CLIENT_ID, vars.GITHUB_CLIENT_SECRET, viewerKey]
  const listed = jsonOf(must(run(['secret', 'list', '--format', 'json', '-c', configFile]), 'wrangler secret list', secrets).stdout) || []
  const put = (key, value) => must(run(['secret', 'put', key, '-c', configFile], { input: value }), `Setting ${key}`, secrets)
  put('GITHUB_CLIENT_ID', vars.GITHUB_CLIENT_ID)
  put('GITHUB_CLIENT_SECRET', vars.GITHUB_CLIENT_SECRET)
  const hadKey = listed.some(s => s.name === 'VIEWER_KEY')
  if (!hadKey) put('VIEWER_KEY', viewerKey)
  log(`Secrets: the GitHub OAuth App's id and secret${hadKey ? '' : ', a new viewer key'}`)

  // 10. The owner, the one allowed to upload, and this Mac's token.
  const { owner, minted } = await ownerAndToken({ sql, name, tokenName: 'online', device: io.hostname, get: io.getToken, set: io.setToken })
  log(`Owner: ${owner.name}; ${minted ? 'a new token for this Mac in the Keychain (prototype-share-online)' : "this Mac's token works"}`)

  // 11, 12. The checks, then the host entry. Before the domain answers, links stay on workers.dev.
  const token = io.getToken('online')
  const entry = { name: 'online', url: `https://${workersDev}`, stage: 'workers', base: workersDev, pathMode: true, default: true, owner: owner.name, accountId: account.id, worker: WORKER, kvId: kv.id, dbId: db.uuid, hostVersion: io.hostVersion, workersDev, planChecked: true }
  if (!onDomain) {
    await upCheck(io, workersDev, token)
    if (stored.stage !== 'domain') await remember('workers', workersDev)
    // Kept even when the domain steps below stop: the host and the plan check stay known.
    io.saveHost(entry)
    if (!domain) {
      log(`Online share host at https://${workersDev}/ (owner ${owner.name}). Links: https://${workersDev}/s/<id>/.`)
      log('Viewers can read; comments open once prtype.dev is set up: proto share setup --domain prtype.dev.')
      return entry
    }
  } else await upCheck(io, workersDev, null) // a legacy name: its /api answers 410, so the token is checked on the domain

  // The domain: the site Worker on it hands the share paths to this one (HOST), so the site's
  // config gains the binding and is deployed again, built fresh. The host's own route is the shares'
  // wildcard, <id>.<domain> (onlineConfig).
  const siteConfig = join(io.siteDir, 'wrangler.jsonc')
  const edited = bindSite(siteConfig)
  if (edited) log(`Site: ${siteConfig} binds HOST to ${WORKER} (commit that change)`)
  const before = await probe(io, `https://${domain}/_health`)
  if (edited || !(before?.status === 200 && before.headers.get('x-proto-host'))) {
    log('Site: building')
    if (!io.build(io.siteDir)) throw new ShareError(`Building the site in ${io.siteDir} failed (see above)`)
    must(run(['deploy', '-c', siteConfig], { cwd: io.siteDir }), 'Deploying the site')
    log('Site: deployed with the HOST binding')
  } else log('Site: already hands the share paths to the host')
  await reaches(io, domain)
  if (!onDomain) {
    configFor(domain)
    must(run(['deploy', '-c', configFile]), 'wrangler deploy')
    log(`Deployed ${WORKER} behind ${domain} (BASE ${domain}, sign-in on, ${workersDev} kept for old links)`)
  }
  await domainChecks(io, domain, workersDev, token)
  await remember('domain', domain)
  // Each share on its own name there: an entry from before (pathMode true) is corrected here.
  const live = { ...entry, url: `https://${domain}`, stage: 'domain', base: domain, pathMode: false }
  io.saveHost(live)
  log(`${domain} is live: links are https://${domain}/<id>; viewers sign in with GitHub to comment.`)
  return live
}

const probe = async (io, url, init = {}) => { try { return await io.fetch(url, { signal: AbortSignal.timeout(10_000), ...init }) } catch { return null } }

// The host on its workers.dev name: up, on this skill's code, and taking this Mac's token. A name
// registered a moment ago can take a minute or two to answer.
async function upCheck(io, name, token) {
  let res = null
  for (let end = Date.now() + io.waits.up; ; await io.sleep(io.waits.upEvery)) {
    res = await probe(io, `https://${name}/_health`)
    if (res?.status === 200 && res.headers.get('x-proto-host') === io.hostVersion) break
    if (Date.now() >= end) throw new ShareError(`https://${name}/_health ${res ? `answered ${res.status}${res.headers.get('x-proto-host') ? ` from code ${res.headers.get('x-proto-host')}` : ''}` : "doesn't answer"} (expected code ${io.hostVersion}). A new workers.dev name can take a few minutes: run proto share setup again soon.`)
  }
  if (!token) return io.log(`Check: https://${name}/_health answers on this code`)
  const api = await probe(io, `https://${name}/api/shares`, { headers: { authorization: `Bearer ${token}` } })
  if (api?.status !== 200) throw new ShareError(`The host doesn't take this Mac's token (GET /api/shares answered ${api?.status ?? 'nothing'}). Run proto share setup again`)
  io.log(`Check: https://${name}/_health answers on this code, and the owner API takes this Mac's token`)
}

// The site on the domain hands /_health to the host over TLS (Node's own trust store). The host's
// config is still on workers.dev here, so a wait that runs out leaves every link working there.
async function reaches(io, domain) {
  let res = null
  for (let end = Date.now() + io.waits.tls; ; await io.sleep(io.waits.tlsEvery)) {
    res = await probe(io, `https://${domain}/_health`)
    if (res?.status === 200 && res.headers.get('x-proto-host')) break
    if (Date.now() >= end) {
      const text = res ? await res.text().catch(() => '') : ''
      if (/not open yet/i.test(text)) throw new ShareError(`https://${domain}/_health answers the site's "Shared links are not open yet": the site Worker has no HOST binding live. Check site/wrangler.jsonc has it, then run proto share setup --domain ${domain} again`)
      throw new ShareError(`https://${domain}/_health ${res ? `answered ${res.status}` : "doesn't answer over TLS yet"}. The first certificate can take from 15 minutes to 24 hours after the zone went active. Links keep working on workers.dev meanwhile: run proto share setup --domain ${domain} again later.`)
    }
  }
  io.log(`Check: https://${domain}/_health reaches the host over TLS`)
}

// The host behind the domain on this code, taking this Mac's token, the old name moving there, and
// sign-in switched on.
async function domainChecks(io, domain, workersDev, token) {
  let res = null
  for (let end = Date.now() + io.waits.up; ; await io.sleep(io.waits.upEvery)) {
    res = await probe(io, `https://${domain}/_health`)
    if (res?.status === 200 && res.headers.get('x-proto-host') === io.hostVersion) break
    if (Date.now() >= end) throw new ShareError(`https://${domain}/_health answers code ${res?.headers.get('x-proto-host') || 'none'}, not ${io.hostVersion}. Run proto share setup --domain ${domain} again`)
  }
  io.log(`Check: https://${domain}/_health answers on this code`)
  const api = await probe(io, `https://${domain}/api/shares`, { headers: { authorization: `Bearer ${token}` } })
  if (api?.status !== 200) throw new ShareError(`The host on ${domain} doesn't take this Mac's token (GET /api/shares answered ${api?.status ?? 'nothing'}). Run proto share setup --domain ${domain} again`)
  const moved = await probe(io, `https://${workersDev}/s/${ID}/`, { redirect: 'manual' })
  if (![301, 308].includes(moved?.status) || moved.headers.get('location') !== `https://${domain}/s/${ID}/`) throw new ShareError(`https://${workersDev}/s/${ID}/ should move to https://${domain}/s/${ID}/ but answered ${moved?.status ?? 'nothing'} ${moved?.headers.get('location') || ''}`)
  io.log(`Check: old links on ${workersDev} move to ${domain}`)
  const signin = await probe(io, `https://${domain}/auth/github?share=${ID}&nonce=${NONCE}`, { redirect: 'manual' })
  // 404 (no such share) is the host past its sign-in switch; 400 is sign-in still off.
  if (signin?.status !== 404) throw new ShareError(`Sign-in on ${domain} isn't on (GET /auth/github answered ${signin?.status ?? 'nothing'}): check the secrets with wrangler secret list, then run setup again`)
  io.log(`Check: sign-in with GitHub is on at https://${domain}/auth/github`)
  // The short link as a browser asks for it (a navigation): the site must hand it to the host.
  const short = await probe(io, `https://${domain}/${ID}`, { headers: { 'sec-fetch-mode': 'navigate', accept: 'text/html' } })
  if (!short?.headers.get('x-robots-tag')) io.log(`Warning: https://${domain}/<id> is answered by the site, not the share host (${short?.status ?? 'no answer'}): short links won't open. The site's run_worker_first must cover them.`)
  else io.log(`Check: short links https://${domain}/<id> reach the host`)
}

// ---------- the host on this Mac: GitHub sign-in ----------

/** ~/.prototypes/host/.dev.vars as KEY=value pairs (what's there; no key is required). */
function readDevVars(file = devVarsFile()) {
  const out = {}
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return out
}
function writeDevVars(vars, file = devVarsFile()) {
  mkdirSync(hostDir(), { recursive: true })
  writeFileSync(file, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 })
  chmodSync(file, 0o600)
}

/** The local host's VIEWER_KEY, made once and kept (a new one would sign every viewer out). Says whether it made one. */
export function ensureViewerKey(file = devVarsFile()) {
  const vars = readDevVars(file)
  if (vars.VIEWER_KEY) return false
  writeDevVars({ ...vars, VIEWER_KEY: randomBytes(32).toString('base64url') }, file)
  return true
}

// Lines from stdin: the person types them (the secret without an echo), or another program pipes them.
async function readLines(count, prompts) {
  const { stdin, stdout } = process
  if (!stdin.isTTY) {
    let text = ''
    for await (const chunk of stdin) text += chunk
    return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, count)
  }
  const out = []
  stdin.setRawMode(true)
  stdin.resume()
  try {
    for (const { label, hidden } of prompts.slice(0, count)) {
      stdout.write(label)
      out.push(await new Promise(done => {
        let v = ''
        const on = d => {
          for (const ch of d.toString('utf8')) {
            if (ch === '\r' || ch === '\n') { stdin.off('data', on); stdout.write('\n'); return done(v.trim()) }
            if (ch === '\u0003') process.exit(130)
            if (ch === '\u007f') { if (v) { v = v.slice(0, -1); if (!hidden) stdout.write('\b \b') } continue }
            v += ch
            if (!hidden) stdout.write(ch)
          }
        }
        stdin.on('data', on)
      }))
    }
  } finally { stdin.setRawMode(false); stdin.pause() }
  return out
}

/**
 * proto share setup --github: the OAuth App for the host on this Mac. Its id (--client-id, or the
 * first line on stdin) and secret (stdin, never echoed; --client-secret works but shows in `ps`) go
 * into ~/.prototypes/host/.dev.vars beside the viewer key. The running host is restarted only with
 * --restart.
 */
export async function setupGithub(flags, { log = console.log, read = readLines, port } = {}) {
  const at = port || Number(readHosts().find(h => h.name === 'local')?.url?.split(':').pop()) || 8787
  log('Register a GitHub OAuth App (two minutes): github.com/settings/applications/new')
  log(`  Homepage URL: http://localhost:${at}`)
  log(`  Authorization callback URL: http://localhost:${at}/auth/github/callback`)
  log('  Then Generate a new client secret.')
  let id = typeof flags['client-id'] === 'string' ? flags['client-id'].trim() : ''
  let secret = typeof flags['client-secret'] === 'string' ? flags['client-secret'].trim() : ''
  const need = [!id && { label: 'Client ID: ', hidden: false }, !secret && { label: 'Client secret (not shown): ', hidden: true }].filter(Boolean)
  if (need.length) {
    const got = await read(need.length, need)
    if (!id) id = got.shift() || ''
    if (!secret) secret = got.shift() || ''
  }
  if (!/^[A-Za-z0-9._-]{8,}$/.test(id)) throw new ShareError('That client id does not look like a GitHub OAuth App\'s (Ov23li… or Iv1.…)')
  if (!/^[A-Za-z0-9_-]{20,}$/.test(secret)) throw new ShareError('That client secret does not look like a GitHub one (40 hex characters)')
  const vars = readDevVars()
  writeDevVars({ ...vars, GITHUB_CLIENT_ID: id, GITHUB_CLIENT_SECRET: secret, VIEWER_KEY: vars.VIEWER_KEY || randomBytes(32).toString('base64url') })
  log(`Saved to ${devVarsFile()} (mode 600)${vars.VIEWER_KEY ? '' : ' with a new viewer key'}.`)
  if (flags.restart === true) {
    await ensureTools()
    await stopLocal()
    const host = await startLocal({ name: flags.name })
    log(`Restarted the local share host on ${host.url}: viewers can sign in with GitHub.`)
  } else log('Restart the host to apply: proto share stop && proto share setup --local (or run this again with --restart).')
}
