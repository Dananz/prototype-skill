// A prototype's decision brief: what was asked, what the user picked and why, what else was tried,
// the changes asked on the pick and every comment from the page with its answer, in one Markdown page
// a team can read and an agent can build from. Made from what the session already keeps: meta.ts,
// session.json's asks, the inbox's batches and the variants' earlier versions (history.mjs). Written to
// .proto/decisions/<slug>.md by `proto brief <slug>` and by Decision brief in the page.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { versionsOf } from './history.mjs'
import { numberOf } from './numbers.mjs'

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
const metaOf = text => JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
const readMeta = (app, slug) => { try { return metaOf(readFileSync(join(app, 'src', 'protos', slug, 'meta.ts'), 'utf8')) } catch { return null } }
const order = (a, b) => a.length - b.length || a.localeCompare(b)
const day = at => String(at || '').slice(0, 16).replace('T', ' ')
const line = s => String(s ?? '').replace(/\s+/g, ' ').trim()
const quote = s => `“${line(s)}”`

/** The variants a combine takes parts from: the one it was asked on first (its structure is the
 *  base), then each variant its note tags, by name (@2) or through an element picked on it. */
export const partsOf = c => [c.route.split('/').slice(0, 2).join('/'), ...(Array.isArray(c.tags) ? c.tags : []).map(t => t?.variantRef ?? t?.source).filter(r => r && typeof r.proto === 'string' && typeof r.variant === 'string').map(r => `${r.proto}/${r.variant}`)]
  .filter((r, i, all) => all.indexOf(r) === i)

/** Every comment sent from the page on this prototype (its variants, or the prototype), oldest first. */
function commentsOn(app, slug) {
  const inbox = join(app, '.proto', 'inbox'), out = []
  for (const sub of ['new', 'taken']) {
    let ids = []
    try { ids = readdirSync(join(inbox, sub)).filter(f => !f.startsWith('.')) } catch { continue }
    for (const id of ids) {
      const b = readJson(join(inbox, sub, id, 'batch.json'), null)
      for (const c of b?.comments || []) {
        if (c.withdrawn || c.action === 'intake' || (c.route !== slug && !c.route?.startsWith(`${slug}/`))) continue
        out.push({ ...c, batch: id, at: c.at || b.at, reply: c.reply || (b.done ? b.reply : null), done: !!(c.done || b.done) })
      }
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.n - b.n)
}

/** The brief as Markdown, and what it was made from (for the page and the tests). Null: no such prototype. */
export function brief(app, slug) {
  const meta = readMeta(app, slug)
  if (!meta) return null
  const session = readJson(join(app, 'session.json'), {})
  const ids = Object.keys(meta.variants || {}).sort(order)
  const name = id => `#${numberOf(id) || id} · ${meta.variants[id]}`
  const ref = route => {
    const [s, id] = route.split('/')
    const m = s === slug ? meta : readMeta(app, s)
    if (!id) return m?.title || s
    return `${s === slug ? '' : `${m?.title || s} `}#${numberOf(id) || id}${m?.variants?.[id] ? ` · ${m.variants[id]}` : ''}`
  }
  const pick = meta.picked && meta.variants?.[meta.picked] ? meta.picked : null
  const comments = commentsOn(app, slug)
  const pickNote = pick ? comments.filter(c => c.action === 'pick' && c.route === `${slug}/${pick}` && c.note).at(-1)?.note : ''
  const asks = pick ? (session.asks?.[`${slug}/${pick}`] || []) : []
  const versions = pick ? versionsOf(app, slug, pick) : []
  const open = comments.filter(c => !c.done && c.action !== 'unpick')
  const children = (() => {
    try {
      return readdirSync(join(app, 'src', 'protos')).filter(s => s !== slug).map(s => ({ s, m: readMeta(app, s) }))
        .filter(({ m }) => m && !m.archived && [m.from, ...(m.also || [])].some(f => typeof f === 'string' && (f === slug || f.startsWith(`${slug}/`))))
    } catch { return [] }
  })()

  const out = [`# Decision brief: ${meta.title || slug}`, '']
  out.push(`${day(new Date().toISOString())}${session.name ? ` · ${session.name}` : ''} · prototype \`${slug}\``, '')
  out.push('## What was asked', '', meta.ask ? `> ${line(meta.ask)}` : '_No ask was recorded._', '')
  if (meta.from) out.push(`Built from ${[meta.from, ...(meta.also || [])].map(ref).join(' + ')}.`, '')

  out.push('## The decision', '')
  if (pick) {
    out.push(`**Picked: ${name(pick)}**`, '')
    if (meta.about?.[pick]) out.push(`What it is: ${line(meta.about[pick])}`, '')
    out.push(pickNote ? `Why, in the user's words: ${quote(pickNote)}` : '_No reason was given with the pick._', '')
  } else out.push('_Nothing is picked yet._ Pick a variant in the page (Decide) or say it in chat, then make this brief again.', '')

  const rest = ids.filter(id => id !== pick)
  if (rest.length) {
    out.push(pick ? '## The other directions' : '## The directions', '')
    for (const id of rest) {
      const star = (meta.favorites || []).includes(id) ? ' ★' : ''
      out.push(`- ${name(id)}${star}${meta.about?.[id] ? `: ${line(meta.about[id])}` : ''}`)
    }
    out.push('')
  }

  if (pick && (asks.length || versions.length)) {
    out.push(`## Changes asked on ${name(pick)}`, '')
    for (const a of asks) out.push(`- ${day(a.at)} ${line(a.text)}`)
    if (versions.length) out.push('', `${versions.length} earlier version${versions.length === 1 ? ' is' : 's are'} kept; History in the page shows each beside the pick.`)
    out.push('')
  }

  out.push('## Feedback from the page', '')
  if (!comments.length) out.push('_No comments were sent from the page._', '')
  else {
    for (const c of comments) {
      const who = c.route.includes('/') ? ref(c.route) : 'the prototype'
      const what = c.action === 'combine' ? `combine parts of ${partsOf(c).map(ref).join(' + ')}: ${quote(c.text)}` : quote(c.text)
      const answer = c.reply ? ` → ${quote(c.reply.text)}` : ''
      out.push(`- ${c.done ? '[x]' : '[ ]'} On ${who}: ${what}${answer}`)
    }
    out.push('')
  }

  if (children.length) {
    out.push('## Explored from it', '')
    for (const { s, m } of children) out.push(`- ${m.title || s} (\`${s}\`, from ${[m.from, ...(m.also || [])].map(ref).join(' + ')})${m.picked && m.variants?.[m.picked] ? `: picked #${numberOf(m.picked) || m.picked} · ${m.variants[m.picked]}` : ''}`)
    out.push('')
  }

  out.push('## For the agent', '')
  if (pick) {
    const file = readdirSync(join(app, 'src', 'protos', slug)).find(f => f.replace(/\.\w+$/, '') === pick) || `${pick}.tsx`
    out.push(`- Design: \`src/protos/${slug}/${file}\` and the files beside it that are not variants.`)
    out.push(`- To build it into the codebase: \`proto handoff ${slug}/${pick}\`, then references/build.md.`)
    if (versions.length) out.push(`- Earlier versions: \`proto history ${slug}/${pick}\`.`)
  } else out.push(`- Nothing to build yet: wait for a pick (\`proto pick ${slug} <number>\` once the user chooses).`)
  out.push(open.length ? `- Still open: ${open.length} comment${open.length === 1 ? '' : 's'} above without a tick. Handle them before building.` : '- No comments are open.')
  out.push('')
  return { markdown: out.join('\n'), picked: pick, comments: comments.length, open: open.length, versions: versions.length }
}

/** Makes the brief and keeps it at .proto/decisions/<slug>.md. Says where, or null. */
export function writeBrief(app, slug) {
  const b = brief(app, slug)
  if (!b) return null
  const dir = join(app, '.proto', 'decisions')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = join(dir, `${slug}.md`)
  writeFileSync(file, b.markdown)
  return { ...b, file }
}
