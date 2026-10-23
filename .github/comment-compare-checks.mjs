// Real Compare panes share one native comment store, with independent target routes and @ mentions.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentCompareChecks({ proto, app, openPage, fail }) {
  proto(['add', 'comparefx', '--title', 'Compare comments', '--variants', 'A:Focus,B:Board,C:Calendar'])
  for (const variant of ['A', 'B', 'C']) writeFileSync(join(app, 'src/protos/comparefx', `${variant}.tsx`), `import {useState} from 'react';export default function Design(){const [open,setOpen]=useState(false);return <main style={{padding:24}}><button data-shoot="shared" style={{width:180,height:64}}>Shared selector ${variant}</button><div style={{height:280}}/><button data-shoot="unique-${variant}" style={{width:180,height:64}}>Only in ${variant}</button><button data-shoot="detail-opener" onClick={()=>setOpen(true)}>Show details</button>{open&&<div data-opened-by="[data-shoot=detail-opener]"><button data-shoot="detail">Hidden details ${variant}</button></div>}</main>}`)
  const metaPath=join(app,'src/protos/comparefx/meta.ts')
  const meta=JSON.parse(readFileSync(metaPath,'utf8').replace(/^[\s\S]*?export default /,''))
  meta.states=[{id:'details',name:'Details',only:['A'],click:['[data-shoot=detail-opener]']}]
  writeFileSync(metaPath,'export default '+JSON.stringify(meta))
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const helpers = `
    const until = async f => { for (const end = Date.now() + 6000; Date.now() < end; await new Promise(r => setTimeout(r, 30))) if (f()) return true; return false }
    const c = document.__prototypeComments
    const editor = () => document.querySelector('[data-composer] [role=textbox]')
    const type = text => { const e=editor(); e.textContent=text; e.focus(); const r=document.createRange(); r.setStart(e.firstChild,text.length);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text})) }
    const button = text => [...document.querySelectorAll('[data-composer] button')].find(b=>b.textContent.trim()===text)
  `
  const page = await openPage(`${local}comparefx/A?theme=light`, { width: 1440, height: 1000 })
  try {
    const ready = await page.run(`(async()=>{${helpers}
      if(!await until(()=>c?.store.get().place?.variant==='A'))return 'single A did not become ready'
      location.hash='#/comparefx/A/~compare'
      if(!await until(()=>document.querySelector('[data-comment-compare] [data-route="comparefx/B"] [data-shoot=shared]')&&c?.store.get().place?.compare))return 'Compare never became commentable'
      c.referenceOnPress(()=>false)()
      c.referenceComments(()=>false)()
      document.querySelector('[data-act="comment:toggle"]').click()
      return 'ok'
    })()`)
    if (ready !== 'ok') fail(`compare comments: ${ready}`)
    const at = await page.run(`(()=>{const r=document.querySelector('[data-comment-compare] [data-route="comparefx/B"] [data-shoot=shared]').getBoundingClientRect();return {x:r.left+40,y:r.top+40}})()`)
    await page.press(at.x, at.y)
    const begin = await page.run(`(async()=>{${helpers}
      if(!await until(editor))return 'native picker did not open the composer'
      if(c.store.get().mode.target.source?.variant!=='B')return 'B pick lost its source route'
      type('Bring the unmatched element here: @foc')
      if(!await until(()=>document.querySelectorAll('[data-tag-menu] [role=option]').length===1))return '@ filter did not find Focus'
      return document.querySelector('[data-tag-menu] [role=option]').textContent.includes('@1')?'ok':'filter offered wrong variant'
    })()`)
    if (begin !== 'ok') fail(`compare comments: ${begin}`)
    await page.key('Enter')
    const mention = await page.run(`(async()=>{${helpers}
      if(!await until(()=>c.store.get().held?.tags[0]?.variantRef?.variant==='A'))return 'Enter did not insert @1'
      const e=document.querySelector('[data-comment-compare] [data-route="comparefx/A"] [data-shoot=unique-A]'),r=e.getBoundingClientRect()
      return {x:r.left+30,y:r.top+30}
    })()`)
    if (!mention?.x) fail(`compare comments: ${mention}`)
    await page.press(mention.x, mention.y)
    const saved = await page.run(`(async()=>{${helpers}
      if(!await until(()=>c.store.get().held?.tags.some(t=>t.shoot==='unique-A'&&t.source?.variant==='A')))return 'cross-pane press did not tag the unmatched A element'
      if(!editor().textContent.includes('@1'))return 'reference insertion lost the @ mention'
      if(!await until(()=>button('Add')&&!button('Add').disabled))return 'Add did not become enabled'
      button('Add').click()
      if(!await until(()=>c.store.get().items.length===1))return 'Add did not save'
      const i=c.store.get().items[0]
      if(i.variant!=='B'||i.target.source?.variant!=='B')return 'comment saved under A instead of destination B'
      const {find}=await import('/shell/comments/dom.ts')
      const {capture}=await import('/shell/comments/shot.tsx')
      if(!(await capture(c.mount(),i.target,false))?.startsWith('data:image/png'))return 'camera did not capture B inside Compare'
      if(find(c.mount(),i.target)?.textContent!=='Shared selector B')return 'identical selector resolved into wrong pane'
      if(!await until(()=>document.querySelector('[data-comments] [data-comment="'+i.id+'"]')))return 'B comment pin missing'
      if(!document.querySelector('[data-comments] [data-comment="'+i.id+'"]')?.textContent.includes('B1'))return 'pin does not identify variant B'
      document.querySelector('[data-act="compare-comment:A"]').click()
      if(!await until(editor))return 'pane Comment did not open native composer'
      type('A comment')
      if(!await until(()=>button('Add')&&!button('Add').disabled))return 'Add did not become enabled'
      button('Add').click()
      if(!await until(()=>c.store.get().items.length===2))return 'A comment missing'
      return 'ok'
    })()`)
    if (saved !== 'ok') fail(`compare comments: ${saved}`)
    const linked = await page.run(`(async()=>{${helpers}
      const a=c.store.get().items.find(i=>i.variant==='A'),b=c.store.get().items.find(i=>i.variant==='B')
      c.act.open(b.id,false)
      if(!await until(editor))return 'B draft did not reopen'
      c.act.open(a.id)
      if(!await until(()=>editor()?.textContent.includes('Comment 1')))return 'source comment did not become a reference'
      button('Save')?.click()
      if(!await until(()=>!editor()))return 'editing did not save'
      c.act.send()
      if(!await until(()=>c.store.get().items.every(i=>i.sent)))return 'native send did not finish'
      return {batch:c.store.get().items.find(i=>i.variant==='B').sent.batch,items:c.store.get().items.map(i=>({id:i.id,variant:i.variant,sent:i.sent}))}
    })()`)
    if (!linked?.batch) fail(`compare comments: ${linked}`)
    const inbox = proto(['inbox'])
    if (!inbox.includes('comparefx/B') || !inbox.includes('with @1: variant comparefx/A (#1)') || !inbox.includes('comparefx/A ·') || !inbox.includes('with comment 1: comparefx/A')) fail('compare comments: inbox lost destination, variant, element or comment reference metadata')
    const b = linked.items.find(i=>i.variant==='B')
    proto(['reply', `${b.sent.batch}/${b.sent.i}`, 'Verified shared Compare thread', '--done'])
    const replied = await page.run(`(async()=>{${helpers}
      if(!await until(()=>c.store.get().inbox?.batches.some(b=>b.comments.some(i=>i.reply?.text==='Verified shared Compare thread'))))return 'native panel did not receive agent reply'
      location.hash='#/comparefx/A'
      if(!await until(()=>!document.querySelector('[data-comment-compare]')&&document.querySelector('[data-view] iframe')))return 'single variant did not return'
      if(c.store.get().place?.compare)return 'leaving Compare kept compare enabled'
      if(c.store.get().items.find(i=>i.variant==='B').tags[0].variantRef.variant!=='A')return 'navigation lost mention metadata'
      c.act.revealTarget({label:'Element',selector:'[data-shoot=detail]',shoot:'detail',tag:'button',text:'Hidden details A',rect:{x:0,y:0,w:1,h:1},source:{proto:'comparefx',variant:'A',state:'details'},route:['[data-shoot=detail-opener]']})
      if(!await until(()=>location.pathname === '/comparefx/A/details'&&document.querySelector('[data-view] iframe')?.contentDocument.querySelector('[data-shoot=detail]')))return 'reference dropped its state or did not reveal the hidden destination'
      location.hash='#/comparefx/A/~compare/details'
      if(!await until(()=>c.store.get().place?.compare&&document.querySelector('[data-comment-compare] [data-route="comparefx/A"]')?.dataset.commentState==='details'))return 'state did not return to Compare'
      document.querySelector('[data-act="compare-comment:A"]').click()
      if(!await until(()=>editor()&&c.store.get().mode.target?.source?.state==='details'))return 'pane Comment ignored its displayed state'
      return 'ok'
    })()`)
    if (replied !== 'ok') fail(`compare comments: ${replied}`)
  } finally { page.close() }
  const phone = await openPage(`${local}comparefx/A/~compare?theme=light`, { width:390, height:844, phone:true })
  try {
    const result = await phone.run(`(async()=>{${helpers}
      if(!await until(()=>c?.store.get().place?.compare&&document.querySelector('[data-act="compare-comment:B"]')))return 'phone Compare unavailable'
      document.querySelector('[data-act="compare-comment:B"]').click()
      if(!await until(editor))return 'phone pane button did not open composer'
      type('Use @')
      if(!await until(()=>document.querySelector('[data-tag-menu]')))return 'phone @ menu missing'
      const r=document.querySelector('[data-tag-menu]').getBoundingClientRect()
      if(r.left<0||r.right>390||r.bottom>844)return 'phone @ menu clipped'
      document.querySelector('[data-tag-menu] [role=option]').click()
      if(!await until(()=>c.store.get().held?.tags[0]?.variantRef.variant==='A'))return 'phone mention lost metadata'
      if(!await until(()=>button('Add')&&!button('Add').disabled))return 'Add did not become enabled'
      button('Add').click()
      if(!await until(()=>c.store.get().items.length===1))return 'phone save failed'
      c.show()
      if(!await until(()=>c.store.get().sheet))return 'shared phone Comments sheet missing'
      return 'ok'
    })()`)
    if (result !== 'ok') fail(`compare comments: ${result}`)
  } finally { phone.close() }
  proto(['archive', 'comparefx'])
  console.log('\nOK: native Compare comments, independent target routes, @ variants, cross-pane elements/threads, transport, agent reply and phone menu')
}
