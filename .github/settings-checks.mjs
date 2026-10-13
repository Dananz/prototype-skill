// Preferences are exercised through the dialog, then through the shell and a reload.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function settingsChecks({ proto, app, local, openPage, fail }) {
  const page = await openPage(local)
  const assert = (ok, why) => { if (!ok) fail(`settings: ${why}`) }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (expression, why) => {
    for (const end = Date.now() + 5000; Date.now() < end; await wait(50)) if (await page.run(expression)) return
    fail(`settings: ${why}`)
  }
  const click = selector => page.run(`document.querySelector(${JSON.stringify(selector)})?.click()`)
  const open = async () => {
    await click('[data-act=settings]')
    await until('!!document.querySelector("[data-settings-dialog]")', 'Settings did not open')
  }
  try {
    await open()
    assert(await page.run('localStorage.getItem("proto-theme") === null && document.querySelector("[data-setting-theme=system]").getAttribute("aria-pressed") === "true"'), 'a fresh browser does not default to system appearance')
    await until('document.querySelector("[data-settings-dialog]")?.contains(document.activeElement)', 'focus is outside the dialog')
    await click('[data-shoot=send-live] input')
    assert(await page.run('localStorage.getItem("proto-comments-live") === "1"'), 'automatic comment sending was not saved')
    await click('[data-setting-theme=dark]')
    await until('document.documentElement.classList.contains("dark")', 'dark appearance did not apply')
    await click('[data-setting-theme=system]')
    assert(await page.run('localStorage.getItem("proto-theme") === "system"'), 'system appearance was not saved')
    await click('[data-setting=sidebar] input')
    await click('[data-setting=review] input')
    await click('[data-setting-layout=stack]')
    assert(await page.run('document.querySelector("[data-setting-layout=stack]").getAttribute("aria-pressed") === "true"'), 'overview choice stayed stale after selecting List')
    assert(await page.run('localStorage.getItem("proto-side") === "0" && localStorage.getItem("proto-hints") === "0" && localStorage.getItem("proto-lobby") === "stack"'), 'browsing preferences were not saved')
    await click('[data-settings-tab=shortcuts]')
    await until('document.querySelector("[data-settings-dialog]").textContent.includes("Send draft comments")', 'shortcuts tab is empty')
    const hash = await page.run('location.hash')
    await page.key('Escape')
    await until('!document.querySelector("[data-settings-dialog]")', 'Escape did not close Settings')
    assert(await page.run('location.hash') === hash, 'Escape navigated away from the current place')
    assert(await page.run('document.activeElement?.dataset.act === "settings"'), 'closing did not restore focus to Settings')
    await page.run('location.reload()')
    await until('!!document.querySelector("[data-act=settings]")', 'reload did not finish')
    await open()
    assert(await page.run('localStorage.getItem("proto-theme") === "system"'), 'startup replaced system appearance with a fixed theme')
    assert(await page.run('document.querySelector("[data-shoot=send-live] input").checked && !document.querySelector("[data-setting=sidebar] input").checked && !document.querySelector("[data-setting=review] input").checked && document.querySelector("[data-setting-layout=stack]").getAttribute("aria-pressed") === "true"'), 'preferences did not survive reload')
    await click('[data-settings-close]')
    await until('!document.querySelector("[data-settings-dialog]")', 'close button did not dismiss Settings')
    await open()
    await page.press(20, 20)
    await until('!document.querySelector("[data-settings-dialog]")', 'backdrop did not dismiss Settings')
    await page.run('localStorage.clear()')
  } finally { page.close() }

  proto(['add', 'settingsfx', '--title', 'Settings focus', '--variants', 'A:Page'])
  writeFileSync(join(app, 'src/protos/settingsfx/A.tsx'), 'export default function Page() { return <main><input aria-label="Keep these words" defaultValue="Initial" /></main> }')
  proto(['done', 'settingsfx'])
  const focus = await openPage(`${local}#/settingsfx/A`)
  try {
    await focus.run(`document.querySelector('[data-act=focus]').click()`)
    await wait(300)
    await focus.run(`document.querySelector('[data-overlay] [data-act=settings]').click()`)
    await wait(200)
    await focus.key('Escape')
    await wait(200)
    assert(await focus.run(`document.activeElement?.closest('[data-overlay]') !== null && document.activeElement?.dataset.act === 'settings'`), 'focus did not return to the focus dock')
    assert(await focus.run(`getComputedStyle(document.querySelector('[data-zone]')).position === 'fixed'`), 'closing Settings left focus mode')
    await focus.run(`document.querySelector('[data-act=unfocus]').click(); document.querySelector('[data-act="size:phone"]').click()`)
    for (const end = Date.now() + 5000; Date.now() < end; await wait(50)) {
      if (await focus.run(`!!document.querySelector('[data-view] iframe')?.contentWindow?.__protoTheme`)) break
    }
    await focus.appearance('light')
    await focus.run(`document.querySelector('[data-act=settings]').click()`)
    await wait(200)
    await focus.run(`document.querySelector('[data-setting-theme=system]').click(); document.querySelector('[data-settings-close]').click()`)
    await wait(200)
    assert(await focus.run(`(() => { const w = document.querySelector('[data-view] iframe')?.contentWindow; const input = w?.document.querySelector('input'); if (!input) return false; input.value = 'Keep these words'; w.__settingsInput = input; return true })()`), 'device-view form did not mount')
    await focus.appearance('dark')
    await wait(300)
    assert(await focus.run(`(() => { const w = document.querySelector('[data-view] iframe')?.contentWindow; return document.documentElement.classList.contains('dark') && w?.document.documentElement.classList.contains('dark') && w.__settingsInput === w.document.querySelector('input') && w.__settingsInput.value === 'Keep these words' })()`), 'system appearance lost the device-view input state')
    await focus.run(`document.querySelector('[data-act=settings]').click()`)
    await wait(200)
    await focus.run(`document.querySelector('[data-setting-theme=light]').click(); document.querySelector('[data-settings-close]').click()`)
    await wait(200)
    assert(await focus.run(`(() => { const w = document.querySelector('[data-view] iframe').contentWindow; return !w.document.documentElement.classList.contains('dark') && new URL(w.location.href).searchParams.get('theme') === 'light' && w.__settingsInput === w.document.querySelector('input') })()`), 'manual appearance lost state or left an old frame theme URL')
    await focus.run(`document.querySelector('[data-view] iframe').contentWindow.location.reload()`)
    await wait(1000)
    assert(await focus.run(`!document.querySelector('[data-view] iframe').contentDocument.documentElement.classList.contains('dark')`), 'frame reload restored an old theme')
  } finally { focus.close() }
  proto(['archive', 'settingsfx'])
  console.log('Settings dialog, keyboard focus and persistent preferences passed')
}
