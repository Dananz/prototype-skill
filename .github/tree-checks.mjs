// The project tree sidebar (app/shell/tree/): behind its switch (?tree=1, Settings), designs ›
// flows › screens with their options and the explorations built on them, its filters, the page's
// scope behind Conversation first (?conv=1: this conversation, the whole project, favorites), the
// place on screen lit, and a design changed on disk drawn without a reload.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function treeChecks({ proto, app, local, openPage, fail }) {
  const assert = (ok, why) => { if (!ok) fail(`tree: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why) => {
    for (const end = Date.now() + 6000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`tree: ${why} (timed out: ${expression})`)
  }
  const metaFile = slug => join(app, 'src', 'protos', slug, 'meta.ts')
  const editMeta = (slug, fn) => { const text = readFileSync(metaFile(slug), 'utf8'), m = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')); writeFileSync(metaFile(slug), `export default ${JSON.stringify(fn(m), null, 2)}\n`) }
  const design = screens => { mkdirSync(join(app, 'src', 'designs', 'acme'), { recursive: true }); writeFileSync(join(app, 'src', 'designs', 'acme', 'design.ts'), `export default ${JSON.stringify({ title: 'Acme', created: '2026-10-30T10:00:00Z', from: 'thome/C', flows: [{ name: 'Main', screens }] })}\n`) }

  proto(['add', 'thome', '--title', 'Home', '--variants', 'A:One,B:Two,C:Three'])
  proto(['add', 'tabout', '--title', 'About', '--variants', 'A:One,B:Two'])
  proto(['add', 'thero-cta', '--title', 'Hero CTA', '--from', 'thome/C', '--variants', 'A:One,B:Two'])
  proto(['add', 'tcta-copy', '--title', 'CTA copy', '--from', 'thero-cta/B', '--variants', 'A:One,B:Two'])
  proto(['add', 'tlogo', '--title', 'Logo', '--variants', 'A:One,B:Two'])
  proto(['add', 'tpricing', '--title', 'Pricing', '--variants', 'A:One'])
  proto(['done', 'thome']); proto(['done', 'tabout']); proto(['done', 'thero-cta']); proto(['done', 'tcta-copy']); proto(['done', 'tlogo']); proto(['done', 'tpricing'])
  proto(['pick', 'thome', 'C']); proto(['pick', 'thero-cta', 'A']); proto(['pick', 'tlogo', 'B']); proto(['pick', 'tpricing', 'A'])
  // Made in another conversation: This conversation leaves it out.
  editMeta('tlogo', m => ({ ...m, session: 'other', owner: 'other' }))
  design(['thome', 'tabout'])

  let page = await openPage(`${local}thome/C?tree=0`)
  try {
    await until(page, `!!document.querySelector('[data-side] *')`, 'with ?tree=0 the old sidebar should be drawn')
    assert(await page.run(`document.querySelector('[data-tree-side]').hidden`), 'with ?tree=0 the tree should be hidden')
  } finally { page.close() }

  // A browser that never chose (a fresh profile; every new project's app is a new origin) gets the tree.
  page = await openPage(`${local}thome/C`, { classic: false })
  try {
    await until(page, `!!document.querySelector('[data-tree-row="screen:thome"]')`, 'with nothing chosen in this browser the tree should be the default')
    assert(await page.run(`document.querySelector('[data-tree-side]').hidden === false && !document.querySelector('[data-side] *')`), 'with nothing chosen the old sidebar should not be drawn')
    // Conversation first is the default: the scope row, not the tree's own filters.
    assert(await page.run(`!!document.querySelector('[data-tree-scope]') && !document.querySelector('[data-tree-filters]')`), 'with nothing chosen Conversation first should be on')
  } finally { page.close() }

  // Off (?conv=0, kept in this browser), the tree keeps its own filters and no scope row.
  page = await openPage(`${local}thome/C?tree=1&conv=0`, { classic: false })
  try {
    await until(page, `!!document.querySelector('[data-tree-filters] [data-tree-filter="open"]') && !document.querySelector('[data-tree-scope]')`, 'with Conversation first off the tree should keep its filters')
    assert(await page.run(`localStorage.getItem('proto-conv') === '0'`), '?conv=0 should be kept in this browser')
  } finally { page.close() }

  page = await openPage(`${local}tcta-copy/A?tree=1&conv=1`)
  try {
    await until(page, `!!document.querySelector('[data-tree-row="design:acme"]')`, 'the tree should draw the design')
    assert(await page.run(`!document.querySelector('[data-tree-side]').hidden && !document.querySelector('[data-side] *')`), 'with ?tree=1 the tree replaces the old sidebar')
    // On the desk it is a card like the old sidebar, not the dotted desk showing through.
    assert(await page.run(`(() => { const s = getComputedStyle(document.querySelector('[data-tree-side]')); return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundImage === 'none' && parseFloat(s.borderTopLeftRadius) > 0 })()`), 'the tree should sit on the desk as a card')
    assert(await page.run(`localStorage.getItem('proto-tree') === '1'`), '?tree=1 should be kept in this browser')
    assert(await page.run(`!!document.querySelector('[data-tree-row="screen:thome"]')`), 'thome should be a screen row')
    assert(await page.run(`/not picked/.test(document.querySelector('[data-tree-row="screen:tabout"]')?.textContent ?? '')`), 'tabout should say it is not picked')
    await until(page, `!!document.querySelector('[data-tree-row="exp:tcta-copy"] [data-mark="stale"]')`, 'the place on screen opens its ancestors, and tcta-copy is stale')
    assert(await page.run(`/became Acme/.test(document.querySelector('[data-tree-row="opt:thome/C"]')?.textContent ?? '')`), 'thome #3 should say it became Acme')
    // The page opens on this conversation: tlogo, made in another, is left out until the whole project.
    // The full smoke shares the app with other checks' prototypes, so the count is only checked to be there.
    assert(await page.run(`document.querySelector('[data-tree-filter="conv"]')?.getAttribute('aria-checked') === 'true'`), 'the scope should start on this conversation')
    assert(await page.run(`!document.querySelector('[data-tree-row="exp:tlogo"]')`), 'this conversation should leave out tlogo')
    assert(await page.run(`/· \\d+$/.test(document.querySelector('[data-tree-filter="all"]').textContent.trim())`), 'Whole project should carry a count')
    await page.run(`document.querySelector('[data-tree-filter="all"]').click()`)
    await until(page, `!!document.querySelector('[data-tree-row="exp:tlogo"]') && localStorage.getItem([...Object.keys(localStorage)].find(k => k.startsWith('proto-scope:')) ?? '') === 'all'`, 'Whole project should bring tlogo in and be kept')

    await page.run(`document.querySelector('[data-tree-row="screen:tabout"] button:not([aria-expanded])').click()`)
    await until(page, `location.pathname === '/tabout/A'`, 'a screen row should open its shown variant')
    await page.run(`history.pushState(null, '', '/thero-cta/B'); dispatchEvent(new PopStateEvent('popstate'))`)
    await until(page, `document.querySelector('[data-tree-row="opt:thero-cta/B"]')?.dataset.on === 'true'`, 'arriving at thero-cta/B should light its row')

    await page.run(`document.querySelector('[data-tree-filter="conv"]').click()`)
    await until(page, `!document.querySelector('[data-tree-row="exp:tlogo"]') && !!document.querySelector('[data-tree-row="screen:thome"]')`, 'This conversation should leave out tlogo')
    await page.run(`document.querySelector('[data-tree-filter="all"]').click()`)
    // Favorites: the star filter keeps what has a starred option; a star given now redraws the tree.
    await page.run(`document.querySelector('[data-tree-filter="favs"]').click()`)
    await until(page, `!document.querySelector('[data-tree-row="screen:thome"]')`, 'Favorites with no star should leave thome out')
    proto(['fav', 'tlogo/2'])
    await until(page, `!!document.querySelector('[data-tree-row="opt:tlogo/B"]') && !document.querySelector('[data-tree-row="opt:tlogo/A"]')`, 'a star given on disk should bring its option into Favorites, alone')
    await page.run(`document.querySelector('[data-tree-filter="all"]').click()`)
    proto(['fav', 'tlogo/2', '--off'])
    // The project's name opens Settings on Session, its mark carries the live dot.
    assert(await page.run(`document.querySelector('[data-tree-live]')?.dataset.treeLive === 'on'`), 'the mark should carry a live dot')
    await page.run(`document.querySelector('[data-tree-session]').click()`)
    await until(page, `document.querySelector('[data-settings-category=session]')?.getAttribute('aria-current') === 'page'`, 'the project name should open Settings on Session')
    await page.run(`document.querySelector('[data-settings-category=shortcuts]').click()`)
    await until(page, `/Gallery\\s*M/.test(document.querySelector('[data-settings-dialog]')?.textContent ?? '') && /Jump to a screen/.test(document.querySelector('[data-settings-dialog]').textContent)`, 'Shortcuts should list M and Jump with the tree on')
    await page.run(`document.querySelector('[data-settings-close]').click()`)
    await until(page, `!document.querySelector('[data-settings-dialog]')`, 'Settings should close')

    // A design changed on disk (another conversation's screen) is drawn without a reload.
    await page.run(`window.__treeMark = 1`)
    design(['thome', 'tabout', 'tpricing'])
    await until(page, `!!document.querySelector('[data-tree-row="screen:tpricing"]')`, 'a screen added to design.ts should appear')
    assert(await page.run(`window.__treeMark === 1`), 'the page reloaded instead of taking the new design')

    // Kept across a load without the parameter, and Settings turns it off.
    await page.run(`location.assign('/thome/C')`)
    await wait(500)
    await until(page, `!window.__treeMark && !!document.querySelector('[data-tree-row="design:acme"]')`, 'the switch should survive a load without ?tree')
    // A design's row: its name goes to its first screen's page, that card open in the gallery (leaving Focus), its caret folds it.
    await page.run(`document.querySelector('[data-tree-row="design:acme"] button[aria-expanded]').click()`)
    await until(page, `!document.querySelector('[data-tree-row="screen:thome"]')`, 'the caret should fold the design')
    assert(await page.run(`location.pathname === '/thome/C'`), 'folding a design should not move the page')
    await page.run(`document.querySelector('[data-tree-row="design:acme"] button[aria-expanded]').click()`)
    await until(page, `!!document.querySelector('[data-tree-row="screen:thome"]')`, 'the caret should open the design again')
    await page.run(`document.querySelector('[data-tree-row="design:acme"] button:not([aria-expanded])').click()`)
    await until(page, `location.pathname === '/thome' && !document.querySelector('[data-gallery-host]').hidden`, 'the design\'s name should leave the screen for its first screen\'s page')
    await until(page, `!!document.querySelector('[data-gallery-options="thome"]')`, 'the design\'s name should open its first screen\'s card')
    await until(page, `!!document.querySelector('[data-gallery-card="thome"] img[data-gallery-still]')`, 'a card should show a still of its page')
    assert(await page.run(`!document.querySelector('[data-map], [data-map-view], [data-map-host]')`), 'nothing of the map should be left')
    // An exploration's row: its name opens its card in the gallery, with all its options; its pick's mark opens the pick.
    await until(page, `!!document.querySelector('[data-tree-row="exp:tlogo"]')`, 'the picked exploration tlogo should be in the tree')
    await page.run(`document.querySelector('[data-tree-row="exp:tlogo"] button:not([aria-expanded]):not([data-act]):not([data-tree-picked])').click()`)
    await until(page, `location.pathname === '/tlogo' && !!document.querySelector('[data-gallery-options="tlogo"] [data-gallery-option="tlogo/B"]')`, 'the exploration\'s name should go to its own page, its options open in the gallery')
    await until(page, `document.querySelector('[data-tree-row="exp:tlogo"]')?.dataset.on === 'true'`, 'the exploration\'s row should be lit on its page')
    // A card chosen in the gallery has an address, and Back shuts it; chosen again, it shuts too.
    await page.run(`document.querySelector('[data-gallery-card="thome"]').click()`)
    await until(page, `location.pathname === '/thome' && !!document.querySelector('[data-gallery-options="thome"]')`, 'a card chosen in the gallery should move the address to it')
    await page.run(`history.back()`)
    await until(page, `location.pathname === '/tlogo' && !!document.querySelector('[data-gallery-options="tlogo"]')`, 'Back should go to the card open before')
    await page.run(`document.querySelector('[data-gallery-card="tlogo"]').click()`)
    await until(page, `location.pathname === '/' && !document.querySelector('[data-gallery-card][aria-expanded="true"]')`, 'the open card chosen again should shut, back at the gallery')
    await page.run(`document.querySelector('[data-gallery-card="tlogo"]').click()`)
    await until(page, `location.pathname === '/tlogo'`, 'the card should open again')
    // Its page takes a comment on the whole prototype: no variant, no element, the route is the slug.
    assert(await page.run(`!document.querySelector('[data-layers] [data-mount]')`), 'nothing should run in a lobby under the gallery')
    await until(page, `document.querySelector('[data-shoot="whole-input"]')?.getBoundingClientRect().width > 100 && !document.querySelector('[data-island] [data-shoot="comment"]')`, 'the page of a prototype should offer the whole-prototype box, with no element picker')
    await page.run(`(() => { const b = document.querySelector('[data-shoot="whole-input"]'); b.textContent = 'The whole set feels too loud'; b.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await until(page, `!!document.querySelector('[data-shoot="whole-add"]')`, 'typing should offer a way to add it')
    await page.run(`document.querySelector('[data-shoot="whole-add"]').click()`)
    await until(page, `!!document.querySelector('[data-shoot="send"]')`, 'the draft should offer Send')
    await until(page, `Object.keys(localStorage).flatMap(k => { try { return JSON.parse(localStorage.getItem(k))?.items ?? [] } catch { return [] } }).some(i => i.proto === 'tlogo' && !i.variant && !i.target)`, 'the comment should be on the prototype, with no variant and no element')
    await page.run(`document.querySelector('[data-shoot="send"]').click()`)
    await until(page, `Object.keys(localStorage).flatMap(k => { try { return JSON.parse(localStorage.getItem(k))?.items ?? [] } catch { return [] } }).some(i => i.proto === 'tlogo' && !i.variant && i.sent)`, 'the comment should be sent')
    const whole = proto(['inbox'], { stdout: true }) ?? ''
    assert(/on: the whole prototype/.test(whole) && /\btlogo\b/.test(whole), `proto inbox should say it is on the whole prototype: ${whole}`)
    await page.run(`document.querySelector('[data-tree-row="opt:tlogo/B"] button:not([data-act])').click()`)
    await until(page, `location.pathname === '/tlogo/B'`, 'the winner\'s line should open the pick')
    // A decided row folds to its winner: its passed options are behind its caret, and the shelf holds the archive.
    await until(page, `!document.querySelector('[data-tree-row="opt:tlogo/A"]') && !!document.querySelector('[data-tree-row="exp:tlogo"] button[aria-expanded="false"]')`, 'a decided exploration on its winner should be folded to it')
    await page.run(`document.querySelector('[data-tree-row="exp:tlogo"] button[aria-expanded]').click()`)
    await until(page, `!!document.querySelector('[data-tree-row="opt:tlogo/A"]')`, 'the caret should bring back the options passed on')
    await page.run(`document.querySelector('[data-tree-row="exp:tlogo"] button[aria-expanded]').click()`)
    await until(page, `!document.querySelector('[data-tree-row="opt:tlogo/A"]')`, 'the caret should fold them away again, and take them off the page')
    // By hand: the row's menu sets the chain aside, the shelf opens to show it, and the menu brings it back.
    await page.run(`document.querySelector('[data-tree-row="opt:tlogo/B"] [data-act^="vm:"]').click()`)
    await until(page, `[...document.querySelectorAll('[role=menuitem]')].some(b => /Set aside/.test(b.textContent))`, 'the row menu should offer Set aside')
    await page.run(`[...document.querySelectorAll('[role=menuitem]')].find(b => /Set aside/.test(b.textContent)).click()`)
    await until(page, `!!document.querySelector('[data-tree-shelf] [data-tree-row="exp:tlogo"]') && !document.querySelector('[data-tree-decided] [data-tree-row="exp:tlogo"]')`, 'Set aside should move it to the shelf, shown there while it is on screen')
    await page.run(`document.querySelector('[data-tree-shelf] [data-act^="vm:"]').click()`)
    await until(page, `[...document.querySelectorAll('[role=menuitem]')].some(b => /Bring back/.test(b.textContent))`, 'on the shelf the menu should offer Bring back')
    await page.run(`[...document.querySelectorAll('[role=menuitem]')].find(b => /Bring back/.test(b.textContent)).click()`)
    await until(page, `!!document.querySelector('[data-tree-decided] [data-tree-row="exp:tlogo"]')`, 'Bring back should return it to the tree')
    await page.run(`history.pushState(null, '', '/'); dispatchEvent(new PopStateEvent('popstate'))`)
    await page.run(`document.querySelector('[data-bar] [data-act="open:more"]')?.click()`)
    await until(page, `!!document.querySelector('[data-pop] [data-act=settings]')`, 'the bar menu should offer Settings')
    await page.run(`document.querySelector('[data-pop] [data-act=settings]').click()`)
    await until(page, `!!document.querySelector('[data-settings-category=browsing]')`, 'Settings should open')
    await page.run(`document.querySelector('[data-settings-category=browsing]').click()`)
    await until(page, `!!document.querySelector('[data-setting=tree] input')`, 'Browsing should have the Project tree switch')
    await page.run(`document.querySelector('[data-setting=tree] input').click()`)
    await until(page, `document.querySelector('[data-tree-side]').hidden && localStorage.getItem('proto-tree') === '0'`, 'the Settings switch should turn the tree off')
  } finally { page.close() }
  // Several rows at once: Cmd or Ctrl adds one, Shift a run, plain click leaves them for the row; the
  // bar, the menu and the keys act on them all, and Esc lets go.
  page = await openPage(`${local}tcta-copy/A?tree=1&conv=1`)
  try {
    const hit = (id, opts = '{}') => page.run(`document.querySelector('[data-tree-row="${id}"] button:not([aria-expanded]):not([data-act])').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...${opts} }))`)
    const chosen = `[...document.querySelectorAll('[data-tree-chosen="true"]')].map(r => r.dataset.treeRow).join()`
    const copied = `window.__copied`
    await until(page, `!!document.querySelector('[data-tree-row="opt:tcta-copy/B"]')`, 'the open exploration should show its options')
    await page.run(`navigator.clipboard.writeText = async text => { window.__copied = text }`)
    // It fades in with no flash: a one-pixel line that only gets stronger, on the same element, and the
    // row already chosen keeps its look when another joins, but for the edge they now share.
    await hit('opt:tcta-copy/A', '{ metaKey: true }')
    const fade = JSON.parse(await page.run(`(async () => {
      const a = document.querySelector('[data-tree-row="opt:tcta-copy/A"]'), b = document.querySelector('[data-tree-row="opt:tcta-copy/B"]')
      await new Promise(r => setTimeout(r, 300))
      b.querySelector('button:not([aria-expanded]):not([data-act])').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
      const out = { a: [], b: [], same: true }
      const look = el => { const c = getComputedStyle(el), e = getComputedStyle(el, '::before'); return { bg: c.backgroundColor, top: e.borderTopColor, bottom: e.borderBottomColor, width: e.borderBottomWidth } }
      for (const end = performance.now() + 300; performance.now() < end; await new Promise(requestAnimationFrame)) {
        out.a.push(look(a)); out.b.push(look(b))
        out.same &&= a.isConnected && b.isConnected
      }
      out.join = [a.dataset.treeJoin, b.dataset.treeJoin]
      // A loaded machine can still be fading when the frames above run out.
      await Promise.all([a, b].flatMap(el => el.getAnimations({ subtree: true })).map(x => x.finished.catch(() => {})))
      const rest = el => getComputedStyle(el, '::before')
      out.shared = [rest(a).borderBottomColor, rest(b).borderTopColor]
      out.radius = [getComputedStyle(a).borderBottomLeftRadius, getComputedStyle(b).borderTopLeftRadius, getComputedStyle(a).borderTopLeftRadius, getComputedStyle(b).borderBottomLeftRadius]
      return JSON.stringify(out)
    })()`))
    const alpha = c => { const m = c.match(/\/\s*([\d.]+)\)|,\s*([\d.]+)\)/); return m ? Number(m[1] ?? m[2]) : 1 }
    assert(fade.same, 'choosing a row should keep the rows on the page, not draw them again')
    assert(fade.a.every(l => l.bg === fade.a[0].bg && l.top === fade.a[0].top), 'a chosen row should keep its look when another is chosen')
    assert(fade.b.every(l => l.width === '1px'), `the outline should stay one pixel as it fades in: ${fade.b[0].width}`)
    const edge = fade.b.map(l => alpha(l.bottom))
    assert(edge.length > 3 && edge[0] < edge.at(-1) && edge.every((v, i) => !i || v >= edge[i - 1] - 0.001), `the outline should only get stronger: ${edge.join()}`)
    // Two rows that touch are one shape: no edge and no rounding between them, its ends still rounded.
    // Their corners are read once the fade has finished.
    assert(fade.join[0] === 'bottom' && fade.join[1] === 'top', `touching rows should join: ${fade.join}`)
    assert(fade.shared.every(c => alpha(c) === 0), `the edge between touching rows should fade out: ${fade.shared}`)
    assert(fade.radius[0] === '0px' && fade.radius[1] === '0px' && fade.radius[2] !== '0px' && fade.radius[3] !== '0px', `only the corners between them should square off: ${fade.radius}`)
    await until(page, `${chosen} === 'opt:tcta-copy/A,opt:tcta-copy/B' && /2 selected/.test(document.querySelector('[data-tree-chosen-bar]')?.textContent ?? '')`, 'Cmd + click should choose both rows and say so in the bar')
    assert(await page.run(`location.pathname === '/tcta-copy/A'`), 'choosing a row should not leave the page')
    await page.run(`document.querySelector('[data-tree-chosen-act="links"]').click()`)
    assert(await page.run(`/^\\S+\\/tcta-copy\\/A\\n\\S+\\/tcta-copy\\/B$/.test(${copied})`), `Copy links should give both links, one a line: ${await page.run(copied)}`)
    await page.run(`document.querySelector('[data-tree-chosen-act="ids"]').click()`)
    assert(await page.run(`${copied} === 'tcta-copy/1\\ntcta-copy/2'`), `Copy IDs should give both ids, one a line: ${await page.run(copied)}`)
    await page.run(`window.__copied = ''; dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true }))`)
    assert(await page.run(`/\\/tcta-copy\\/B$/.test(${copied})`), 'Cmd + C should copy the links of the rows chosen')
    // The star goes on them all, then off them all.
    await page.run(`document.querySelector('[data-tree-chosen-act="fav"]').click()`)
    await until(page, `document.querySelectorAll('[data-tree-chosen="true"] svg').length && document.querySelector('[data-tree-chosen-act="fav"]').getAttribute('aria-label') === 'Unfavorite'`, 'Favorite should star every row chosen')
    for (const end = Date.now() + 6000; Date.now() < end && !/"A"[\s\S]*"B"/.test(readFileSync(metaFile('tcta-copy'), 'utf8').match(/"favorites"[^\]]*\]/)?.[0] ?? ''); await wait(50));
    assert(/"A"[\s\S]*"B"/.test(readFileSync(metaFile('tcta-copy'), 'utf8').match(/"favorites"[^\]]*\]/)?.[0] ?? ''), 'both stars should be written to meta.ts')
    await page.run(`document.querySelector('[data-tree-chosen-act="fav"]').click()`)
    await until(page, `document.querySelector('[data-tree-chosen-act="fav"]').getAttribute('aria-label') === 'Favorite'`, 'Unfavorite should take every star off')
    // A right-click on a chosen row is about them all; on any other row, about that row.
    await page.run(`(() => { const r = document.querySelector('[data-tree-row="opt:tcta-copy/B"]').getBoundingClientRect(); document.querySelector('[data-tree-row="opt:tcta-copy/B"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 20, clientY: r.top + 8 })) })()`)
    await until(page, `/2 selected/.test(document.querySelector('[data-context-menu]')?.textContent ?? '') && !!document.querySelector('[data-shoot="ctx-ids"]')`, 'the menu on a chosen row should act on them all')
    await page.run(`document.querySelector('[data-shoot="ctx-ids"]').click()`)
    await until(page, `${copied} === 'tcta-copy/1\\ntcta-copy/2' && !document.querySelector('[data-context-menu]')`, 'the menu should copy the ids and close')
    // Esc lets go, and the page stays.
    await page.run(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await until(page, `${chosen} === '' && !document.querySelector('[data-tree-chosen-bar]')`, 'Esc should let go of the rows')
    assert(await page.run(`location.pathname === '/tcta-copy/A'`), 'Esc on a selection should not leave the variant')
    // Shift takes the run from the row on screen; a plain click lets go and goes to its row.
    await hit('opt:tcta-copy/B', '{ shiftKey: true }')
    await until(page, `${chosen} === 'opt:tcta-copy/A,opt:tcta-copy/B'`, 'Shift + click should choose the run from the row on screen')
    await hit('opt:tcta-copy/B')
    await until(page, `location.pathname === '/tcta-copy/B' && ${chosen} === ''`, 'a plain click should let go and open its row')
    // The row on screen comes along when a Cmd + click starts the selection.
    await hit('opt:tcta-copy/A', '{ metaKey: true }')
    await until(page, `${chosen} === 'opt:tcta-copy/A,opt:tcta-copy/B' && /2 selected/.test(document.querySelector('[data-tree-chosen-bar]')?.textContent ?? '')`, 'Cmd + click from another row should choose the row on screen too')
    await hit('opt:tcta-copy/B', '{ metaKey: true }')
    await until(page, `${chosen} === 'opt:tcta-copy/A'`, 'Cmd + click on the row on screen should take it back out')
    await page.run(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await until(page, `${chosen} === ''`, 'Esc should let go again')
    // Cmd + click on a decided row's name chooses its winner; on a design, nothing, and no move.
    await hit('exp:thero-cta', '{ metaKey: true }')
    await until(page, `${chosen} === 'opt:thero-cta/A,opt:tcta-copy/B'`, 'Cmd + click on a decided row should choose its winner, and the row on screen')
    await hit('design:acme', '{ metaKey: true }')
    assert(await page.run(`location.pathname === '/tcta-copy/B' && ${chosen} === 'opt:thero-cta/A,opt:tcta-copy/B'`), 'Cmd + click on a design should do nothing')
    // Another scope hides rows: none of them stays chosen.
    await page.run(`document.querySelector('[data-tree-filter="favs"]').click()`)
    await until(page, `!document.querySelector('[data-tree-chosen-bar]')`, 'changing the scope should let go of the rows')
    await page.run(`document.querySelector('[data-tree-filter="conv"]').click()`)
    // The row's own menu starts a selection too.
    await until(page, `!!document.querySelector('[data-tree-row="opt:tcta-copy/A"] [data-act^="vm:"]')`, 'back on this conversation the row should be there')
    await page.run(`document.querySelector('[data-tree-row="opt:tcta-copy/A"] [data-act^="vm:"]').click()`)
    await until(page, `!!document.querySelector('[data-shoot="ctx-select"]')`, 'the row menu should offer Select')
    await page.run(`document.querySelector('[data-shoot="ctx-select"]').click()`)
    await until(page, `${chosen} === 'opt:tcta-copy/A,opt:tcta-copy/B'`, 'Select should choose the row, and the row on screen')
  } finally { page.close() }
  // On a phone with the tree on: a two-line bar (the session's mark, the title, Pick), the tree in a
  // sheet at half the screen (its handle takes it to full), a row's ⋯ opening that variant's decide
  // tiles, and the pill's name opening the tree instead of the variant sheet.
  page = await openPage(`${local}thome/B?tree=1`, { width: 402, height: 874, phone: true })
  try {
    await until(page, `!!document.querySelector('[data-phone-bar] [data-shoot=bar-decide]')`, 'the phone bar should have Pick on a variant')
    assert(await page.run(`!document.querySelector('[data-pill] [data-pill-state]')`), 'with the tree on the pill should leave the state line to the bar')
    await page.run(`document.querySelector('[data-shoot=bar-title]').click()`)
    await until(page, `(() => { const s = document.querySelector('[data-shoot=tree-sheet]'); return !!s && Math.abs(s.getBoundingClientRect().top - innerHeight / 2) < 4 })()`, 'the title should open the tree sheet at half the screen')
    assert(await page.run(`!!document.querySelector('[data-shoot=tree-sheet] [data-tree-row="screen:thome"]') && getComputedStyle(document.querySelector('[data-shoot=tree-sheet] [data-tree-row]')).height === '40px'`), 'the sheet should hold the tree, with 40 px rows')
    await page.run(`document.querySelector('[data-sheet-grip]').click()`)
    await until(page, `document.querySelector('[data-shoot=tree-sheet]').getBoundingClientRect().top < 60`, 'the handle should take the tree to full height')
    await page.run(`document.querySelector('[data-shoot=tree-sheet] [data-tree-row="opt:thome/A"] [data-act^="vm:"]').click()`)
    await until(page, `!!document.querySelector('[data-shoot=decide-sheet] [data-tile=open]') && !!document.querySelector('[data-shoot=decide-sheet] [data-tile=fav]')`, 'a row\'s ⋯ should open that variant\'s tiles, with Open')
    await page.run(`document.querySelector('[data-shoot=decide-sheet] [data-tile=open]').click()`)
    await until(page, `location.pathname === '/thome/A' && !document.querySelector('[data-shoot=tree-sheet]') && !document.querySelector('[data-shoot=decide-sheet]')`, 'Open should go to the variant and close both sheets')
    await page.run(`document.querySelector('[data-shoot=bar-decide]').click()`)
    await until(page, `!!document.querySelector('[data-shoot=decide-sheet] [data-tile=pick]') && !document.querySelector('[data-shoot=decide-sheet] [data-tile=open]')`, 'Pick in the bar should open the tiles for the variant on screen, without Open')
    await page.run(`document.querySelector('[data-shoot=decide-sheet] [data-tile=pick]').click()`)
    await until(page, `/Picked/.test(document.querySelector('[data-shoot=bar-decide]').textContent) && !!document.querySelector('[data-shoot=decide-sheet]')`, 'a pick from the tiles should show in the bar, the tiles staying open')
  } finally { page.close() }
  // On a phone: a row's ⋯ starts choosing, then each tap on a row adds it instead of going there.
  page = await openPage(`${local}tcta-copy/A?tree=1&conv=1`, { width: 402, height: 874, phone: true })
  try {
    const sheet = `document.querySelector('[data-shoot=tree-sheet]')`
    await until(page, `!!document.querySelector('[data-shoot=bar-title]')`, 'the phone bar should have its title')
    await page.run(`document.querySelector('[data-shoot=bar-title]').click()`)
    await until(page, `!!${sheet}?.querySelector('[data-tree-row="opt:tcta-copy/B"] [data-act^="vm:"]')`, 'the sheet should show the options')
    await page.run(`${sheet}.querySelector('[data-tree-row="opt:tcta-copy/B"] [data-act^="vm:"]').click()`)
    await until(page, `!!document.querySelector('[data-shoot=decide-sheet] [data-tile=select]')`, 'a row\'s ⋯ should offer Select')
    await page.run(`document.querySelector('[data-shoot=decide-sheet] [data-tile=select]').click()`)
    await until(page, `!document.querySelector('[data-shoot=decide-sheet]') && /1 selected/.test(${sheet}?.querySelector('[data-tree-chosen-bar]')?.textContent ?? '')`, 'Select should go back to the tree with the row chosen')
    await page.run(`${sheet}.querySelector('[data-tree-row="opt:tcta-copy/A"] button:not([aria-expanded]):not([data-act])').click()`)
    await until(page, `/2 selected/.test(${sheet}?.querySelector('[data-tree-chosen-bar]')?.textContent ?? '')`, 'a tap should add its row while choosing')
    assert(await page.run(`!!${sheet}`), 'a tap while choosing should leave the tree open')
    // The sheet starts at half the screen, so the bar has to be on it.
    assert(await page.run(`document.querySelector('[data-tree-chosen-bar]').getBoundingClientRect().bottom <= innerHeight`), 'the bar should be on screen with the sheet at half')
  } finally { page.close() }
  for (const slug of ['thome', 'tabout', 'thero-cta', 'tcta-copy', 'tlogo', 'tpricing']) proto(['archive', slug])
  rmSync(join(app, 'src', 'designs'), { recursive: true, force: true })
  console.log('OK: the project tree sidebar: switch, designs, screens, explorations, scope, place and live designs')
}
