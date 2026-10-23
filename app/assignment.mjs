// A choice can be marked without being installed. Keep that work visible to the agent.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const isCurrent = name => /^(current|as built)$/i.test(String(name || '').trim())

export function assignmentNeeded(dir, slug, id) {
  const read = name => JSON.parse(readFileSync(join(dir, 'src/protos', name, 'meta.ts'), 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  const meta = read(slug)
  if (meta.referenceOnly || (!meta.slot && meta.also?.length) || typeof meta.from !== 'string' || !/^[a-z0-9][a-z0-9-]*\/[A-Z]{1,2}$/.test(meta.from)) return ''
  if (isCurrent(meta.variants?.[id])) return ''
  const refs = [meta.from, ...(meta.also || [])].join(',')
  const repair = reason => `assignment pending in ${meta.from}: ${reason}. Use the user's request and this prototype's ask to determine the intended component. Connect it with <Slot> and proto add ${slug} --from ${refs} --slot <id>, preserve the variant's props and behavior, then run proto pick ${slug} ${id} and verify it in ${meta.from}.${!meta.slot ? ` For an intentionally separate design, record proto add ${slug} --reference-only instead.` : ''} Handle any note, then reply --done`
  const session = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'))
  if (session.stack && session.stack !== 'react') return ''
  if (!meta.slot) return repair('no slot was connected when these variants were created')
  const [parent, letter] = meta.from.split('/')
  let pm
  try { pm = read(parent) } catch { return repair('the parent metadata is missing or unreadable') }
  const slot = pm.slots?.[meta.slot]
  if (!slot || slot.variant !== letter) return repair(`the ${meta.slot} slot is not registered on this parent variant`)
  let source = ''
  for (const ext of ['tsx', 'jsx']) {
    try { source = readFileSync(join(dir, 'src/protos', parent, `${letter}.${ext}`), 'utf8'); break }
    catch (e) { if (e.code !== 'ENOENT') return repair(`the parent source cannot be read (${e.code})`) }
  }
  if (!/^[a-z][a-z0-9-]*$/.test(meta.slot) || !new RegExp(`<Slot\\s+proto="${parent}"\\s+id="${meta.slot}"`).test(source)) return repair(`the parent no longer renders its ${meta.slot} slot`)
  if (slot.use && slot.use.split('/')[0] !== slug) return `assignment pending in ${meta.from}: ${meta.slot} currently uses ${slot.use}. Read the inbox and history to identify the latest user choice; do not overwrite a newer pick. If this choice was superseded, run proto pick ${slug} --off, otherwise run proto pick ${slug} ${id} and verify it in ${meta.from}. Handle any note, then reply --done`
  if (slot.use !== `${slug}/${id}`) return repair(`the ${meta.slot} slot is not using the chosen variant yet`)
  return ''
}

// A pick among a variant's next versions (built --from it with --next) is that variant's new design:
// the agent builds it into the parent, then on up through parents that are next versions too. Returns what to do, or '' when nothing is to be built up.
export function buildUpNeeded(dir, slug, id) {
  const read = name => JSON.parse(readFileSync(join(dir, 'src/protos', name, 'meta.ts'), 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  const ref = /^[a-z0-9][a-z0-9-]*\/[A-Z]{1,2}$/
  let meta
  try { meta = read(slug) } catch { return '' }
  if (isCurrent(meta.variants?.[id])) return ''
  const chain = [], seen = new Set([slug])
  for (let at = meta; at && !at.slot && at.next && typeof at.from === 'string' && ref.test(at.from);) {
    const parent = at.from.split('/')[0]
    if (seen.has(parent)) break
    seen.add(parent)
    chain.push(at.from)
    try { at = read(parent) } catch { break }
  }
  if (!chain.length) return ''
  return `build it into ${chain.join(', then ')}: the pick is ${chain[0]}'s next version. Run proto work ${chain[0]} --ask "build in the pick from ${slug}" and make ${chain[0]} draw what ${slug}/${id} draws (rewrite it, or re-export ${slug}/${id} when they are now the same), keeping its name; update its about line. Then each next one the same way, nearest first. Stop before a parent whose prototype explores a different question than this one answers (compare their asks) and say where you stopped. Shoot what changed, then reply --done naming the variants rebuilt`
}
