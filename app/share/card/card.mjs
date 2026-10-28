// A share's preview card, the image a chat shows for its link: the title, the cube and who shared
// it, 1200×630, drawn on this Mac when the link is published (the host has no CPU to draw it on
// each visit). Text is Google Sans (the two cut-down files beside this one, Latin and Hebrew, OFL),
// laid out by sharp's Pango; a Hebrew share is drawn mirrored.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 1200, H = 630
const PAD = 80, TOP = 72, BOTTOM = 72
const TEXT_W = 640
const AVATAR = 64
const INK = '#f5f4ff', DIM = '#b7b3e8'
const font = name => fileURLToPath(new URL(`./GoogleSans-${name}.ttf`, import.meta.url))
const REGULAR = { file: font('Regular'), family: 'Google Sans' }
const SEMIBOLD = { file: font('SemiBold'), family: 'Google Sans SemiBold' }

// Pango on macOS asks Core Text for fonts and never sees a font file, so it is switched to
// fontconfig. sharp's fontconfig has no config of its own, and without one it scans every font on
// the machine before its first text (about a minute, in every process): it gets one that lists only
// this folder. Both are read once, at the process's first text, so they are set before it.
function fontconfig() {
  process.env.PANGOCAIRO_BACKEND ||= 'fc'
  if (process.env.FONTCONFIG_FILE) return
  const dir = join(tmpdir(), 'proto-card-fontconfig')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'fonts.conf')
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  writeFileSync(file, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${esc(fileURLToPath(new URL('.', import.meta.url)))}</dir><cachedir>${esc(join(dir, 'cache'))}</cachedir></fontconfig>`)
  process.env.FONTCONFIG_FILE = file
}

const markup = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

// The cube (docs/images/logo-mark.svg), 396.3 × 620 in its own units.
const CUBE = `<g><path d="M441.69 526.76L569.53 600.57L441.69 674.38L313.85 600.57Z" fill="#ffffff"/><path d="M313.85 748.19L441.69 822L441.69 674.38L313.85 600.57Z" fill="#e6e4fc"/><path d="M569.53 748.19L441.69 822L441.69 674.38L569.53 600.57Z" fill="#c9c6f5"/></g>
<g><path d="M441.69 364.38L569.53 438.19L441.69 512L313.85 438.19Z" fill="#ffffff"/><path d="M313.85 585.81L441.69 659.62L441.69 512L313.85 438.19Z" fill="#e6e4fc"/><path d="M569.53 585.81L441.69 659.62L441.69 512L569.53 438.19Z" fill="#c9c6f5"/></g>
<g><path d="M441.69 202L569.53 275.81L441.69 349.62L313.85 275.81Z" fill="#ffffff"/><path d="M313.85 423.43L441.69 497.24L441.69 349.62L313.85 275.81Z" fill="#e6e4fc"/><path d="M569.53 423.43L441.69 497.24L441.69 349.62L569.53 275.81Z" fill="#c9c6f5"/></g>
<g><path d="M582.31 445.57L710.15 519.38L582.31 593.19L454.47 519.38Z" fill="#ffffff"/><path d="M454.47 667L582.31 740.81L582.31 593.19L454.47 519.38Z" fill="#e6e4fc"/><path d="M710.15 667L582.31 740.81L582.31 593.19L710.15 519.38Z" fill="#c9c6f5"/></g>
<g><path d="M582.31 283.19L710.15 357L582.31 430.81L454.47 357Z" fill="#c4c1fc"/><path d="M454.47 504.62L582.31 578.43L582.31 430.81L454.47 357Z" fill="#7f7af4"/><path d="M710.15 504.62L582.31 578.43L582.31 430.81L710.15 357Z" fill="#5a53e3"/></g>`
const CUBE_W = 250, CUBE_H = Math.round(CUBE_W * 620 / 396.3)

// The site's card behind it: the indigo glow rising from the bottom, a little grain, the cube lit.
function background(rtl) {
  const x = rtl ? 120 : W - 120 - CUBE_W, y = 110, s = CUBE_W / 396.3
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs>
  <radialGradient id="bg" gradientUnits="userSpaceOnUse" cx="600" cy="756" r="1440" gradientTransform="translate(600 756) scale(1 0.39375) translate(-600 -756)">
    <stop offset="0" stop-color="#4a43e6"/><stop offset=".32" stop-color="#26208f"/><stop offset=".62" stop-color="#13112e"/><stop offset="1" stop-color="#0d0b16"/>
  </radialGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
  <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
    <feFlood flood-color="#7c74ff" flood-opacity=".55"/><feComposite in2="SourceAlpha" operator="in"/><feGaussianBlur stdDeviation="30"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" filter="url(#grain)" opacity=".05"/>
<g filter="url(#glow)" transform="translate(${x} ${y}) scale(${s}) translate(-313.85 -202)">${CUBE}</g>
</svg>`)
}

const text = (sharp, { words, face, size, color }) => sharp({
  text: {
    text: `<span foreground="${color}"${size >= 48 ? ` letter_spacing="${Math.round(-0.02 * size * 1024)}"` : ''}>${words}</span>`,
    font: `${face.family}, ${size}`, fontfile: face.file, dpi: 72, rgba: true,
  },
}).png().toBuffer({ resolveWithObject: true })

// The title in at most three lines, as large as fits (76, then 66, then 58), cut with … past that.
// The lines are broken here, word by word against a measured width, and each is drawn on its own:
// Pango, laying out several Hebrew lines, moves the ones without a comma by a space's width.
const LINES = 3, SIZES = [76, 66, 58]
async function title(sharp, words) {
  const draw = async (lines, size) => ({ size, lines: await Promise.all(lines.map(l => text(sharp, { words: markup(l), face: SEMIBOLD, size, color: INK }))) })
  const wide = async (line, size) => (await text(sharp, { words: markup(line), face: SEMIBOLD, size, color: INK })).info.width
  const all = words.trim().split(/\s+/)
  for (const size of SIZES) {
    const lines = []
    for (const word of all) {
      const next = lines.length ? `${lines.at(-1)} ${word}` : word
      if (lines.length && await wide(next, size) <= TEXT_W) lines[lines.length - 1] = next
      else lines.push(word)
      if (lines.length > LINES) break
    }
    if (lines.length <= LINES && (await Promise.all(lines.map(l => wide(l, size)))).every(w => w <= TEXT_W)) return draw(lines, size)
    if (size !== SIZES.at(-1)) continue
    // The smallest size still doesn't fit: the first three lines, the last cut to end in …
    const kept = lines.slice(0, LINES)
    let last = kept[LINES - 1] ?? kept.at(-1)
    while (last && await wide(`${last}…`, size) > TEXT_W) last = last.includes(' ') ? last.slice(0, last.lastIndexOf(' ')) : last.slice(0, -1)
    kept[kept.length - 1] = `${last}…`
    return draw(kept, size)
  }
}

// The owner's GitHub picture in a ring, or their initial when there is none to fetch.
async function avatar(sharp, owner, fetch) {
  const ring = `<circle cx="${AVATAR / 2}" cy="${AVATAR / 2}" r="${AVATAR / 2 - 1}" fill="none" stroke="#ffffff" stroke-opacity=".14" stroke-width="2"/>`
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR}" height="${AVATAR}"><circle cx="${AVATAR / 2}" cy="${AVATAR / 2}" r="${AVATAR / 2}"/></svg>`)
  if (owner.avatar) {
    try {
      const url = new URL(owner.avatar)
      if (url.hostname.endsWith('githubusercontent.com')) url.searchParams.set('s', String(AVATAR * 2))
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const round = await sharp(Buffer.from(await res.arrayBuffer())).resize(AVATAR, AVATAR, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
        return sharp(round).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR}" height="${AVATAR}">${ring}</svg>`) }]).png().toBuffer()
      }
    } catch { /* the initial below */ }
  }
  const letter = markup([...(owner.name || owner.login || '?').trim()][0]?.toUpperCase() || '?')
  const disc = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR}" height="${AVATAR}"><circle cx="${AVATAR / 2}" cy="${AVATAR / 2}" r="${AVATAR / 2}" fill="#5a53e3"/>${ring}</svg>`)).png().toBuffer()
  const t = await text(sharp, { words: letter, face: SEMIBOLD, size: 30, color: INK })
  return sharp(disc).composite([{ input: t.data, left: Math.round((AVATAR - t.info.width) / 2), top: Math.round((AVATAR - t.info.height) / 2) }]).png().toBuffer()
}

/**
 * The card as a JPEG. title: the share's title. owner: { login, name, avatar } from the host (any
 * may be missing). lang: 'he' mirrors it. sharp: the share tools' sharp. Throws when sharp can't
 * draw it; the caller then publishes without a card of its own.
 */
export async function cardImage({ title: words, owner = {}, lang, sharp, fetch = globalThis.fetch }) {
  fontconfig()
  const rtl = lang === 'he'
  const name = owner.name || owner.login || ''
  // Their name, and under it @login when the name isn't the login already. The handle is isolated,
  // so "@login" keeps its order in a Hebrew card.
  const handle = owner.name && owner.login && owner.name !== owner.login ? `⁦@${markup(owner.login)}⁩` : ''

  const face = await avatar(sharp, owner, fetch)
  const who = name ? await text(sharp, { words: markup(name), face: SEMIBOLD, size: 30, color: INK }) : null
  const what = handle ? await text(sharp, { words: handle, face: REGULAR, size: 24, color: DIM }) : null
  const rowTop = H - BOTTOM - AVATAR
  const t = await title(sharp, words || 'Prototype')

  const x = (left, width) => rtl ? W - left - width : left
  const textLeft = PAD + AVATAR + 18
  const GAP = 6
  const lines = (who ? who.info.height : 0) + (who && what ? GAP : 0) + (what ? what.info.height : 0)
  const linesTop = rowTop + Math.round((AVATAR - lines) / 2)
  // The title's lines 1.08 of its size apart, centred in the space above the owner's row.
  const pitch = Math.round(t.size * 1.08)
  const block = pitch * (t.lines.length - 1) + t.lines.at(-1).info.height
  const titleTop = TOP + Math.round((rowTop - 40 - TOP - block) / 2)
  const layers = [
    ...t.lines.map((l, i) => ({ input: l.data, left: x(PAD, l.info.width), top: titleTop + i * pitch })),
    { input: face, left: x(PAD, AVATAR), top: rowTop },
    ...(who ? [{ input: who.data, left: x(textLeft, who.info.width), top: linesTop }] : []),
    ...(what ? [{ input: what.data, left: x(textLeft, what.info.width), top: linesTop + (who ? who.info.height + GAP : 0) }] : []),
  ]
  return sharp(background(rtl)).composite(layers).jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer()
}
