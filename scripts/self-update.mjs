// Keeps an installed skill current. `proto up` calls skillUpdate() at most once every few hours:
// a clean git clone on main is fast-forwarded (and `proto up` then runs again on the new code), and
// a Claude Code plugin install that fell behind GitHub's main gets a line asking the agent to update
// it. A checkout on another branch, with edits, or inside another repository is a developer's: left alone.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'

export const CHECK_HOURS = 6
const REPO = 'https://github.com/Dananz/prototype-skill'

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
const real = p => { try { return realpathSync(p) } catch { return p } }
const git = (args, opts = {}) => spawnSync('git', args, { encoding: 'utf8', timeout: 30_000, ...opts })
const out = r => r.status === 0 ? r.stdout.trim() : null
const short = sha => sha?.slice(0, 7)

/** The plugin install this skill directory is, from Claude Code's record of installed plugins. */
export function pluginInstall(skill, configDir) {
  const installed = readJson(join(configDir, 'plugins', 'installed_plugins.json'), null)
  const here = real(skill)
  for (const [key, list] of Object.entries(installed?.plugins || {})) {
    const entry = (Array.isArray(list) ? list : [list]).find(e => e?.installPath && real(e.installPath) === here)
    if (entry) return { key, sha: entry.gitCommitSha || null }
  }
  return null
}

/** The commit at the head of the repository's main, or null when it can't be reached. */
function latestOf(repo) {
  const r = git(['ls-remote', repo, 'refs/heads/main'], { timeout: 8_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  return out(r)?.split(/\s/)[0] || null
}

/** A clone of this skill on main with no edits to tracked files, else null. */
function cleanClone(skill) {
  const top = out(git(['-C', skill, 'rev-parse', '--show-toplevel']))
  if (!top || real(top) !== real(skill)) return null
  if (!/prototype-skill(\.git)?\/?$/.test(out(git(['-C', skill, 'remote', 'get-url', 'origin'])) || '')) return null
  if (out(git(['-C', skill, 'symbolic-ref', '--short', 'HEAD'])) !== 'main') return null
  if (out(git(['-C', skill, 'status', '--porcelain', '--untracked-files=no'])) !== '') return null
  return { head: out(git(['-C', skill, 'rev-parse', 'HEAD'])) }
}

/**
 * Checks for a newer skill and applies it when that is safe. Returns { lines, updated }: lines for
 * the agent to read, and updated when a git clone moved, so the caller runs again on the new code.
 */
export function skillUpdate(skill, {
  env = process.env, now = Date.now(),
  stateFile = join(homedir(), '.prototypes', 'update.json'),
  configDir = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
} = {}) {
  const none = { lines: [], updated: false }
  if (env.PROTO_NO_UPDATE === '1') return none
  const state = readJson(stateFile, {})
  const mine = state[skill] || {}
  const due = !(now - (mine.checkedAt || 0) < CHECK_HOURS * 3600_000)
  const save = patch => {
    try {
      mkdirSync(dirname(stateFile), { recursive: true })
      writeFileSync(stateFile, JSON.stringify({ ...readJson(stateFile, {}), [skill]: { ...mine, ...patch } }, null, 2) + '\n')
    } catch {}
  }

  const plugin = pluginInstall(skill, configDir)
  if (plugin) {
    let latest = mine.latest
    if (due) {
      const repo = readJson(join(skill, '.claude-plugin', 'plugin.json'), {}).repository || REPO
      latest = latestOf(repo) || latest
      save({ checkedAt: now, latest })
    }
    if (!latest || !plugin.sha || latest === plugin.sha) return none
    return { updated: false, lines: [`skill: a newer prototype skill is out (installed ${short(plugin.sha)}, latest ${short(latest)}): run \`claude plugin update ${plugin.key}\` now, and tell the user once that it applies from their next session (or after /reload-plugins)`] }
  }

  // Claude Code's plugin cache is its own to change, even when its record of this copy is missing.
  if (real(skill).startsWith(real(join(configDir, 'plugins')) + sep)) return none
  if (!due || !existsSync(join(skill, '.git'))) return none
  const clone = cleanClone(skill)
  if (!clone) return none
  save({ checkedAt: now })
  const pull = git(['-C', skill, 'pull', '--ff-only', '--quiet', 'origin', 'main'], { env: { ...env, GIT_TERMINAL_PROMPT: '0' } })
  if (pull.status !== 0) {
    const why = (pull.stderr || '').trim().split('\n')[0] || (pull.error ? pull.error.message : 'git pull failed')
    return { updated: false, lines: [`skill: could not update the prototype skill (${why}); carrying on with ${short(clone.head)}`] }
  }
  const head = out(git(['-C', skill, 'rev-parse', 'HEAD']))
  if (!head || head === clone.head) return none
  return { updated: true, lines: [`skill: updated the prototype skill ${short(clone.head)} -> ${short(head)}: re-read SKILL.md before going on, it may have changed`] }
}
