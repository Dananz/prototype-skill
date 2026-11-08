// The owner on their own link: signed in as the account that shared it (api/me says mine), the header
// reads "Your link · version N" and Edit stands where Fork does, with the command that reopens the
// prototype on the owner's Mac. Anyone else signed in still sees Fork and "Shared by". Desktop, a
// phone and Hebrew. keepShots: a folder for the PR's screenshots. before: shots only, no asserts
// (run against the code before the change).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildShare } from '../app/share/build.mjs'
import { host } from './share-link-checks.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(get, ms = 10_000) {
  const end = Date.now() + ms
  for (;;) {
    try { const v = await get(); if (v) return v } catch {}
    if (Date.now() > end) return null
    await sleep(100)
  }
}

export async function ownerLinkChecks({ proto, app, openPage, fail, keepShots = '', before = false }) {
  const assert = (ok, why) => { if (!before && !ok) fail(`owner link: ${why}`) }
  proto(['add', 'owner-link', '--title', 'Pricing page', '--variants', 'A:Calm,B:Bold'])
  for (const [id, tone, price] of [['A', 'bg-white text-zinc-900', 12], ['B', 'bg-zinc-900 text-white', 19]]) {
    writeFileSync(join(app, 'src/protos/owner-link', `${id}.tsx`), `export default function ${id}() {
  return (
    <main className="min-h-[640px] ${tone} p-10 font-sans">
      <h1 className="text-3xl font-semibold">Pricing</h1>
      <p className="mt-2 opacity-70">Plans for every team.</p>
      <div className="mt-8 grid grid-cols-3 gap-4">
        {['Starter', 'Team', 'Business'].map(n => <div key={n} className="rounded-xl border border-zinc-500/30 p-5"><p className="font-medium">{n}</p><p className="mt-6 text-2xl font-semibold">$${price}</p></div>)}
      </div>
    </main>
  )
}
`)
  }
  const shot = async (page, name) => { if (keepShots) { await sleep(500); await page.screenshot(join(keepShots, `${name}.png`)) } }
  const scope = { protos: [{ id: 'owner-link', variants: ['A', 'B'] }], start: 'owner-link/A' }
  const sessionFile = join(app, 'session.json')
  const build = async lang => {
    const was = readFileSync(sessionFile, 'utf8')
    writeFileSync(sessionFile, JSON.stringify({ ...JSON.parse(was), lang }, null, 2) + '\n')
    try { return (await buildShare({ sessionDir: app, scope, info: { title: 'Pricing page', owner: 'Smoke', version: 3, fork: true } })).html } finally { writeFileSync(sessionFile, was) }
  }
  for (const lang of ['en', 'he']) {
    const site = await host(await build(lang))
    site.state.version = 3
    const url = `${site.url}s/smk123/`
    try {
      for (const [who, phone] of [['octo-smoke', false], ['owner-smoke', false], ['owner-smoke', true]]) {
        if (lang === 'he' && phone) continue
        const page = await openPage(url, phone ? { width: 390, height: 844, phone: true } : { width: 1280, height: 800 })
        try {
          await page.run(`document.cookie = 'v=${who}; path=/s/smk123/'; location.reload()`)
          await sleep(500)
          await until(() => page.run(`!!document.querySelector('[data-account]')`))
          const mine = who === 'owner-smoke'
          const header = await page.run(`document.querySelector('[data-viewer-header]')?.innerText ?? ''`)
          const edit = await page.run(`!!document.querySelector('[data-yours]')`), fork = await page.run(`!!document.querySelector('[data-fork]')`)
          assert(edit === mine && fork === !mine, `${lang} ${who}: Edit ${edit}, Fork ${fork}`)
          if (!phone) assert(mine ? header.includes(lang === 'he' ? 'הקישור שלך · גרסה 3' : 'Your link · version 3') : !/Your link|הקישור שלך/.test(header), `${lang} ${who}: the header reads ${JSON.stringify(header)}`)
          const tag = `${lang}-${mine ? 'owner' : 'viewer'}${phone ? '-phone' : ''}`
          await shot(page, tag)
          const button = mine && edit ? 'data-yours' : fork ? 'data-fork' : ''
          if (button) {
            await page.run(`document.querySelector('[${button}]').click()`)
            const command = await until(() => page.run(`document.querySelector('[${button}-command]')?.textContent ?? ''`))
            if (mine) assert(command === `/prototype edit ${url}`, `${lang}: Edit offers ${JSON.stringify(command)}`)
            await shot(page, `${tag}-open`)
          }
        } finally { page.close() }
      }
    } finally { site.close() }
  }
}
