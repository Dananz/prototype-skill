// The same windowing engine serves native shell rows and React portals.
export async function virtualWindowChecks({local, openPage, fail}) {
  const page = await openPage(local)
  try {
    const result = await page.run(`(async()=>{
  const {VirtualList,virtualHTML}=await import('/shell/virtual.ts')
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:100px auto auto 400px;width:300px;height:200px;overflow:auto';document.body.append(host)
  const items=Array.from({length:500},(_,i)=>({id:String(i),name:'Row '+i}))
  const opts={items,key:x=>x.id,render:(x,i,prev)=>virtualHTML('<button style="height:30px">'+x.name+'</button>',prev),estimate:()=>30,cacheSize:24}
  const list=new VirtualList(opts);list.connect(host);list.refresh()
  const first=host.querySelector('button')
  if(host.querySelectorAll('button').length>14)return 'unbounded initial window'
  host.scrollTop=300;list.refresh();host.scrollTop=0;list.refresh()
  if(host.querySelector('button')!==first)return 'cache did not reuse DOM'
  list.focus(499)
  if(document.activeElement.textContent!=='Row 499')return 'could not focus the final row'
  if(list.entries().length>24)return 'cache grew beyond its cap'
  list.update({...opts,items:items.map(x=>x.id==='499'?{...x,name:'Renamed row'}:x)})
  if(!host.textContent.includes('Renamed row'))return 'cache did not invalidate after an edit'
  list.destroy();host.remove();return 'ok'
 })()`)
    if (result !== 'ok') fail(`virtual window: ${result}`)
    console.log('OK: 500 virtual rows, bounded cache, DOM reuse, offscreen focus and edit invalidation')
  } finally { page.close() }
}
