// Cached React cells, phone keyboard access, and selected offscreen screenshot exports.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function virtualReactChecks({ proto, app, local, openPage, fail }) {
  proto(['add', 'virtual-react-check', '--title', 'Virtual React checks', '--variants', 'A:Red screenshot,B:Blue screenshot'])
  writeFileSync(join(app, 'src/protos/virtual-react-check/A.tsx'), `export default function Sample(){return <main style={{height:'100%',background:'#dc2626'}}>Virtual screenshot</main>}`)
  writeFileSync(join(app, 'src/protos/virtual-react-check/B.tsx'), `export default function Sample(){return <main style={{height:'100%',background:'#2563eb'}}>Blue screenshot</main>}`)
  const assert = (ok, why) => { if (!ok) fail(`virtual React: ${why}`) }
  const until = async (page, expression, why, timeout = 20000) => {
    for (const end = Date.now() + timeout; Date.now() < end; await new Promise(r => setTimeout(r, 80))) if (await page.run(expression)) return
    fail(`virtual React: ${why}`)
  }
  const phone = await openPage(`${local}#/virtual-react-check/A`, { width: 390, height: 844, phone: true })
  try {
    await phone.run(`(async()=>{
      const {createSheet}=await import('/shell/sheet.ts');const host=document.createElement('div');document.body.append(host);
      window.__paintVirtualSheet=createSheet(host);window.__virtualPicked='';
      window.__virtualSheetProps={open:true,title:'Long variants',rows:Array.from({length:120},(_,i)=>({id:'V'+(i+1),label:String(i+1),name:'Variant '+(i+1),on:i===59,picked:i===119,editing:false})),lobby:false,onClose:()=>window.__paintVirtualSheet({...window.__virtualSheetProps,open:false}),onPick:id=>window.__virtualPicked=id,onLobby:()=>{}};
      window.__paintVirtualSheet(window.__virtualSheetProps)
    })()`)
    await until(phone, `!!document.querySelector('[data-virtual-react] button[aria-current=true]')`, 'active phone row was not initially visible')
    assert(await phone.run(`document.querySelectorAll('[data-virtual-react] [data-virtual-index]').length<30`), 'phone mounted the entire list')
    await phone.run(`document.querySelector('[data-virtual-react] button[aria-current=true]').focus()`)
    await phone.key('End')
    await until(phone, `document.activeElement.textContent.includes('Variant 120')`, 'End did not focus an offscreen final row')
    await phone.key('Enter')
    assert(await phone.run(`window.__virtualPicked==='V120' && document.activeElement.textContent.includes('Picked')`), 'offscreen picked row lost its state or selection action')
    await phone.key('Home')
    await until(phone, `document.activeElement.textContent.includes('Variant 1') && !document.activeElement.textContent.includes('Variant 120')`, 'Home did not return to the first row')
    await phone.run(`window.__firstVirtualButton=document.activeElement`)
    await phone.key('ArrowDown')
    await phone.key('ArrowUp')
    assert(await phone.run(`document.activeElement===window.__firstVirtualButton`), 'nearby keyboard movement discarded the cached row')
    await phone.run(`window.__paintVirtualSheet({...window.__virtualSheetProps,open:false})`)
    await until(phone, `!document.querySelector('[data-virtual-react]')`, 'closing left the React list mounted')
    await phone.run(`(async()=>{
      const {createMenuSheet}=await import('/shell/sheet.ts');const host=document.createElement('div');document.body.append(host);window.__paintVirtualMenu=createMenuSheet(host);window.__menuReady=0;window.__menuClean=0;
      window.__virtualMenuProps={open:true,title:'Menu',html:'<div data-menu-virtual-ready>Ready</div>',onClose:()=>{},onContentReady:root=>{if(root.querySelector('[data-menu-virtual-ready]'))window.__menuReady++;return()=>window.__menuClean++}};
      window.__paintVirtualMenu(window.__virtualMenuProps)
    })()`)
    await until(phone, `window.__menuReady===1`, 'menu callback ran before its content committed')
    await phone.run(`window.__paintVirtualMenu({...window.__virtualMenuProps,open:false})`)
    await until(phone, `window.__menuClean===1`, 'closing did not clean up the menu list')
  } finally { phone.close() }

  const page = await openPage(`${local}#/virtual-react-check/A`)
  try {
    await page.run(`(async()=>{
      const {createShare}=await import('/shell/share.ts');window.__virtualShare=createShare();
      window.__virtualShare({title:'Long screenshots',slug:'virtual-react-check',variants:Array.from({length:120},(_,i)=>({id:'V'+(i+1),name:'Variant '+(i+1),hash:i===119?'#/virtual-react-check/B':'#/virtual-react-check/A'})),current:'V120',size:{w:320,h:240},dark:false,onClose:()=>window.__virtualShare(null),returnFocus:()=>null})
    })()`)
    await until(page, `!!document.querySelector('[data-share-variant=V120] canvas')`, 'context target was not visible and prepared')
    assert(await page.run(`document.querySelectorAll('[data-share-variant]').length<12 && document.querySelectorAll('[data-share-tile] canvas').length<24`), 'board eagerly mounted every screenshot')
    await page.run(`document.querySelector('[data-share-close]').focus();document.querySelector('[data-share-scroll]').scrollTop=0`)
    await until(page, `!!document.querySelector('[data-share-variant=V1] canvas')`, 'first section did not prepare after scrolling')
    await page.run(`document.querySelector('[aria-label="Include variant 1"]').click();const input=document.querySelector('[aria-label="Screenshot name for 1"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'First caption');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-share-close]').focus();document.querySelector('[data-share-scroll]').scrollTop=1e9`)
    await until(page, `!!document.querySelector('[data-share-variant=V120]') && !document.querySelector('[data-share-variant=V1]')`, 'scrolling retained every section')
    await page.run(`window.__virtualDownloads=[];window.__virtualBlobs=[];window.__virtualAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__virtualDownloads.push(this.download);window.__virtualBlobs.push(fetch(this.href).then(r=>r.blob()))}else window.__virtualAnchorClick.call(this)};document.querySelector('[data-share-download]').click()`)
    await until(page, `window.__virtualDownloads.length===4 && !document.querySelector('[data-share-download]').disabled`, 'offscreen selected PNGs were omitted from download')
    assert(await page.run(`window.__virtualDownloads.filter(name=>name.includes('first-caption')).length===2 && window.__virtualDownloads.filter(name=>name.includes('-v120-')).length===2`), 'captions or selected offscreen variants were lost')
    const pixels = await page.run(`(async()=>{const sample=async i=>{const bitmap=await createImageBitmap(await window.__virtualBlobs[i]);const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const g=canvas.getContext('2d');g.drawImage(bitmap,-20,-20);return [...g.getImageData(0,0,1,1).data]};return [await sample(0),await sample(2)]})()`)
    assert(pixels[0][0] > 200 && pixels[0][2] < 100 && pixels[1][2] > 200 && pixels[1][0] < 100, 'offscreen exports did not contain their distinct red and blue designs')
    await page.run(`window.__virtualToBlob=HTMLCanvasElement.prototype.toBlob;window.__virtualPngCount=0;HTMLCanvasElement.prototype.toBlob=function(...args){if(++window.__virtualPngCount===2)throw new Error('PNG fixture failure');return window.__virtualToBlob.apply(this,args)};document.querySelector('[data-share-download]').click()`)
    await until(page, `window.__virtualDownloads.length===7 && !document.querySelector('[data-share-download]').disabled`, 'one failed PNG prevented later selected exports')
    assert(await page.run(`document.querySelector('[data-share-board] [role=status]').textContent.includes('1 failed: First caption')`), 'partial export did not identify its failed screenshot')
    await page.run(`HTMLCanvasElement.prototype.toBlob=window.__virtualToBlob`)
    await page.run(`document.querySelector('[data-share-close]').click()`)
    await until(page, `!document.querySelector('[data-share-board]') && !document.querySelector('iframe[title="Screenshot capture"]')`, 'closing retained the board or a pending capture')
  } finally { page.close() }
  console.log('OK: cached React phone rows, keyboard endpoints, menu lifecycle and offscreen screenshot exports')
}
