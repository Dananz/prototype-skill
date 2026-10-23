// Live controls exercise the same React/Vue host registry used by the desktop and phone shell.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function tweaksChecks({ proto, app, local, openPage, fail }) {
  proto(['add', 'tweaks-check', '--title', 'Tweaks checks', '--variants', 'A:Editor,B:Other variant,C:No controls'])
  for (const id of ['A', 'B']) writeFileSync(join(app, 'src/protos/tweaks-check', `${id}.tsx`), `
import { useState } from 'react'
import { useTweaks } from '../../tweaks'
import { useHints } from '../../hints'
export default function Variant() {
  const [accent, setAccent] = useState('${id === 'A' ? '#4f46e5' : '#047857'}')
  const [state, setState] = useState('Full')
  const [long, setLong] = useState(false)
  const [region, setRegion] = useState('North')
  useHints([{kind:'try',text:'Check the project controls'}])
  useTweaks([
    {id:'accent',label:'Accent color ${id}',kind:'color',value:accent,defaultValue:'${id === 'A' ? '#4f46e5' : '#047857'}',set:setAccent},
    {id:'state',label:'Content state ${id}',kind:'select',value:state,defaultValue:'Full',options:['Full','Empty','Loading','Error'],set:setState},
    {id:'long',label:'Long text ${id}',kind:'toggle',value:long,defaultValue:false,set:setLong},
    {id:'region',label:'Region ${id}',kind:'select',value:region,defaultValue:'North',options:['North','South','East','West','International workspace with a long label'],set:setRegion},
  ])
  return <main className="h-full p-8" data-tweak-demo="${id}" data-state={state} data-accent={accent} data-long={long} data-region={region} style={{color:accent}}><h1>{state === 'Empty' ? 'No projects yet' : state === 'Loading' ? 'Loading projects' : state === 'Error' ? 'Projects could not load' : long ? 'A very long project title that wraps across several lines' : 'Your projects'}</h1></main>
}`)
  writeFileSync(join(app, 'src/protos/tweaks-check', 'C.tsx'), `export default function Plain(){return <main className="h-full p-8" data-no-tweaks>No quick controls</main>}`)
  const assert = (ok, why) => { if (!ok) fail(`tweaks: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (page, expression, why) => {
    for (const end = Date.now() + 6000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`tweaks: ${why}`)
  }
  const click = (page, selector) => page.run(`document.querySelector(${JSON.stringify(selector)})?.click()`)
  const design = key => `window.__protoDesign()?.querySelector('[data-tweak-demo]')?.getAttribute('data-${key}')`
  const page = await openPage(`${local}#/tweaks-check/A`)
  try {
    await until(page, `document.querySelector('[data-hint="tab:tweaks"]')?.getAttribute('aria-pressed') === 'true'`, 'desktop inspector did not open for declared controls')
    assert(await page.run(`(async()=>{const {tweaks}=await import('/shell/tweaks.ts');const {hints}=await import('/shell/hints.ts');const host=window.__protoDesign();if(!host || host.ownerDocument===document)return false;window.__pendingTweaks={host,fields:tweaks.of(host),hints:hints.of(host)};tweaks.drop(host);hints.drop(host);return true})()`), 'delayed registry check needs an active device frame')
    await until(page, `!document.querySelector('[data-bar] [data-act=tweaks]') && !document.querySelector('[data-tweak-body] [data-tweak]')`, 'pending frame registration exposes stage controls that cannot receive writes')
    await page.run(`(async()=>{const {tweaks}=await import('/shell/tweaks.ts');const {hints}=await import('/shell/hints.ts');const p=window.__pendingTweaks;hints.set(p.host,p.hints);tweaks.set(p.host,p.fields);delete window.__pendingTweaks})()`)
    await until(page, `!!document.querySelector('[data-tweak-body] [data-tweak=state]')`, 'controls did not return when the device frame registered')
    await click(page, '[data-tweak-body] [data-tweak=state] [data-tweak-option=Empty]')
    await until(page, `${design('state')} === 'Empty'`, 'state did not update the active design in its device frame')
    await click(page, '[data-tweak-body] [data-tweak=accent] [data-tweak-option="#be123c"]')
    await until(page, `${design('accent')} === '#be123c'`, 'color preset did not update the design')
    await click(page, '[data-tweak-body] [data-tweak-input=long]')
    await until(page, `${design('long')} === 'true'`, 'toggle did not update the design')
    assert(await page.run(`(()=>{const tabs=document.querySelector('[data-tabs]');return [...tabs.querySelectorAll('button')].every(b=>b.getBoundingClientRect().right<=tabs.getBoundingClientRect().right)})()`), 'three tabs and their counts clip the panel close button')
    await click(page, '[data-tweak-body] [data-tweak-reset=state]')
    await until(page, `${design('state')} === 'Full'`, 'per-control reset failed')
    assert(await page.run(`${design('accent')} === '#be123c' && ${design('long')} === 'true'`), 'single reset changed unrelated controls')
    await page.run(`(()=>{const i=document.querySelector('[data-tweak-body] select[data-tweak-input=region]');i.value='International workspace with a long label';i.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await until(page, `${design('region')} === 'International workspace with a long label'`, 'long-option select did not update')
    await click(page, '[data-tweak-body] [data-tweak-reset=all]')
    await until(page, `${design('accent')} === '#4f46e5' && ${design('long')} === 'false' && ${design('region')} === 'North'`, 'reset all did not restore declared defaults')
    await click(page, '[data-tweak-body] [data-tweak=state] [data-tweak-option=Empty]')
    await until(page, `${design('state')} === 'Empty'`, 'A did not change before switching variants')
    await page.run(`location.hash='/tweaks-check/B'`)
    await until(page, `${design('accent')} === '#047857' && document.querySelector('[data-tweak-body]').textContent.includes('Content state B')`, 'variant controls or defaults leaked')
    await click(page, '[data-tweak-body] [data-tweak=state] [data-tweak-option=Error]')
    await until(page, `${design('state')} === 'Error'`, 'B did not receive its own write')
    await page.run(`location.hash='/tweaks-check/C'`)
    await until(page, `!!window.__protoDesign()?.querySelector('[data-no-tweaks]') && !document.querySelector('[data-bar] [data-act=tweaks]')`, 'undeclared desktop variant exposes Tweaks')
    await page.run(`location.hash='/tweaks-check'`)
    await until(page, '!document.querySelector("[data-bar] [data-act=tweaks]")', 'overview still exposes one variant’s controls')
  } finally { page.close() }
  const phone = await openPage(`${local}#/tweaks-check/A`, { width: 360, height: 800, phone: true })
  try {
    await until(phone, '!!document.querySelector("[data-pill-bar] [data-act=tweaks]")', 'mobile dock has no Tweaks button')
    assert(await phone.run('document.querySelector("[data-pill-bar]").getBoundingClientRect().right <= innerWidth'), 'dock overflows a 360px phone')
    await click(phone, '[data-pill-bar] [data-act=tweaks]')
    await until(phone, '!!document.querySelector("[data-tweaks-drawer]") && document.querySelector("[data-tweaks-drawer]").getBoundingClientRect().bottom <= document.querySelector("[data-pill-bar]").getBoundingClientRect().top', 'mobile drawer does not end above the dock')
    await click(phone, '[data-tweaks-drawer] [data-tweak=state] [data-tweak-option=Empty]')
    await until(phone, `${design('state')} === 'Empty'`, 'phone control did not update the design')
    await click(phone, '[data-tweaks-close]')
    await until(phone, '!document.querySelector("[data-tweaks-drawer]") && document.activeElement === document.querySelector("[data-pill-bar] [data-act=tweaks]")', 'View preview did not close or restore focus')
    await click(phone, '[data-pill-bar] [data-act=tweaks]')
    await until(phone, '!!document.querySelector("[data-tweaks-drawer]")', 'drawer did not reopen')
    assert(await phone.run(`${design('state')} === 'Empty'`), 'closing the drawer lost values')
    await phone.run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`)
    await until(phone, '!document.querySelector("[data-tweaks-drawer]")', 'Escape did not dismiss')
    assert(await phone.run(`location.hash === '#/tweaks-check/A'`), 'Escape navigated away')
    await click(phone, '[data-pill-bar] [data-act=tweaks]')
    await until(phone, '!!document.querySelector("[data-tweaks-drawer]")', 'drawer did not reopen before navigation')
    await phone.run(`location.hash='/tweaks-check/B'`)
    await until(phone, '!document.querySelector("[data-tweaks-drawer]") && '+design('accent')+` === '#047857'`, 'navigation left the previous drawer active')
    await phone.run(`location.hash='/tweaks-check/C'`)
    await until(phone, `!!window.__protoDesign()?.querySelector('[data-no-tweaks]') && !document.querySelector('[data-pill-bar] [data-act=tweaks]')`, 'undeclared phone variant exposes Tweaks')
  } finally { phone.close() }
  proto(['add', 'tweaks-phone-check', '--title', 'Phone Tweaks checks', '--kind', 'phone', '--variants', 'A:Editor,B:Other variant'])
  for (const id of ['A', 'B']) writeFileSync(join(app, 'src/protos/tweaks-phone-check', `${id}.tsx`), readFileSync(join(app, 'src/protos/tweaks-check', `${id}.tsx`)))
  const phoneKind = await openPage(`${local}#/tweaks-phone-check/A`)
  try {
    await until(phoneKind, `document.querySelector('[data-hint="tab:tweaks"]')?.getAttribute('aria-pressed') === 'true'`, 'phone-kind desktop inspector did not open')
    for (const [tab, variant] of [['try', 'B'], ['tweaks', 'A']]) {
      await click(phoneKind, `[data-hint="tab:${tab}"]`)
      await phoneKind.run(`location.hash='/tweaks-phone-check/${variant}'`)
      await until(phoneKind, `window.__protoDesign()?.querySelector('[data-tweak-demo]')?.getAttribute('data-tweak-demo') === '${variant}' && document.querySelector('[data-tweak-body]').textContent.includes('Content state ${variant}')`, 'phone-kind navigation did not finish registering controls')
      assert(await phoneKind.run(`document.querySelector('[data-hint="tab:${tab}"]')?.getAttribute('aria-pressed') === 'true'`), 'phone-kind navigation stole the selected ' + tab + ' tab')
    }
  } finally { phoneKind.close() }
  console.log('\nOK: Tweaks inspector and mobile dock drawer update, reset and scope controls')
}
