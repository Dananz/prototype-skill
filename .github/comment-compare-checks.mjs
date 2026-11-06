// Variants side by side (chosen in the tree) share one native comment store, with independent target routes and @ mentions.
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
    // Cmd-clicks on the tree's rows, as a reviewer chooses them (the variant on screen comes along).
    const row = v => document.querySelector('[data-mv="comparefx:'+v+'"] > button:not([aria-expanded]):not([data-act])')
    const choose = async (...vs) => { for (const v of vs) { if(!await until(()=>row(v)))return false; row(v).dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:true,ctrlKey:true})) } return true }
  `
  const page = await openPage(`${local}comparefx/A?theme=light&tree=1`, { width: 1440, height: 1000 })
  try {
    const ready = await page.run(`(async()=>{${helpers}
      if(!await until(()=>c?.store.get().place?.variant==='A'))return 'single A did not become ready'
      if(!await choose('B'))return 'the tree has no row for B'
      if(!await until(()=>document.querySelector('[data-comment-compare] [data-route="comparefx/B"] [data-shoot=shared]')&&c?.store.get().place?.compare))return 'side by side never became commentable: '+document.querySelectorAll('[data-tree-chosen]').length+' rows chosen, view '+!!document.querySelector('[data-comment-compare]')
      c.referenceOnPress(()=>false)()
      c.referenceComments(()=>false)()
      document.querySelector('[data-act="comment:toggle"]').click()
      return 'ok'
    })()`)
    if (ready !== 'ok') fail(`side-by-side comments: ${ready}`)
    const at = await page.run(`(()=>{const r=document.querySelector('[data-comment-compare] [data-route="comparefx/B"] [data-shoot=shared]').getBoundingClientRect();return {x:r.left+40,y:r.top+40}})()`)
    await page.press(at.x, at.y)
    const begin = await page.run(`(async()=>{${helpers}
      if(!await until(editor))return 'native picker did not open the composer'
      if(c.store.get().mode.target.source?.variant!=='B')return 'B pick lost its source route'
      type('Bring the unmatched element here: @foc')
      // The shelf searches the whole project, so other matches may follow: the nearest one comes first.
      const first=()=>document.querySelector('[data-tag-menu] [role=option]')
      if(!await until(()=>first()?.textContent.includes('Focus')))return '@ filter did not find Focus, offered: '+[...document.querySelectorAll('[data-tag-menu] [role=option]')].map(o=>o.textContent).join(' | ')
      return first().textContent.includes('#1')&&first().dataset.shelfCard.startsWith('comparefx')?'ok':'filter put the wrong variant first: '+first().dataset.shelfCard
    })()`)
    if (begin !== 'ok') fail(`side-by-side comments: ${begin}`)
    await page.key('Enter')
    const mention = await page.run(`(async()=>{${helpers}
      if(!await until(()=>c.store.get().held?.tags[0]?.variantRef?.proto==='comparefx'&&c.store.get().held.tags[0].variantRef.variant==='A'))return 'Enter did not insert Focus #1'
      const e=document.querySelector('[data-comment-compare] [data-route="comparefx/A"] [data-shoot=unique-A]'),r=e.getBoundingClientRect()
      return {x:r.left+30,y:r.top+30}
    })()`)
    if (!mention?.x) fail(`side-by-side comments: ${mention}`)
    await page.press(mention.x, mention.y)
    const saved = await page.run(`(async()=>{${helpers}
      if(!await until(()=>c.store.get().held?.tags.some(t=>t.shoot==='unique-A'&&t.source?.variant==='A')))return 'cross-pane press did not tag the unmatched A element'
      if(!editor().textContent.includes('@Focus #1'))return 'reference insertion lost the @ mention'
      if(!await until(()=>button('Add')&&!button('Add').disabled))return 'Add did not become enabled'
      button('Add').click()
      if(!await until(()=>c.store.get().items.length===1))return 'Add did not save'
      const i=c.store.get().items[0]
      if(i.variant!=='B'||i.target.source?.variant!=='B')return 'comment saved under A instead of destination B'
      const {find}=await import('/shell/comments/dom.ts')
      const {capture}=await import('/shell/comments/shot.tsx')
      if(!(await capture(c.mount(),i.target,false))?.startsWith('data:image/png'))return 'camera did not capture B side by side'
      if(find(c.mount(),i.target)?.textContent!=='Shared selector B')return 'identical selector resolved into wrong pane'
      if(!await until(()=>document.querySelector('[data-comments] [data-comment="'+i.id+'"]')))return 'B comment pin missing'
      if(!document.querySelector('[data-comments] [data-comment="'+i.id+'"]')?.textContent.includes('B1'))return 'pin does not identify variant B'
      return 'ok'
    })()`)
    if (saved !== 'ok') fail(`side-by-side comments: ${saved}`)
    // Select picks in either pane: an element in A is a comment on A.
    const inA = await page.run(`(()=>{const r=document.querySelector('[data-comment-compare] [data-route="comparefx/A"] [data-shoot=unique-A]').getBoundingClientRect();return {x:r.left+30,y:r.top+30}})()`)
    await page.run(`(()=>{const c=document.__prototypeComments;if(c.store.get().mode.kind!=='pick')c.act.toggle();return true})()`)
    await page.press(inA.x, inA.y)
    const savedA = await page.run(`(async()=>{${helpers}
      if(!await until(editor))return 'a press in pane A did not open the composer'
      if(c.store.get().mode.target.source?.variant!=='A')return 'A pick lost its source route'
      type('A comment')
      if(!await until(()=>button('Add')&&!button('Add').disabled))return 'Add did not become enabled'
      button('Add').click()
      if(!await until(()=>c.store.get().items.length===2))return 'A comment missing'
      if(c.store.get().items.find(i=>i.variant==='A')?.target.shoot!=='unique-A')return 'A comment lost its element'
      return 'ok'
    })()`)
    if (savedA !== 'ok') fail(`side-by-side comments: ${savedA}`)
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
    if (!linked?.batch) fail(`side-by-side comments: ${linked}`)
    const inbox = proto(['inbox'])
    if (!inbox.includes('comparefx/B') || !inbox.includes('with @1: variant comparefx/A (#1)') || !inbox.includes('comparefx/A ·') || !inbox.includes('with comment 1: comparefx/A')) fail('side-by-side comments: inbox lost destination, variant, element or comment reference metadata')
    const b = linked.items.find(i=>i.variant==='B')
    proto(['reply', `${b.sent.batch}/${b.sent.i}`, 'Verified shared side-by-side thread', '--done'])
    const replied = await page.run(`(async()=>{${helpers}
      if(!await until(()=>c.store.get().inbox?.batches.some(b=>b.comments.some(i=>i.reply?.text==='Verified shared side-by-side thread'))))return 'native panel did not receive agent reply'
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      if(!await until(()=>!document.querySelector('[data-comment-compare]')&&document.querySelector('[data-view] iframe')))return 'single variant did not return'
      if(c.store.get().place?.compare)return 'letting go of the selection kept side by side on'
      const kept=c.store.get().items.find(i=>i.variant==='B').tags[0].variantRef
      if(kept.variant!=='A'||kept.title!=='Compare comments')return 'navigation lost mention metadata'
      c.act.revealTarget({label:'Element',selector:'[data-shoot=detail]',shoot:'detail',tag:'button',text:'Hidden details A',rect:{x:0,y:0,w:1,h:1},source:{proto:'comparefx',variant:'A',state:'details'},route:['[data-shoot=detail-opener]']})
      if(!await until(()=>location.pathname === '/comparefx/A/details'&&document.querySelector('[data-view] iframe')?.contentDocument.querySelector('[data-shoot=detail]')))return 'reference dropped its state or did not reveal the hidden destination'
      if(!await choose('B'))return 'the tree has no row for B'
      if(!await until(()=>c.store.get().place?.compare&&document.querySelector('[data-comment-compare] [data-route="comparefx/A"]')?.dataset.commentState==='details'))return 'the state did not carry into side by side'
      if(document.querySelector('[data-comment-compare] [data-route="comparefx/B"]')?.dataset.commentState)return 'B, which has no such state, was shown in it'
      return 'ok'
    })()`)
    if (replied !== 'ok') fail(`side-by-side comments: ${replied}`)
    // A press inside A, in its displayed state, keeps that state on the comment.
    const det = await page.run(`(async()=>{${helpers}
      const q=()=>document.querySelector('[data-comment-compare] [data-route="comparefx/A"] [data-shoot=detail]')
      if(!await until(q))return null
      const r=q().getBoundingClientRect();return {x:r.left+10,y:r.top+8}
    })()`)
    if (!det) fail('side-by-side comments: A in its details state did not show the hidden button')
    await page.run(`(()=>{const c=document.__prototypeComments;if(c.store.get().mode.kind!=='pick')c.act.toggle();return true})()`)
    await page.press(det.x, det.y)
    const stated = await page.run(`(async()=>{${helpers}
      if(!await until(()=>editor()&&c.store.get().mode.target?.source?.state==='details'))return 'a pane comment ignored its displayed state'
      return 'ok'
    })()`)
    if (stated !== 'ok') fail(`side-by-side comments: ${stated}`)
  } finally { page.close() }
  proto(['archive', 'comparefx'])
  console.log('\nOK: side-by-side comments, independent target routes, @ variants, cross-pane elements/threads, transport and agent reply')
}
