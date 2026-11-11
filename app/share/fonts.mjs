// Fontsource ships one face per Unicode subset. A self-contained share embeds all
// of them unless unused scripts are removed. Keep whole faces, never trim glyphs;
// other fonts and unrecognized declarations remain untouched.
export function pruneShellFonts(css, text) {
  const decoded = text.replace(/\\u(?:\{([\da-f]{1,6})\}|([\da-f]{4}))/gi, (all, wide, short) => {
    const value = parseInt(wide || short, 16)
    return value <= 0x10ffff ? (wide ? String.fromCodePoint(value) : String.fromCharCode(value)) : all
  }).replace(/\\([\da-f]{1,6})(?:\r\n|[ \t\r\n\f])?/gi, (all, hex) => {
    const value = parseInt(hex, 16)
    return value <= 0x10ffff ? String.fromCodePoint(value) : all
  })
  const points = new Set([0x41, ...[...decoded].map(c => c.codePointAt(0))])
  return css.replace(/@font-face\s*\{[^{}]*\}/gi, face => {
    if (!/font-family\s*:\s*(['"]?)Google Sans Variable\1\s*[;}]/i.test(face)) return face
    const ranges = face.match(/unicode-range\s*:\s*([^;}]+)/i)?.[1]
    if (!ranges) return face
    const needed = ranges.split(',').some(range => {
      const m = range.trim().match(/^U\+([\da-f?]{1,6})(?:-([\da-f]{1,6}))?$/i)
      if (!m) return true
      const start = parseInt(m[1].replaceAll('?', '0'), 16)
      const end = parseInt(m[2] || m[1].replaceAll('?', 'f'), 16)
      if (start > end || end > 0x10ffff) return true
      return [...points].some(point => point >= start && point <= end)
    })
    return needed ? face : ''
  })
}
