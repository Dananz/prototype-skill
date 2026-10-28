// The upload's look for a page that asks for a password or a card number: a link that does is
// flagged for the maintainer (an automatic row in reports, proto share admin reports), never refused.
// A login screen is a common prototype, so a flag is a prompt to look, not a verdict.
import { room } from './budget.mjs'

// A built share is one module script, so a React login screen holds `type:"password"`, not
// `<input type=password>`: both forms count, in any case and quoting.
const CREDENTIAL = /\btype\s*[:=]\s*\\?["'`]?password\b|\bautocomplete\s*[:=]\s*\\?["'`]?(?:current-password|cc-number)\b/i
// Inflating costs about 3 ms of CPU per MB, and the Free plan gives an invocation 10 ms: only the
// page's first 2 MiB are read. Pictures are inlined as data URLs, so a heavy page may hide its form
// past that.
export const SCAN_BYTES = 2 * 1024 * 1024
const TAIL = 64

/** Whether the gzipped page's first SCAN_BYTES ask for a credential. */
export async function asksCredentials(gz) {
  const reader = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream()).getReader()
  let read = 0, tail = ''
  try {
    while (read < SCAN_BYTES) {
      const { value, done } = await reader.read()
      if (done) return false
      const text = tail + value.slice(0, SCAN_BYTES - read)
      if (CREDENTIAL.test(text)) return true
      read += value.length
      tail = text.slice(-TAIL)
    }
    return false
  } finally {
    reader.cancel().catch(() => {})
  }
}

/**
 * After an upload has landed: one automatic report per share version when the page asks for a
 * credential, while today's D1 writes last. Never throws: the upload has already succeeded.
 */
export async function flagged(env, id, version, gz) {
  try {
    if (!await asksCredentials(gz)) return false
    if (!await room(env.DB, 'd1_write')) return false
    await env.DB.prepare("INSERT INTO reports (id, share_id, reason, gh_id, created_at, source) VALUES (?, ?, ?, NULL, ?, 'auto') ON CONFLICT(id) DO NOTHING")
      .bind(`auto:${id}:${version}`, id, `Version ${version} has a password or card number field.`, Date.now()).run()
    return true
  } catch (e) {
    console.error(e)
    return false
  }
}
