// A share build's output folder as the one HTML file a share is: Vite writes index.html, one
// script and one stylesheet (images are data URLs already, see plugin.mjs), and the two are put
// inside the page. Anything else in the folder would be a file the page asks for and the host
// doesn't have, so it stops the share instead of going out broken.
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ShareError } from './scope.mjs'

/** Every file under dir, as forward-slash paths relative to it. */
export function filesOf(dir) {
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [relative(dir, join(d, e.name)).replaceAll('\\', '/')])
  return walk(dir)
}

export function inlineHtml(outDir) {
  const files = filesOf(outDir)
  const used = new Set(['index.html'])
  const read = url => {
    const file = url.replace(/^(?:\.\/|\/)/, '')
    if (!files.includes(file)) throw new ShareError(`The share build's page asks for ${url}, which the build did not write`)
    used.add(file)
    return readFileSync(join(outDir, file), 'utf8')
  }
  let html = readFileSync(join(outDir, 'index.html'), 'utf8')
  const scripts = html.match(/<script\b[^>]*\bsrc=[^>]*><\/script>/g) ?? []
  const sheets = html.match(/<link\b[^>]*\brel=["']?stylesheet\b[^>]*>/g) ?? []
  if (scripts.length !== 1 || sheets.length > 1) throw new ShareError(`The share build's page has ${scripts.length} scripts and ${sheets.length} stylesheets; one of each was expected`)
  const src = tag => tag.match(/\b(?:src|href)=["']?([^"'\s>]+)/)[1]
  // `</script` or `</style` inside the code would end the element early; `<\/` means the same in
  // a JS string, regex or template, and a CSS escape keeps it in a stylesheet. Replaced through
  // functions, since the code is full of `$&`-like text a replacement string would expand.
  const js = read(src(scripts[0])).replace(/<\/(script)/gi, '<\\/$1')
  html = html.replace(scripts[0], () => `<script type="module">${js}</script>`)
  if (sheets.length) {
    const css = read(src(sheets[0])).replace(/<\/(style)/gi, '<\\/$1')
    html = html.replace(sheets[0], () => `<style>${css}</style>`)
  }
  const left = files.filter(f => !used.has(f))
  if (left.length) throw new ShareError(`The share build wrote files that can't go in one page: ${left.join(', ')}`)
  return html
}
