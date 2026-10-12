// Runs one headless /prototype session and times it from the filesystem.
// node bench.mjs <run-name> <skill-dir> <prompt-file>
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const [name, skill, promptFile] = process.argv.slice(2)
const root = '/Users/tomer/Code/proto-bench'
const project = join(root, 'runs', name)
mkdirSync(project, { recursive: true })
if (!existsSync(join(project, '.git'))) {
  writeFileSync(join(project, 'README.md'), `# ${name}\n`)
  for (const a of [['init', '-q'], ['add', '-A'], ['commit', '-qm', 'init']]) spawnSync('git', a, { cwd: project, stdio: 'ignore' })
}
const uuid = randomUUID()
const sdir = join(project, '.prototypes', uuid.slice(0, 8))
const task = readFileSync(promptFile, 'utf8').trim()
const prompt = `Invoke the Skill tool with skill prototype:prototype first, then follow it for this request:\n\n${task}\n\nHeadless benchmark run with no reviewer: skip \`proto inbox --wait\`, ask no questions, make your own calls.`

const t0 = Date.now(), at = {}, mark = k => { if (!(k in at)) { at[k] = (Date.now() - t0) / 1000; log(`${k} ${at[k]}s`) } }
const out = createWriteStream(join(root, 'logs', `${name}.jsonl`))
const log = s => console.log(`[${name}] ${s}`)
const child = spawn('claude', ['-p', '--plugin-dir', skill, '--session-id', uuid, '--model', 'opus', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', prompt], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] })
let result = null, buf = ''
child.stdout.on('data', d => {
  out.write(d); buf += d
  let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const e = JSON.parse(line); if (e.type === 'result') result = e } catch {} }
})
child.stderr.on('data', d => out.write(d))

const lettersIn = dir => readdirSync(dir).filter(f => /^[A-Z]+\.(tsx|vue)$/.test(f))
const poll = setInterval(() => {
  try {
    const sj = join(sdir, 'session.json')
    if (existsSync(sj) && JSON.parse(readFileSync(sj, 'utf8')).url) mark('link')
    const protos = join(sdir, 'src', 'protos')
    if (!existsSync(protos)) return
    const slugs = readdirSync(protos).filter(f => existsSync(join(protos, f, 'meta.ts')))
    if (slugs.length) mark('added')
    let total = 0, built = 0
    for (const s of slugs) for (const f of lettersIn(join(protos, s))) { total++; if (!readFileSync(join(protos, s, f), 'utf8').includes('Placeholder while')) built++ }
    if (built >= 1) mark('first')
    if (total && built === total) at.allBuilt = (Date.now() - t0) / 1000 // last time every placeholder was gone
    if (total && built < total) delete at.allBuilt
  } catch {}
}, 1000)

child.on('exit', code => {
  clearInterval(poll)
  at.done = (Date.now() - t0) / 1000
  const s = existsSync(join(sdir, 'session.json')) ? JSON.parse(readFileSync(join(sdir, 'session.json'), 'utf8')) : {}
  const pkg = existsSync(join(sdir, 'package.json')) ? JSON.parse(readFileSync(join(sdir, 'package.json'), 'utf8')) : {}
  const summary = {
    name, skill, uuid, session: sdir, url: s.url, exit: code, seconds: at,
    craftKit: Object.keys(pkg.dependencies || {}).some(d => d.startsWith('@fontsource-variable/geist')),
    briefs: existsSync(join(sdir, '.proto', 'briefs')),
    cost: result?.total_cost_usd, turns: result?.num_turns, apiSeconds: result?.duration_api_ms / 1000,
    final: result?.result,
  }
  writeFileSync(join(root, 'results', `${name}.json`), JSON.stringify(summary, null, 2))
  log(`done ${JSON.stringify(at)} cost ${summary.cost}`)
})
