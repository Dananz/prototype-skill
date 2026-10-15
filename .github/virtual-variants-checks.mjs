// Large variant lists keep DOM and preview work proportional to the viewport.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function virtualVariantsChecks({ proto, app, local, openPage, fail, keepShots = '', before = false }) {
  const assert = (ok, why) => { if (!ok) fail(`virtual variants: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expr, why = expr) => {
    for (const end = Date.now() + 15000; Date.now() < end; await wait(60)) if (await page.run(expr)) return
    fail(`virtual variants: ${why}`)
  }
  const ids = Array.from({ length: 120 }, (_, i) => i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`)
  proto(['add', 'virtualfx', '--title', 'Exercise library', '--variants', ids.map((id, i) => `${id}:Exercise ${i + 1}`).join(',')])
  for (const [i, id] of ids.entries()) writeFileSync(join(app, `src/protos/virtualfx/${id}.tsx`), `import {useEffect} from 'react'
export default function Exercise(){useEffect(()=>{window.__previewMounts=(window.__previewMounts||0)+1;return()=>{window.__previewUnmounts=(window.__previewUnmounts||0)+1}},[]);return <main style={{minHeight:500,padding:24}}><h1>Exercise ${i + 1}</h1>{Array.from({length:60},(_,i)=><div key={i} style={{padding:4}}>Movement {i+1}</div>)}</main>}`)
  proto(['done', 'virtualfx'])
  const metrics = []
  const shot = async (page, name) => { if (keepShots) { await wait(300); await page.screenshot(join(keepShots, `${before ? 'before' : 'after'}-${name}.png`)) } }
  const phone = await openPage(`${local}?theme=dark#/virtualfx/A`, {width:393,height:852,phone:true})
  try {
    await until(phone, `!!document.querySelector('[data-pill-handle]')`)
    await phone.run(`document.querySelector('[data-pill-handle]').focus()`); await phone.key('Enter')
    await until(phone, `!!document.querySelector('[role="dialog"] button[aria-current]')`)
    const n = await phone.run(`document.querySelectorAll('[role="dialog"] button[aria-current]').length - 1`)
    metrics.push({surface:'phone-sheet',rendered:n,total:ids.length})
    await shot(phone, 'phone-variants')
    if (keepShots) {
      await phone.key('Escape')
      await until(phone, `!document.querySelector('[role="dialog"]')`)
      await phone.run(`(async()=>{const {createShare}=await import('/shell/share.ts');window.__evidenceShare=createShare();window.__evidenceShare({title:'Exercise library',slug:'virtualfx',variants:${JSON.stringify(ids)}.map((id,i)=>({id,name:'Exercise '+(i+1),hash:'#/virtualfx/'+id})),current:'A',size:{w:320,h:240},dark:true,onClose:()=>window.__evidenceShare(null),returnFocus:()=>null})})()`)
      await until(phone, `!!document.querySelector('[data-share-tile] canvas')`)
      await shot(phone, 'phone-share')
      await phone.run(`document.querySelector('[data-share-close]').click()`)
    }

    if (!before) assert(n < 50, `phone sheet rendered ${n} rows`)
  } finally { phone.close() }
  const page = await openPage(`${local}?theme=dark#/virtualfx/A`)
  try {
    await until(page, `!!document.querySelector('[data-side] [data-k="v:virtualfx"] [data-mv]')`)
    const sideCount = await page.run(`document.querySelectorAll('[data-side] [data-mv^="virtualfx:"]').length`)
    metrics.push({surface:'sidebar', rendered:sideCount, total:ids.length})
    if (!before) assert(sideCount < 50, `sidebar rendered ${sideCount} rows for ${ids.length} variants`)
    await page.run(`document.querySelector('[data-act="open:switch"]').click()`)
    await until(page, `!!document.querySelector('[data-pop] [data-mcols]')`)
    const popCount = await page.run(`document.querySelectorAll('[data-pop] [data-mv^="virtualfx:"]').length`)
    metrics.push({surface:'popover',rendered:popCount,total:ids.length})
    await shot(page, 'desktop-navigation')
    if (!before) {
      assert(popCount < 50, `popover rendered ${popCount} rows`)
      await page.run(`document.querySelector('[data-pop] [data-act="mv:virtualfx:A"]').focus()`)
      await page.key('End')
      assert(await page.run(`document.activeElement?.dataset.act`) === 'mv:virtualfx:DP', 'End did not focus the offscreen final variant')
      await page.run(`document.querySelector('[data-pop] [data-k="v:virtualfx"]').scrollTop=0`)
      proto(['add', 'virtualfx', '--title', 'Exercise library updated'])
      await until(page, `document.querySelector('[data-pop]')?.textContent.includes('Exercise library updated')`, 'metadata update did not redraw the open list')
      assert(await page.run(`document.activeElement?.dataset.act`) === 'mv:virtualfx:DP', 'a chrome refresh lost its offscreen focused row')
      proto(['add', 'virtualfx', '--title', 'Exercise library'])
      await until(page, `document.querySelector('[data-pop]')?.textContent.includes('Exercise library') && !document.querySelector('[data-pop]')?.textContent.includes('Exercise library updated')`)
      await page.key('Home')
      for (let i = 0; i < 24; i++) await page.key('ArrowDown')
      assert(await page.run(`document.activeElement?.dataset.act`) === 'mv:virtualfx:Y', 'ArrowDown stopped at a virtual window boundary')
      await page.key('Escape')
    }
    await page.run(`location.hash='#/virtualfx'`)
    await until(page, `!!document.querySelector('[data-layers] [data-thumb]')`)
    await wait(700)
    metrics.push(await page.run(`({surface:'overview', rendered:document.querySelectorAll('[data-layers] [data-thumb]').length, live:document.querySelectorAll('[data-layers] [data-mount] > *').length, nodes:document.querySelector('[data-layers]').querySelectorAll('*').length})`))
    await shot(page, 'desktop-overview')
    if (keepShots) {
      await page.run(`document.querySelector('[data-act="stack:1"]').click()`)
      await until(page, `!!document.querySelector('[data-stack-item] [data-mount] h1')`)
      await shot(page, 'desktop-full-size')
      await page.run(`document.querySelector('[data-act="stack:0"]').click()`)
      await until(page, `!!document.querySelector('[data-layers] [data-thumb]')`)
      await page.run(`(async()=>{const {createShare}=await import('/shell/share.ts');window.__evidenceShare=createShare();window.__evidenceShare({title:'Exercise library',slug:'virtualfx',variants:${JSON.stringify(ids)}.map((id,i)=>({id,name:'Exercise '+(i+1),hash:'#/virtualfx/'+id})),current:'A',size:{w:320,h:240},dark:true,onClose:()=>window.__evidenceShare(null),returnFocus:()=>null})})()`)
      await until(page, `!!document.querySelector('[data-share-tile] canvas')`)
      await shot(page, 'desktop-share')
      await page.run(`document.querySelector('[data-share-close]').click()`)
      await until(page, `!document.querySelector('[data-share-board]')`)
    }

    if (keepShots && !before) {
      for (const [i, top] of [0, 1200, 3600, 100000, 3600, 0].entries()) {
        await page.run(`{const sc=document.querySelector('[data-layers] > div > div');sc.dispatchEvent(new WheelEvent('wheel'));sc.scrollTop=${top}}`)
        await wait(350)
        await page.screenshot(join(keepShots, `scroll-${i}.png`))
      }
    }

    if (!before) {
      assert(await page.run(`document.querySelectorAll('[data-layers] [data-thumb]').length < 50`), 'overview kept every card in the DOM')
      await page.run(`window.__firstCard=document.querySelector('[data-layers] [data-act="pv:virtualfx:A"]').closest('[data-virtual-index]')`)
      await page.run(`document.querySelector('[data-layers] > div > div').scrollTop=600`)
      await wait(350)
      await page.run(`{const sc=document.querySelector('[data-layers] > div > div');sc.dispatchEvent(new WheelEvent('wheel'));sc.scrollTop=0}`)
      await wait(350)
      assert(await page.run(`!!window.__firstCard && document.querySelector('[data-layers] [data-act="pv:virtualfx:A"]').closest('[data-virtual-index]') === window.__firstCard`), 'returning to a nearby overview card did not reuse its cached DOM')
      await page.run(`{const sc=document.querySelector('[data-layers] > div > div'); sc.dispatchEvent(new WheelEvent('wheel')); sc.scrollTop=sc.scrollHeight}`)
      await until(page, `!!document.querySelector('[data-layers] [data-act="pv:virtualfx:DP"]')`, 'scrolling did not reveal the final card')
      assert(await page.run(`window.__previewUnmounts > 0 && window.__previewMounts - window.__previewUnmounts < 30`), 'offscreen preview effects stayed mounted')
      await page.run(`document.querySelector('[data-layers] [data-act="pv:virtualfx:DP"]').click()`)
      await until(page, `location.hash === '#/virtualfx/DP'`)
      await page.run(`location.hash='#/virtualfx'`)
      await until(page, `!!document.querySelector('[data-layers] [data-act="pv:virtualfx:DP"]')`, 'returning to the overview lost its scroll position')
      await page.run(`document.querySelector('[data-act="stack:1"]').click()`)
      await until(page, `!!document.querySelector('[data-stack-item] [data-mount] > *')`, 'full-size list did not mount its visible designs')

      assert(await page.run(`document.querySelectorAll('[data-stack-item]').length < 10`), 'full-size list mounted every variant')
      await page.run(`{const sc=document.querySelector('[data-layers] > div > div'); sc.dispatchEvent(new WheelEvent('wheel')); sc.scrollTop=sc.scrollHeight}`)
      await until(page, `!!document.querySelector('[data-stack-item] [data-act="pv:virtualfx:DP"]')`, 'full-size list could not reach its final variant')
      await page.run(`location.hash='#/virtualfx/A'`)
      await until(page, `!!document.querySelector('[data-layers] [data-mount] h1')`)
      writeFileSync(join(app, 'src/protos/virtualfx/A.tsx'), 'export default function UpdatedExercise(){return <main><h1>Updated exercise</h1></main>}')
      await until(page, `document.querySelector('[data-layers] [data-mount] h1')?.textContent === 'Updated exercise'`, 'live edits stopped reaching a mounted variant')
      await page.run(`location.hash='#/virtualfx'`)
      await until(page, `!!document.querySelector('[data-act="stack:0"]')`)
      await page.run(`document.querySelector('[data-act="stack:0"]').click()`)
      await until(page, `!!document.querySelector('[data-layers] [data-act="pv:virtualfx:DP"]')`)
      await page.run(`{const sc=document.querySelector('[data-layers] > div > div');sc.dispatchEvent(new WheelEvent('wheel'));sc.scrollTop=0}`)
      await until(page, `document.querySelector('[data-act="pv:virtualfx:A"] [data-mount] h1')?.textContent === 'Updated exercise'`, 'cached overview remounted stale code after a live edit')

    }
  } finally { page.close() }
  if (!before || keepShots) {
    proto(['add', 'virtualfx', '--kind', 'phone', '--screen', '393x852'])
    const phones = await openPage(`${local}?theme=dark#/virtualfx`)
    try {
      await until(phones, `!!document.querySelector('[data-act="stack:1"]')`)
      await phones.run(`document.querySelector('[data-act="stack:1"]').click()`)
      await wait(200)
      await until(phones, `!!document.querySelector('[data-stack-item] [data-phone]')`)
      if (!before) assert(await phones.run(`(()=>{const e=document.querySelector('[data-stack-item]');return e.getBoundingClientRect().width>300&&document.querySelectorAll('[data-stack-item]').length<15})()`), 'phone full-size list collapsed or mounted every frame')
      if (!before) assert(await phones.run(`(()=>{const frames=[...document.querySelectorAll('[data-stack-item] [data-phone]')].map(e=>e.getBoundingClientRect());return frames.length<2||Math.abs(frames[1].left-frames[0].right-40)<2})()`), 'phone full-size frames lost their 40px horizontal gap')
      await shot(phones, 'desktop-phone-full-size')
      await phones.run(`{const sc=document.querySelector('[data-layers] > div > div');sc.dispatchEvent(new WheelEvent('wheel'));sc.scrollTop=sc.scrollHeight}`)
      await until(phones, `!!document.querySelector('[data-stack-item] [data-act="pv:virtualfx:DP"]')`, 'phone full-size list did not reach the final frame')
    } finally { phones.close() }
  }
  console.log(`VIRTUAL_METRICS ${JSON.stringify(metrics)}`)
  console.log(`virtual variants: ${before ? 'baseline captured' : 'bounded lists, keyboard navigation, cached cards, and scroll restoration passed'}`)
  return metrics
}
