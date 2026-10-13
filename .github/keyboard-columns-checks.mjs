// The columns by keyboard, in the switcher's dropdown and the sidebar: opened from the keyboard the
// dropdown focuses the lit row; up, down, Home, End and a letter move in a column; left and right
// move between columns (right opening a prototype first) without stepping the variant on screen;
// Enter chooses; Escape gives the focus back to the switcher; the sidebar's pair slides along the
// path; Shift F10 opens a variant's options; and a redraw keeps the focus where it was.
// With before = true only the shots are taken, so the same keys can be shown on a build without it.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function keyboardColumnsChecks({ proto, app, local, openPage, fail, keepShots = '', before = false }) {
  const assert = (ok, why) => { if (!ok) fail(`columns by keyboard: ${why}`) }
  const body = v => `export default function ${v}() { return <main className="p-8"><h1>${v}</h1></main> }`
  const add = (slug, title, names, from) => {
    proto(['add', slug, '--title', title, '--variants', names.map((n, i) => `${String.fromCharCode(65 + i)}:${n}`).join(','), ...(from ? ['--from', from] : [])])
    names.forEach((_, i) => { const v = String.fromCharCode(65 + i); writeFileSync(join(app, `src/protos/${slug}/${v}.tsx`), body(v)) })
  }
  add('keys', 'FINQKEEPER, free ideas', ['Query lens', 'Backtick identifier', 'Rows in the counter', 'The keeper’s key', 'Honeycomb cell', 'Q-can', 'Editor caret'])
  add('keysdeep', 'Q-can, refined', ['Open lid', 'Closed lid'], 'keys/F')
  add('keyslogo', 'FINQKEEPER logo', ['Stacked lenses', 'Isometric platters', 'Growth tails', 'Tilted coins'])
  proto(['done', 'keys', 'keysdeep', 'keyslogo'])
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (f, why) => { for (const end = Date.now() + 5000; Date.now() < end; await wait(50)) { const v = await f(); if (v) return v } fail(`columns by keyboard: ${why}`) }

  const open = async (theme, hash) => {
    const page = await openPage(`${local}?theme=${theme}#/${hash}`)
    await until(() => page.run(`!!document.querySelector('[data-act="open:switch"]') && document.querySelectorAll('[data-side] [data-vlist]').length === 2`), 'the page did not draw its columns')
    const focused = () => page.run('document.activeElement?.dataset?.act ?? document.activeElement?.tagName')
    const switcherOpen = () => page.run(`!!document.querySelector('[data-pop] [data-mcols]')`)
    const openSwitcher = async () => {
      await page.run(`document.querySelector('[data-act="open:switch"]').focus()`)
      await page.key('Enter')
      await until(switcherOpen, 'Enter on the switcher did not open it')
    }
    return { page, focused, switcherOpen, openSwitcher }
  }
  // The dropdown, with the pointer away from it so no row is hovered.
  const shoot = async (page, name) => {
    await page.hover(1400, 880)
    await wait(300)
    await page.screenshot(join(keepShots, `keys-${before ? 'before' : 'after'}-${name}.png`), { x: 300, y: 0, width: 760, height: 470 })
  }

  if (keepShots) {
    for (const theme of ['light', 'dark']) {
      const v = await open(theme, 'keys/F')
      try {
        await v.openSwitcher()
        for (const k of ['ArrowLeft', 'ArrowDown', 'ArrowDown']) await v.page.key(k)
        await shoot(v.page, theme)
      } finally { v.page.close() }
    }
  }
  // The sidebar, after Left on its lit row.
  if (keepShots) {
    const v = await open('light', 'keysdeep/A')
    try {
      await v.page.run(`document.querySelector('[data-side] [data-act="mv:keys:F"]').focus()`)
      await v.page.key('ArrowLeft')
      await v.page.hover(1400, 880)
      await wait(300)
      await v.page.screenshot(join(keepShots, `keys-${before ? 'before' : 'after'}-sidebar.png`), { width: 420, height: 330 })
    } finally { v.page.close() }
  }
  if (before) return

  const { page, focused, switcherOpen, openSwitcher } = await open('light', 'keys/F')
  const hash = () => page.run('location.hash')
  const sideLists = () => page.run(`[...document.querySelectorAll('[data-side] [data-vlist]')].map(e => e.dataset.k).join(' ')`)
  try {
    // Opened from the keyboard, the last column takes the focus (nothing is lit there: its first row).
    await openSwitcher()
    assert(await focused() === 'mv:keysdeep:A', `the dropdown opened with the focus on ${await focused()}`)
    await page.key('ArrowDown')
    assert(await focused() === 'mv:keysdeep:B', 'ArrowDown did not move down the column')
    // The shell's one focus outline (shell.css, --proto-focus): an inset line, not the browser's ring.
    // (1.5px, which a 1x screen draws as 1px.)
    const ring = await page.run(`(() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, s.outlineWidth, s.outlineOffset].join(' ') })()`)
    const [style, width, offset] = ring.split(' ').map((x, i) => i ? parseFloat(x) : x)
    assert(style === 'solid' && width >= 1 && width <= 1.5 && offset === -width, `a focused row has the outline ${ring}, not the shell's`)
    // Left goes to the lit row of the column before, without stepping the variant on screen.
    await page.key('ArrowLeft')
    assert(await focused() === 'mv:keys:F' && await hash() === '#/keys/F', `ArrowLeft went to ${await focused()} at ${await hash()}`)
    await page.key('b')
    assert(await focused() === 'mv:keys:B', 'a letter did not jump to its row')
    await page.key('End')
    assert(await focused() === 'mv:keys:G', 'End did not go to the last row')
    await page.key('Home')
    assert(await focused() === 'mv:keys:A', 'Home did not go to the first row')
    await page.key('ArrowLeft')
    assert(await focused() === 'mp:keys', 'ArrowLeft did not reach the prototypes')
    // Right on a prototype not lit opens it and goes into its variants; the dropdown stays open.
    await page.run(`document.querySelector('[data-pop] [data-act="mp:keyslogo"]').focus()`)
    await page.key('ArrowRight')
    await until(async () => await focused() === 'mv:keyslogo:A', `ArrowRight on a prototype went to ${await focused()}`)
    assert(await hash() === '#/keyslogo' && await switcherOpen(), 'ArrowRight on a prototype did not open it in the dropdown')
    // Enter chooses; a variant with nothing built from it closes the dropdown.
    await page.key('Enter')
    await until(async () => await hash() === '#/keyslogo/A' && !await switcherOpen(), 'Enter did not open the variant')
    // Escape closes the dropdown and gives the focus back to the switcher.
    await openSwitcher()
    await page.key('Escape')
    await until(async () => !await switcherOpen(), 'Escape did not close the dropdown')
    assert(await focused() === 'open:switch', `Escape left the focus on ${await focused()}`)

    // The sidebar: its pair of columns slides along the path, and the variant on screen stays.
    await page.run(`location.hash = '#/keysdeep/A'`)
    await until(async () => await sideLists() === 'v:keys v:keysdeep', `the sidebar showed ${await sideLists()}`)
    await page.run(`document.querySelector('[data-side] [data-act="mv:keys:F"]').focus()`)
    await page.key('ArrowLeft')
    assert(await sideLists() === 'p: v:keys' && await focused() === 'mp:keys', `ArrowLeft past the sidebar's first column showed ${await sideLists()} on ${await focused()}`)
    await page.key('ArrowRight')
    await page.key('ArrowRight')
    assert(await sideLists() === 'v:keys v:keysdeep' && await focused() === 'mv:keysdeep:A', `ArrowRight back showed ${await sideLists()} on ${await focused()}`)
    assert(await hash() === '#/keysdeep/A', `moving along the sidebar opened ${await hash()}`)

    // A redraw (a pick from the command line) keeps the focus on its row.
    proto(['pick', 'keysdeep', 'B'])
    await until(() => page.run(`!!document.querySelector('[data-side] [data-act="mv:keysdeep:B"] [title="Picked"]')`), 'the pick was not drawn')
    assert(await focused() === 'mv:keysdeep:A', `a redraw moved the focus to ${await focused()}`)

    // Shift F10 opens the variant's options, as its ⋯ does.
    await page.key('F10', ['Shift'])
    await until(() => page.run(`document.querySelector('[data-side] [data-act="vm:keysdeep:A"]')?.getAttribute('aria-expanded') === 'true'`), 'Shift F10 did not open the variant\'s options')
  } finally { page.close() }
  // The rest of the run expects nothing picked.
  proto(['pick', 'keysdeep', 'B', '--off'])
  console.log('\nOK: the columns move by keyboard, in the dropdown and the sidebar')
}
