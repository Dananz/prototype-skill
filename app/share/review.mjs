// The pre-publish review: runs over the built share HTML and says what must not go out (block)
// and what the owner should know first (warn). Pure, so the unit checks need no browser.
const MiB = 2 ** 20

// A JWT segment is base64url, so the same alphabet as the body of a data URL plus `-_`. The
// lookbehind keeps a match from starting in the middle of a base64 run (an image's bytes contain
// `eyJ` now and then), and the two literal dots can never occur inside one data URL's payload.
const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /(?<![A-Za-z0-9+/=_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bBearer [A-Za-z0-9._-]{20,}/g,
  /\bdp\.(?:st|sa|ct|pt)\.[A-Za-z0-9]{20,}/g,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g,
  /\bsb_secret_[A-Za-z0-9_-]{20,}/g,
]
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])
const PRIVATE_HOST = /^(?:localhost|127\.0\.0\.1|.+\.ts\.net|10\..+|192\.168\..+|172\.(?:1[6-9]|2\d|3[01])\..+)$/
const URL_RE = /\bhttps?:\/\/([^\s/"'<>()\\?#:]+)(?::\d+)?[^\s"'<>()\\]*/g
const ABS_PATH_RE = /\bsrc=["']?(\/(?!\/)[^\s"'>]*)|\burl\(\s*["']?(\/(?!\/)[^\s"')]*)/g

// About 40 characters around a match, the secret itself cut to its first four so the user can
// find it without the full value landing in the terminal.
const maskedAround = (html, m) => {
  const before = html.slice(Math.max(0, m.index - 20), m.index)
  const after = html.slice(m.index + m[0].length, m.index + m[0].length + 20)
  return `${before}${m[0].slice(0, 4)}…${after}`.replace(/\s+/g, ' ')
}

export function review({ html, gzBytes, projectPath, home, projectImports, currents }) {
  const block = []
  const warn = []

  if (gzBytes > 20 * MiB) block.push({ code: 'too-big', message: `This share is ${(gzBytes / MiB).toFixed(1)} MiB gzipped, over the 20 MiB limit. Share fewer variants or use smaller images.` })
  else if (gzBytes > 5 * MiB) warn.push({ code: 'heavy', message: `This share is ${(gzBytes / MiB).toFixed(1)} MiB gzipped, so it will open slowly on a phone. Fewer variants or smaller images would help.` })

  for (const re of SECRETS) {
    for (const m of html.matchAll(re)) {
      block.push({ code: 'secret', message: 'The share contains what looks like a secret (key or token). Remove it from the prototype and share again.', where: maskedAround(html, m) })
    }
  }

  for (const [label, dir] of [['project folder', projectPath], ['home folder', home]]) {
    if (!dir) continue
    const forms = [dir, dir.replaceAll('/', '\\'), dir.replaceAll('/', '\\\\')]
    if (forms.some(f => html.includes(f))) block.push({ code: 'abs-path', message: `The share contains your ${label} path (${dir}), which would show your machine's layout. Remove it from the prototype and share again.`, where: dir })
  }

  if (projectImports.length) {
    const names = projectImports.map(p => p.split(/[\\/]/).pop())
    warn.push({ code: 'project-code', message: `The share includes code copied from your project (${names.join(', ')}). Anyone with the link can read it.` })
  }
  if (currents.length) warn.push({ code: 'real-screens', message: `The share includes real screens of your product (${currents.join(', ')}). Anyone with the link will see them.` })

  const origins = new Set()
  const privates = new Set()
  for (const m of html.matchAll(URL_RE)) {
    const host = m[1].toLowerCase()
    if (PRIVATE_HOST.test(host)) privates.add(m[0])
    if (!FONT_HOSTS.has(host)) origins.add(m[0].match(/^https?:\/\/[^\s/"'<>()\\?#]+/)[0])
  }
  for (const origin of origins) warn.push({ code: 'outside-url', message: `The share loads something from ${origin}. It will only work while that address is up and reachable by viewers.`, where: origin })
  for (const url of privates) warn.push({ code: 'private-url', message: `The share points at ${url}, an address only your machine or network can open. Viewers will see it broken.`, where: url })
  for (const path of new Set([...html.matchAll(ABS_PATH_RE)].map(m => m[1] ?? m[2]))) {
    warn.push({ code: 'private-url', message: `The share loads ${path} by absolute path, which will not exist at the share link. Inline it or use a relative path.`, where: path })
  }

  return { block, warn }
}
