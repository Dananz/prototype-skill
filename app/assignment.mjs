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
  const repair = reason => `assignment pending in ${meta.from}: ${reason}. Use the user's request and this prototype's ask to determine whether it replaces a component or is a separate study. For a component replacement, connect the intended element with <Slot> and proto add ${slug} --from ${refs} --slot <id>, preserve the variant's props and behavior, then run proto pick ${slug} ${id} and verify it in ${meta.from}. For an intentionally separate design, record proto add ${slug} --reference-only instead. Handle any note, then reply --done`
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
  return ''
}
