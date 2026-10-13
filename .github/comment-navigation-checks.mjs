// Exercise navigation readiness and selection cancellation through the real comment actions.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export async function commentNavigationChecks({ app, openPage, fail }) {
  const local = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).localUrl
  const page = await openPage(`${local}?theme=light#/routefx/A`)
  try {
    const result = await page.run(`(async () => {
      const { createActions } = await import('/shell/comments/actions.ts')
      const { createStore } = await import('/shell/comments/store.ts')
      const until = async (f, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 40))) if (f()) return true; return false }
      const mount = document.createElement('main')
      mount.dataset.route = 'navfx/B'
      document.body.append(mount)
      let current = null, delay = 1200, clicks = 0, timer
      const target = { label: 'Element', selector: '[data-shoot=nav-item]', shoot: 'nav-item', tag: 'button', text: 'Item', rect: { x: 0, y: 0, w: 40, h: 20 }, route: ['[data-shoot=nav-opener]'] }
      const item = { id: 'nav-target', n: 1, proto: 'navfx', variant: 'B', body: ['Target'], tags: [], target }
      const store = createStore('nav-regression')
      const place = variant => ({ proto: 'navfx', variant, title: 'Navigation', phone: false })
      store.set({ items: [item, { ...item, id: 'nav-whole', n: 2, body: ['Whole design'], target: undefined }], place: place('A') })
      const host = {
        layer: mount, mount: () => current, dark: () => false,
        send: async () => ({}), withdraw: async () => {},
        go: () => {
          current = null
          store.set({ place: place('B') })
          timer = setTimeout(() => {
            mount.innerHTML = '<button data-shoot="nav-opener">Open</button>'
            mount.firstElementChild.onclick = () => {
              clicks++
              if (!mount.querySelector('[data-shoot=nav-item]')) mount.insertAdjacentHTML('beforeend', '<div data-opened-by="[data-shoot=nav-opener]"><button data-shoot="nav-item">Item</button></div>')
            }
            current = mount
          }, delay)
        }
      }
      const act = createActions(store, host)
      const errors = []
      try {
        act.open('nav-target')
        if (!await until(() => clicks === 1 && mount.querySelector('[data-shoot=nav-item]'))) errors.push('a design mounted after 1200ms did not reveal its comment')
        // A later comment selection must cancel work scheduled for the first one.
        mount.innerHTML = ''; current = null; clicks = 0; delay = 40
        store.set({ place: place('A') })
        act.open('nav-target')
        act.open('nav-whole')
        if (!await until(() => current)) return 'the second destination never mounted'
        await new Promise(r => setTimeout(r, 900))
        if (clicks !== 0 || mount.querySelector('[data-shoot=nav-item]')) errors.push('a stale reveal opened the previous comment after another was selected')
        return errors.length ? errors.join('; ') : 'ok'
      } finally { clearTimeout(timer); act.close(); mount.remove(); localStorage.removeItem('proto-comments-nav-regression') }
    })()`)
    if (result !== 'ok') fail(`comment navigation: ${result}`)
  } finally { page.close() }
  console.log('\nOK: comment reveal waits for its destination and cancels obsolete selections')
}
