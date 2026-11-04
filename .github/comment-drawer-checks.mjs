// Real touch gestures catch a drawer that only looks draggable, or steals list scrolling.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export async function commentDrawerChecks({ proto, app, local, openPage, fail }) {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const assert = (ok, why) => { if (!ok) fail(`comment drawer: ${why}`) }
  proto(['add', 'drawerfx', '--title', 'Comment drawer', '--variants', 'A:Plain'])
  writeFileSync(join(app, 'src/protos/drawerfx/A.tsx'), 'export default function V() { return <main style={{padding:24}}><h1>Review this screen</h1><p>Drag the comments up to read more.</p></main> }\n')
  for (const [lang, tree] of [['en', '0'], ['he', '1']]) {
    const page = await openPage(`${local}drawerfx/A?lang=${lang}&tree=${tree}&theme=dark`, { width: 390, height: 844, phone: true })
    try {
      await page.run(`(async () => {
        const until = async f => { for (let n=0;n<200;n++) { if(f()) return; await new Promise(r=>setTimeout(r,50)) } throw Error('drawer fixture timed out') }
        await until(()=>document.querySelector('[data-shoot=whole-input]'))
        for(let n=0;n<16;n++) {
          const box=document.querySelector('[data-shoot=whole-input]'); box.textContent='Feedback '+(n+1)+': please adjust the spacing on this screen.'; box.dispatchEvent(new Event('input',{bubbles:true}));
          await until(()=>document.querySelector('[data-shoot=whole-add]')); document.querySelector('[data-shoot=whole-add]').click();
          await until(()=>!document.querySelector('[data-shoot=whole-add]'));
        }
        document.querySelector('[data-shoot=whole-input]').blur(); document.querySelector('[data-shoot=island-open]').click();
      })()`)
      await wait(650)
      const rect = async selector => JSON.parse(await page.run(`JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`))
      const drag = async (selector, dy, cancel = false, released) => {
        const r = await rect(selector), x = r.left + r.width / 2, y = r.top + r.height / 2
        await page.touch('touchStart', [[x, y]])
        for (let n=1;n<=12;n++) { await page.touch('touchMove', [[x, y + dy*n/12]]); await wait(16) }
        await page.touch(cancel ? 'touchCancel' : 'touchEnd', [])
        if (released) { await wait(32); await released() }
        await wait(550)
      }
      const comments = '[data-shoot=comments]'
      const before = await rect(comments)
      await page.screenshot(join(tmpdir(), 'comment-drawer', `${lang}-initial.png`))
      const g = await rect('[data-comment-drawer-handle]'), x = g.left + g.width / 2, y = g.top + g.height / 2
      await page.touch('touchStart', [[x, y]])
      await page.touch('touchMove', [[x, y-70]]); await wait(50)
      const midway = (await rect(comments)).height
      assert(Math.abs(midway-before.height-70)<4, `the drawer must follow the finger before release (before ${before.height}, midway ${midway})`)
      await page.touch('touchMove', [[x, y-35]]); await wait(50)
      assert(Math.abs((await rect(comments)).height-before.height-35)<4, 'reversing direction must move the drawer back with the finger')
      await page.touch('touchCancel', []); await wait(550)
      await drag('[data-island-grip]', -230)
      const full = await rect(comments)
      assert(full.height > before.height + 100, `an upward touch drag must expand the list (${lang}, was ${before.height}, now ${full.height})`)
      assert((await rect('[data-island]')).top >= 0, 'the full drawer must fit below the header')
      await page.screenshot(join(tmpdir(), 'comment-drawer', `${lang}-full.png`))
      const scroll = '[data-shoot=comments] .overflow-y-auto'
      await drag(scroll, -120)
      assert(await page.run(`document.querySelector('${scroll}').scrollTop > 20`), 'touching the list must scroll its comments')
      assert(Math.abs((await rect(comments)).height-full.height)<3, 'scrolling must not resize the drawer')
      await drag('[data-island-grip]', 230)
      assert((await rect(comments)).height < full.height-100, 'dragging down must settle at the smaller height')
      await page.screenshot(join(tmpdir(), 'comment-drawer', `${lang}-half.png`))
      await drag('[data-island-grip]', -100, true)
      assert(Math.abs((await rect(comments)).height-before.height)<3, 'a cancelled gesture must restore the resting height')
      await drag('[data-island-grip]', 350, false, async () => {
        assert((await rect('[data-island-list]')).height < 50, 'swipe dismissal must not bounce the list open again')
      })
      assert(await page.run(`!document.querySelector('[data-island]').hasAttribute('data-open')`), 'dragging down past the bottom must collapse the comments')
      await page.run(`document.querySelector('[data-shoot=island-open]').click()`)
      await wait(550)
      assert((await rect(comments)).height > 100, 'the count must reopen after swipe dismissal')
      await page.run(`document.querySelector('[data-comment-drawer-handle]').focus()`)
      await page.enter(); await wait(550)
      assert((await rect(comments)).height > before.height+100, 'Enter on the handle must work after dragging and reopening')
      await page.key('ArrowDown'); await wait(550)
      assert(Math.abs((await rect(comments)).height-before.height)<3, 'ArrowDown must restore the smaller height')
      await page.key('ArrowUp'); await wait(550)
      assert((await rect(comments)).height > before.height+100, 'the handle must expand with the keyboard')
      await page.key('Escape'); await wait(550)
      assert(await page.run(`!document.querySelector('[data-island]').hasAttribute('data-open')`), 'Escape on the handle must collapse')
    } finally { page.close() }
  }
  proto(['archive', 'drawerfx'])
  console.log('OK: mobile comments expand, scroll, snap, cancel, collapse and reopen in English and Hebrew')
}
