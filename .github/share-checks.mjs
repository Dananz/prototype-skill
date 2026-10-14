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
  try {
    assert(await page.run('!!document.querySelector("[data-act=share]")'), 'no Share entry in the shell')
    await page.run(`(async()=>{const {tweaks}=await import('/shell/tweaks.ts');tweaks.change(window.__protoDesign(),'accent','#dc2626');const {copy}=await import('/shell/copy.ts');copy.choose(window.__protoDesign(),'title',{text:'Alternate caption'})})()`)
    await click('[data-act=share]')
    await until('document.querySelectorAll("[data-share-tile] canvas").length === 3', 'current variant previews did not render')
    await page.run(`window.__captionBefore=document.querySelectorAll('[data-share-tile] canvas')[1].toDataURL();const e=document.querySelector('[aria-label="Screenshot name for A"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Edited caption');e.dispatchEvent(new Event('input',{bubbles:true}))`)
    await until(`document.querySelectorAll('[data-share-tile] canvas')[1].toDataURL() !== window.__captionBefore`, 'caption edit did not change preview pixels')
    const route = await page.run('location.hash')
    await page.key('ArrowRight')
    assert(await page.run('location.hash') === route, 'shell shortcut navigated behind the board')
    await click('[data-share-scope=all]')
    await until('document.querySelectorAll("[data-share-tile] canvas").length === 6', 'unmounted variant was not captured')
    await page.run(`window.__shots=[];window.__shotClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__shots.push({name:this.download,blob:fetch(this.href).then(r=>r.blob())})}else window.__shotClick.call(this)}`)
    await click('[data-share-download]')
    await until('window.__shots.length === 6 && !document.querySelector("[data-share-download]").disabled', 'batch did not download every selected tile')
    assert(await page.run(`(async()=>{const s=window.__shots;const a=await createImageBitmap(await s[0].blob);const b=await createImageBitmap(await s[3].blob);const c=document.createElement('canvas');c.width=c.height=1;const g=c.getContext('2d');g.drawImage(a,-20,-100);const red=g.getImageData(0,0,1,1).data[0];g.drawImage(b,-20,-100);const blue=g.getImageData(0,0,1,1).data[2];g.drawImage(a,20-a.width,-100);return red===220&&blue>200&&g.getImageData(0,0,1,1).data[0]===139&&s.every(x=>x.name.endsWith('.png'))&&s[0].name.includes('edited-caption')&&a.height+112===(await createImageBitmap(await s[1].blob)).height})()`), 'PNGs did not contain the two actual variants')
    await click('[data-share-size=phone]')
    await click('[data-share-size=stage]')
    await until('document.querySelectorAll("[data-share-tile] canvas").length === 6 && !document.querySelector("[data-share-download]").disabled', 'phone layout was not captured at 2x')
    await click('[data-share-download]')
    await until('window.__shots.length === 12 && !document.querySelector("[data-share-download]").disabled', 'phone batch did not download')
    assert(await page.run(`(async()=>{const b=await createImageBitmap(await window.__shots[6].blob);const c=document.createElement('canvas');c.width=c.height=1;const g=c.getContext('2d');g.drawImage(b,-20,-100);const p=g.getImageData(0,0,1,1).data;return b.width===780&&b.height===1688&&p[1]>150&&p[0]<50})()`), 'phone PNG dimensions or responsive pixels were wrong')
    await click('[data-share-tile]')
    assert(await page.run('document.querySelectorAll("[data-share-tile][aria-pressed=true]").length === 5'), 'individual tile could not be left out')
    const beforeStop = await page.run('window.__shots.length')
    await click('[data-share-download]')
    await until(`window.__shots.length > ${beforeStop}`, 'download did not start for Stop check')
    await page.run(`Array.from(document.querySelectorAll('[data-share-board] button')).find(b=>b.textContent==='Stop').click()`)
    await until('!document.querySelector("[data-share-download]").disabled', 'Stop did not release the download button')
    assert(await page.run('window.__shots.length') < beforeStop + 5, 'Stop allowed the whole batch through')
    const beforeClose = await page.run('window.__shots.length')
    await click('[data-share-download]')
    await until(`window.__shots.length > ${beforeClose}`, 'download did not restart')
    await click('[data-share-close]')
    const atClose = await page.run('window.__shots.length')
    await new Promise(r => setTimeout(r, 500))
    assert(await page.run('window.__shots.length') === atClose, 'closing continued downloading in the background')
    await until('!document.querySelector("[data-share-board]")', 'board did not close')
    await until(`document.activeElement.dataset.act === 'share' && !document.querySelector('iframe[title="Screenshot capture"]')`, 'close did not restore focus and remove capture frames')
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
    await framed.run(`document.querySelector('[data-act=share]').click()`)
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
    await slow.run(`document.querySelector('[data-act=share]').click()`)
    for (const end = Date.now() + 26000; Date.now() < end && !await slow.run(`document.querySelectorAll('[data-share-tile] canvas').length===3 && document.querySelector('[data-share-board]').textContent.includes('Capture took too long')`); await new Promise(r => setTimeout(r, 100))) {}
    assert(await slow.run(`document.querySelectorAll('[data-share-tile] canvas').length===3 && document.querySelector('[data-share-download]').disabled`), 'a stalled image blocked later captures or allowed a partial batch')
    await slow.run(`document.querySelector('[aria-label="Leave out variant A"]').click()`)
    await new Promise(r => setTimeout(r, 50))
    assert(await slow.run(`!document.querySelector('[data-share-download]').disabled`), 'leaving the failed variant out did not allow the remaining shots')
    await slow.key('Escape')
    await slow.run(`document.querySelector('[data-act=share]').click()`)
    await new Promise(r => setTimeout(r, 150))
    await slow.key('Escape')
    await new Promise(r => setTimeout(r, 100))
    assert(await slow.run(`!document.querySelector('iframe[title="Screenshot capture"]')`), 'closing while preparing left a capture frame alive')
  } finally { slow.close() }
  console.log('OK: Share board, captions, live tweaks, responsive PNGs, phone/Vue-compatible entry and bounded capture failure')
}
