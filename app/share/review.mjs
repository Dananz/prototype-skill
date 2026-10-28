// The pre-publish review: runs over the built share HTML and says what must not go out (block)
// and what the owner should know first (warn). Pure, so the unit checks need no browser.
const MiB = 2 ** 20

// A JWT segment is base64url, so the same alphabet as the body of a data URL plus `-_`. The
// lookbehind keeps a match from starting in the middle of a base64 run (an image's bytes contain
// `eyJ` now and then; its `=` padding only ends a payload, so `token=eyJ…` still matches), and the two literal dots can never occur inside one data URL's payload.
const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /(?<![A-Za-z0-9+/_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bBearer [A-Za-z0-9._-]{20,}/g,
  /\bdp\.(?:st|sa|ct|pt)\.[A-Za-z0-9]{20,}/g,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g,
  /\bsb_secret_[A-Za-z0-9_-]{20,}/g,
]
// The only outside hosts a share link lets a page load from (the host's CSP, host/lib/pages.mjs SHARE_CSP).
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])
const PRIVATE_HOST = /^(?:localhost|127\.0\.0\.1|.+\.ts\.net|10\..+|192\.168\..+|172\.(?:1[6-9]|2\d|3[01])\..+)$/
const URL_RE = /\bhttps?:\/\/([^\s/"'<>()\\?#:]+)(?::\d+)?[^\s"'<>()\\]*/g
// Where a URL is loaded rather than merely written down: an attribute (or, in the compiled
// JSX, a prop) that fetches, CSS url() and @import, and the string handed to fetch() or import().
// A library's bundled text is full of URLs that are only words (React's error links, the SVG
// namespace); counting every https:// would warn on every share.
const QUOTED = `(["'\`])(https?:\\/\\/[^"'\`\\s<>]+)`
const LOADING = [
  new RegExp(`\\b(?:src|href|poster)\\s*[=:]\\s*${QUOTED}`, 'gi'),
  /\b(?:src|href|poster)=(https?:\/\/[^\s"'<>`]+)/gi,
  new RegExp(`\\bsrcset\\s*[=:]\\s*(["'\`])([^"'\`]*)\\1`, 'gi'),
  /\burl\(\s*["']?(https?:\/\/[^\s"')]+)/gi,
  new RegExp(`@import\\s+${QUOTED}`, 'gi'),
  new RegExp(`\\b(?:fetch|import)\\(\\s*${QUOTED}`, 'g'),
]
// Every loading URL in the page (srcset lists several).
const loadedUrls = html => LOADING.flatMap(re => [...html.matchAll(re)].flatMap(m => [...(m[2] ?? m[1]).matchAll(URL_RE)]))
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

  // `Bearer eyJ…` matches two rules for one token, so the ranges are merged and each is reported once.
  const hits = SECRETS.flatMap(re => [...html.matchAll(re)]).sort((a, b) => a.index - b.index)
  let end = -1
  for (const m of hits) {
    if (m.index < end) continue
    end = m.index + m[0].length
    block.push({ code: 'secret', message: 'The share contains what looks like a secret (key or token). Remove it from the prototype and share again.', where: maskedAround(html, m) })
  }

  // A project under the home folder is one cause, not two: home only counts for what is outside it.
  const forms = dir => [dir, dir.replaceAll('/', '\\'), dir.replaceAll('/', '\\\\')]
  const hasPath = (text, dir) => forms(dir).some(f => text.includes(f))
  const inProject = projectPath && hasPath(html, projectPath)
  if (inProject) block.push({ code: 'abs-path', message: `The share contains your project folder path (${projectPath}), which would show your machine's layout. Remove it from the prototype and share again.`, where: projectPath })
  if (home) {
    const rest = inProject && projectPath.startsWith(home) ? forms(projectPath).reduce((t, f) => t.replaceAll(f, ''), html) : html
    if (hasPath(rest, home)) block.push({ code: 'abs-path', message: `The share contains your home folder path (${home}), which would show your machine's layout. Remove it from the prototype and share again.`, where: home })
  }
  if (projectImports.length) {
    const names = projectImports.map(p => p.split(/[\\/]/).pop())
    warn.push({ code: 'project-code', message: `The share includes code copied from your project (${names.join(', ')}). Anyone with the link can read it.` })
  }
  if (currents.length) warn.push({ code: 'real-screens', message: `The share includes real screens of your product (${currents.join(', ')}). Anyone with the link will see them.` })

  const origins = new Set()
  const privates = new Map()
  for (const m of loadedUrls(html)) {
    const host = m[1].toLowerCase()
    const origin = m[0].match(/^https?:\/\/[^\s/"'<>()\\?#]+/)[0]
    if (PRIVATE_HOST.test(host)) privates.set(origin, (privates.get(origin) ?? 0) + 1)
    else if (!FONT_HOSTS.has(host)) origins.add(origin)
  }
  for (const origin of origins) warn.push({ code: 'outside-url', message: `The share loads something from ${origin}, and the share link won't load it: remote images, scripts and API calls are blocked there (Google Fonts still load). Inline it, or leave it out.`, where: origin })
  for (const [origin, n] of privates) warn.push({ code: 'private-url', message: `The share points at ${origin} (${n} ${n === 1 ? 'time' : 'times'}), an address only your machine or network can open. Viewers will see it broken.`, where: origin })
  for (const path of new Set([...html.matchAll(ABS_PATH_RE)].map(m => m[1] ?? m[2]))) {
    warn.push({ code: 'private-url', message: `The share loads ${path} by absolute path, which will not exist at the share link. Inline it or use a relative path.`, where: path })
  }

  return { block, warn }
}
