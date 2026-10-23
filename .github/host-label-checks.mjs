// Session identity reaches already mounted desktop and phone controls through session.json HMR.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export async function hostLabelChecks({ proto, app, local, openPage, fail }) {
  proto(['add', 'hostfx', '--title', 'Host labels', '--variants', 'A:Preview'])
  const original = process.env.PROTO_AGENT
  const as = agent => { process.env.PROTO_AGENT = agent; proto(['url']) }
  try {
    for (const phone of [false, true]) {
      as('agent')
      const page = await openPage(`${local}?theme=light#/hostfx/A`, phone ? { width: 390, height: 844, phone: true } : {})
      try {
        const batch = await page.run(`(async () => {
          const res = await fetch('/__proto/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: 'light', viewport: { w: innerWidth, h: innerHeight, phone: innerWidth < 640 }, comments: [{ route: 'hostfx/A', text: 'Pending feedback' }] }) })
          const b = await res.json()
          localStorage.setItem('proto-comments-smoke', JSON.stringify({ items: [
            { id: 'host-sent', proto: 'hostfx', variant: 'A', n: 1, body: ['Pending feedback'], tags: [], at: Date.now(), sent: { batch: b.sent, i: 1 } },
            { id: 'host-draft', proto: 'hostfx', variant: 'A', n: 2, body: ['Draft stays here'], tags: [], at: Date.now() }
          ], held: null }))
          return b.sent
        })()`)
        proto(['inbox'])
        proto(['reply', `${batch}/1`, 'Earlier Claude reply', '--as', 'claude'])
        await page.run('location.reload()')
        const ready = await page.run(`(async () => { for (let end = Date.now() + 6000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (document.documentElement.dataset.ready === '1' && document.querySelector('[data-shoot=island-open]')) return true; return false })()`)
        if (!ready) fail('host controls never mounted')
        // The comments island's count opens the list: above it on a wide screen, as a sheet on a phone.
        await page.run(`document.querySelector('[data-shoot=island-open]').click()`)
        await page.run(`window.__hostSentinel = 'same page'`)
        for (const [agent, name] of [['codex', 'Codex'], ['claude', 'Claude'], ['agent', 'Agent'], ['codex', 'Codex']]) {
          as(agent)
          const result = await page.run(`(async () => {
            const name = ${JSON.stringify(name)}
            for (let end = Date.now() + 6000; Date.now() < end; await new Promise(r => setTimeout(r, 50))) {
              const send = document.querySelector('[data-shoot="send"]')
              const group = document.querySelector('section[aria-label="With ' + name + '"]')
              if ((send?.textContent + ' ' + send?.title).includes('Send 1 to ' + name) && group && document.body.textContent.includes(name + ' sees these on its next turn')) {
                if (window.__hostSentinel !== 'same page') return 'host change reloaded the page'
                if (!document.body.textContent.includes('Draft stays here')) return 'draft lost'
                if (!group.querySelector('[title="Claude"]')) return 'historical reply author changed'
                if (document.querySelector('vite-error-overlay')) return 'Vite error'
                return 'ok'
              }
            }
            return 'labels did not update to ' + name
          })()`)
          if (result !== 'ok') fail(`${phone ? 'phone' : 'desktop'} host: ${result}`)
          if (JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).agent !== agent) fail('session host did not persist')
        }
        proto(['reply', batch, '--done'])
      } finally { page.close() }
    }
  } finally {
    if (original === undefined) delete process.env.PROTO_AGENT; else process.env.PROTO_AGENT = original
    proto(['url'])
    proto(['archive', 'hostfx'])
  }
  console.log('\nOK: desktop and phone host labels update without reloading or changing drafts and reply authors')
}
