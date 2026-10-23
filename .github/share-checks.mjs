// Real responsive variants, the board, and the PNGs delivered by its download button.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function shareChecks({ proto, app, local, openPage, fail }) {
  proto(['add', 'share-check', '--title', 'Share checks', '--variants', 'A:Coral,B:Ocean'])
  for (const [id, color] of [['A', '#ef4444'], ['B', '#2563eb']]) writeFileSync(join(app, 'src/protos/share-check', `${id}.tsx`), `
import { useState } from 'react'
import { useTweaks } from '../../tweaks'
import { useCopy } from '../../copy'
export default function Shot(){ const words=useCopy([{id:'title',label:'Title',options:['Original caption','Alternate caption']}]); const [accent,setAccent]=useState('${color}');useTweaks([{id:'accent',label:'Accent',kind:'color',value:accent,defaultValue:'${color}',set:setAccent}]);return <main style={{position:'relative',height:'100%',background:innerWidth < 600 ? '#10b981' : accent}}><h1 data-copy="title">{words.title}</h1><div style={{position:'absolute',right:0,top:0,width:'50%',height:'100%',background:words.title==='Alternate caption'?'#8b5cf6':'transparent'}} /></main> }
`)
  const page = await openPage(`${local}#/share-check/A`)
  const assert = (ok, why) => { if (!ok) fail(`share: ${why}`) }
  const until = async (expression, why) => {
    for (const end = Date.now() + 20000; Date.now() < end; await new Promise(r => setTimeout(r, 100))) if (await page.run(expression)) return
    fail(`share: ${why}`)
  }
  const click = s => page.run(`document.querySelector(${JSON.stringify(s)})?.click()`)
  const openShare = (target, slug, id, right = false) => target.run(`(async()=>{
    const button=document.querySelector('[data-act="vm:${slug}:${id}"]');if(!button)return false;
    if(${right}){const row=button.parentElement;const r=row.getBoundingClientRect();row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+10,clientY:r.top+10}))}else button.click();
    for(const end=Date.now()+5000;Date.now()<end;await new Promise(r=>setTimeout(r,50))){const share=document.querySelector('[data-shoot=ctx-share]');if(share){share.click();return true}}return false
  })()`)
  try {
    assert(await page.run('!document.querySelector("[data-bar] [data-act=share]")'), 'Share remains in the navbar')
    await page.run(`(async()=>{const {tweaks}=await import('/shell/tweaks.ts');tweaks.change(window.__protoDesign(),'accent','#dc2626');const {copy}=await import('/shell/copy.ts');copy.choose(window.__protoDesign(),'title',{text:'Alternate caption'})})()`)
    assert(await openShare(page, 'share-check', 'A'), 'variant context menu has no Share entry')
    assert(await page.run(`!document.querySelector('[data-share-scope]') && document.querySelectorAll('[data-share-board] input[type=radio]').length===4`), 'planned radio choices were replaced by generic scope and checkbox controls')
    await until('document.querySelectorAll("[data-share-tile] canvas").length === 4', 'board did not show both styles for every variant')
    assert(await page.run(`document.querySelectorAll('[data-share-tile][aria-pressed=true]').length===2 && document.querySelector('[data-share-look=both]').checked && document.querySelectorAll('input[name=screenshot-style]:checked').length===1`), 'clicked variant or default Both style was not selected')
    await click('[data-share-look=canvas]')
    await until(`document.querySelectorAll('[data-share-tile] canvas').length===2 && !!document.querySelector('[data-share-tone=soft]')`, 'Canvas did not replace the other styles')
    await page.run(`window.__toneBefore=document.querySelector('[data-share-tile] canvas').toDataURL()`)
    await click('[data-share-tone=brand]')
    await until(`document.querySelector('[data-share-tile] canvas').toDataURL()!==window.__toneBefore && document.querySelectorAll('[data-share-tone][aria-pressed=true]').length===1`, 'segmented background did not change the canvas pixels')
    await click('[data-share-look=named]')
    await until(`document.querySelectorAll('[data-share-tile] canvas').length===2 && !document.querySelector('[data-share-tone]') && [...document.querySelectorAll('[data-share-tile]')].every(t=>t.dataset.shareTile.endsWith('|named'))`, 'With name did not replace Canvas')
    await page.run(`document.querySelector('[data-share-look=named]').focus()`)
    await page.key('ArrowRight')
    await until(`document.querySelector('[data-share-look=both]').checked && document.querySelectorAll('[data-share-tile] canvas').length===4`, 'radio keyboard navigation did not select Both')
    await page.run(`window.__captionBefore=document.querySelectorAll('[data-share-tile] canvas')[1].toDataURL();const e=document.querySelector('[aria-label="Screenshot name for #1"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Edited caption');e.dispatchEvent(new Event('input',{bubbles:true}))`)
    await until(`document.querySelectorAll('[data-share-tile] canvas')[1].toDataURL() !== window.__captionBefore`, 'caption edit did not change preview pixels')
    const route = await page.run('location.hash')
    await page.run(`document.querySelector('[data-share-close]').focus()`)
    await page.key('ArrowRight')
    assert(await page.run('location.hash') === route, 'shell shortcut navigated behind the board')
    await click('[aria-label="Include variant #2"]')
    await until('document.querySelectorAll("[data-share-tile] canvas").length === 4', 'unmounted variant was not captured')
    await page.run(`window.__shots=[];window.__shotClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__shots.push({name:this.download,blob:fetch(this.href).then(r=>r.blob())})}else window.__shotClick.call(this)}`)
    await click('[data-share-download]')
    await until('window.__shots.length === 4 && !document.querySelector("[data-share-download]").disabled', 'batch did not download every selected tile')
    const pixels = await page.run(`(async()=>{const s=window.__shots;const a=await createImageBitmap(await s[0].blob);const b=await createImageBitmap(await s[2].blob);const c=document.createElement('canvas');c.width=c.height=1;const g=c.getContext('2d');g.drawImage(a,-20,-100);const red=g.getImageData(0,0,1,1).data[0];g.drawImage(b,-20,-100);const blue=g.getImageData(0,0,1,1).data[2];g.drawImage(a,20-a.width,-100);return {red,blue,purple:g.getImageData(0,0,1,1).data[0],png:s.every(x=>x.name.endsWith('.png')),caption:s[0].name.includes('edited-caption'),extraHeight:(await createImageBitmap(await s[1].blob)).height-a.height}})()`)
    assert(pixels?.red===220 && pixels.blue>200 && pixels.purple===139 && pixels.png && pixels.caption && pixels.extraHeight===112, `PNGs did not contain the two actual variants: ${JSON.stringify(pixels)}`)
    await click('[data-share-size=phone]')
    await click('[data-share-size=stage]')
    await until('document.querySelectorAll("[data-share-tile] canvas").length === 4 && !document.querySelector("[data-share-download]").disabled', 'phone layout was not captured at 2x')
    await click('[data-share-download]')
    await until('window.__shots.length === 8 && !document.querySelector("[data-share-download]").disabled', 'phone batch did not download')
    assert(await page.run(`(async()=>{const b=await createImageBitmap(await window.__shots[4].blob);const c=document.createElement('canvas');c.width=c.height=1;const g=c.getContext('2d');g.drawImage(b,-20,-100);const p=g.getImageData(0,0,1,1).data;return b.width===780&&b.height===1688&&p[1]>150&&p[0]<50})()`), 'phone PNG dimensions or responsive pixels were wrong')
    await click('[data-share-tile]')
    assert(await page.run('document.querySelectorAll("[data-share-tile][aria-pressed=true]").length === 3'), 'individual tile could not be left out')
    const beforeStop = await page.run('window.__shots.length')
    await click('[data-share-download]')
    await until(`window.__shots.length > ${beforeStop}`, 'download did not start for Stop check')
    await page.run(`Array.from(document.querySelectorAll('[data-share-board] button')).find(b=>b.textContent==='Stop').click()`)
    await until('!document.querySelector("[data-share-download]").disabled', 'Stop did not release the download button')
    assert(await page.run('window.__shots.length') < beforeStop + 3, 'Stop allowed the whole batch through')
    const beforeClose = await page.run('window.__shots.length')
    await click('[data-share-download]')
    await until(`window.__shots.length > ${beforeClose}`, 'download did not restart')
    await click('[data-share-close]')
    const atClose = await page.run('window.__shots.length')
    await new Promise(r => setTimeout(r, 500))
    assert(await page.run('window.__shots.length') === atClose, 'closing continued downloading in the background')
    await until('!document.querySelector("[data-share-board]")', 'board did not close')
    await until(`document.activeElement.dataset.act === 'vm:share-check:A' && !document.querySelector('iframe[title="Screenshot capture"]')`, 'close did not restore focus and remove capture frames')
    assert(await openShare(page, 'share-check', 'B', true), 'right-click menu has no Share entry')
    await until(`document.querySelectorAll('[data-share-tile] canvas').length === 4 && document.querySelectorAll('[data-share-tile][aria-pressed=true]').length === 2 && [...document.querySelectorAll('[data-share-tile][aria-pressed=true]')].every(t=>t.dataset.shareTile.startsWith('B|'))`, 'context menu did not select the clicked variant')
    assert(await page.run('location.hash') === route, 'sharing another variant changed the current view')
    await click('[data-share-close]')
  } finally { page.close() }
  const phone = await openPage(`${local}?theme=light#/share-check/A`, { width: 390, height: 844, phone: true })
  try {
    await phone.run(`document.querySelector('[data-pill-menu]').click()`)
    for (const end = Date.now() + 5000; Date.now() < end && !await phone.run(`!!document.querySelector('[data-menu-card] [data-act=share]')`); await new Promise(r => setTimeout(r, 50))) {}
    await phone.run(`document.querySelector('[data-menu-card] [data-act=share]').click()`)
    for (const end = Date.now() + 5000; Date.now() < end && !await phone.run(`!!document.querySelector('[data-share-board]')`); await new Promise(r => setTimeout(r, 50))) {}
    assert(await phone.run(`(()=>{const e=document.querySelector('[data-share-board]');return e&&e.scrollWidth<=innerWidth&&document.querySelector('[data-share-download]').getBoundingClientRect().bottom<=innerHeight})()`), 'phone menu did not open a board with reachable download controls')
    await phone.key('Escape')
    await new Promise(r => setTimeout(r, 100))
    assert(await phone.run(`!document.querySelector('[data-share-board]')&&document.activeElement.hasAttribute('data-pill-menu')`), 'phone close did not return focus to the menu')
  } finally { phone.close() }
  // Phone-kind prototypes normally live inside a scaled shell bezel. Exports use the
  // requested viewport directly, with the design reaching its edges.
  proto(['add', 'share-check', '--kind', 'phone'])
  const framed = await openPage(`${local}?theme=light#/share-check/A`)
  try {
    assert(await openShare(framed, 'share-check', 'A'), 'phone-kind variant context menu has no Share entry')
    for (const end = Date.now() + 20000; Date.now() < end && !await framed.run(`!!document.querySelector('[data-share-tile] canvas')`); await new Promise(r => setTimeout(r, 100))) {}
    assert(await framed.run(`(()=>{const c=document.querySelector('[data-share-tile] canvas');if(!c)return false;const p=c.getContext('2d').getImageData(20,100,1,1).data;return p[0]<50&&p[1]>150})()`), 'phone-kind export included the shell bezel or scaled the design')
    await framed.key('Escape')
  } finally { framed.close() }
  proto(['add', 'share-slow', '--title', 'Capture failure', '--variants', 'A:Waiting,B:Ready'])
  writeFileSync(join(app, 'src/protos/share-slow/A.tsx'), `
if(new URLSearchParams(location.search).has('shot')) {const decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){return this.alt==='Wait for image'?new Promise(()=>{}):decode.call(this)}}
export default function Slow(){return <main><img alt="Wait for image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" /></main>}`)
  writeFileSync(join(app, 'src/protos/share-slow/B.tsx'), `export default function Ready(){return <main style={{height:'100%',background:'#2563eb'}}>Ready</main>}`)
  const slow = await openPage(`${local}?theme=light#/share-slow`)
  try {
    assert(await openShare(slow, 'share-slow', 'B'), 'ready variant context menu has no Share entry')
    for (const end = Date.now() + 5000; Date.now() < end && !await slow.run(`!document.querySelector('[data-share-download]').disabled`); await new Promise(r => setTimeout(r, 100))) {}
    assert(await slow.run(`!document.querySelector('[data-share-download]').disabled && document.querySelectorAll('[data-share-tile][aria-pressed=true] canvas').length===2`), 'an excluded slow variant delayed the clicked variant')
    await slow.key('Escape')
    assert(await openShare(slow, 'share-slow', 'A'), 'slow variant context menu has no Share entry')
    await slow.run(`document.querySelector('[aria-label="Include variant #2"]').click()`)
    for (const end = Date.now() + 26000; Date.now() < end && !await slow.run(`document.querySelectorAll('[data-share-tile] canvas').length===2 && document.querySelector('[data-share-board]').textContent.includes('Capture took too long')`); await new Promise(r => setTimeout(r, 100))) {}
    assert(await slow.run(`document.querySelectorAll('[data-share-tile] canvas').length===2 && document.querySelector('[data-share-download]').disabled`), 'a stalled image blocked later captures or allowed a partial batch')
    await slow.run(`document.querySelector('[aria-label="Leave out variant #1"]').click()`)
    await new Promise(r => setTimeout(r, 50))
    assert(await slow.run(`!document.querySelector('[data-share-download]').disabled`), 'leaving the failed variant out did not allow the remaining shots')
    await slow.key('Escape')
    assert(await openShare(slow, 'share-slow', 'A'), 'slow variant menu did not reopen')
    await new Promise(r => setTimeout(r, 150))
    await slow.key('Escape')
    await new Promise(r => setTimeout(r, 100))
    assert(await slow.run(`!document.querySelector('iframe[title="Screenshot capture"]')`), 'closing while preparing left a capture frame alive')
  } finally { slow.close() }
  console.log('OK: Share board, captions, live tweaks, responsive PNGs, phone/Vue-compatible entry and bounded capture failure')
}
