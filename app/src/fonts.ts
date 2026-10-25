// Google Fonts for a variant, without an install (an install reloads the page). Pass each family
// the way the css2 API spells it, as `proto fonts` prints it:
//   font('Karantina:wght@300;400;700', 'Assistant:wght@200..800')
// Call it at the top of the variant's module. A family already added is not added again; the
// page waits for fonts before it counts as ready, so `proto shoot` sees them.
const added = new Set<string>()

export function font(...families: string[]) {
  const want = families.filter(f => f && !added.has(f))
  if (!want.length) return
  for (const f of want) added.add(f)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  // CORS lets screenshots (modern-screenshot) read the @font-face rules; Google serves them with ACAO: *.
  link.crossOrigin = 'anonymous'
  link.href = `https://fonts.googleapis.com/css2?${want.map(f => `family=${f.trim().replace(/ /g, '+')}`).join('&')}&display=swap`
  document.head.append(link)
}
