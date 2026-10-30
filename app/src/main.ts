import '../shell/shell.css'
import { createShell } from '../shell/shell'
import { refOfPath } from '../shell/building'
import { SHARE, shareInfo } from '../shell/mode'
import { status } from '../shell/transport'
import { mount } from './mount'
import { designs, protos } from './registry'
import session from '../session.json'

const app = document.getElementById('app')!

// A share boots the viewer instead of the shell (the share build leaves the shell out, see
// app/share/plugin.mjs), and looks at its host for a newer version: every minute while the page
// is in view, and whenever it comes back to it. The copy in the full view's frame (one design) doesn't.
if (SHARE) {
  void import('../shell/viewer/index').then(({ createViewer }) => {
    const viewer = createViewer(app, { mount, protos, session, designs })
    if (viewer.framed) return
    const check = async () => {
      const state = await status()
      if (state && shareInfo && state.version > shareInfo.version) viewer.newer()
    }
    setInterval(() => { if (document.visibilityState === 'visible') void check() }, 60_000)
    window.addEventListener('focus', () => void check())
  })
}

const shell = SHARE ? null : createShell(app, { mount, protos, session, designs })

if (import.meta.hot && shell) {
  // New or renamed prototype files re-run the registry; the shell takes the new list
  // without a page reload. Edits inside a variant are handled by the framework's own HMR.
  import.meta.hot.accept('./registry', mod => { if (!mod) return; shell.setProtos(mod.protos); shell.setDesigns(mod.designs) })
  import.meta.hot.accept('../session.json', mod => mod && shell.setSession(mod.default))
  // Sent by the dev server for any change under src/protos, shown or not (Vite itself only
  // reports modules the page has loaded).
  import.meta.hot.on('proto:edit', (data: { path: string }) => shell.edited([data.path]))
  // A syntax error in a variant that is still being written: no overlay over the page (the shell decides).
  import.meta.hot.on('vite:error', ({ err }: { err: { id?: string; loc?: { file?: string } } }) => shell.viteError(err.id || err.loc?.file || '', err))
  // A variant whose component got a new name (the placeholder's `Variant` becoming
  // `SplitMedia`) is a different component to React Fast Refresh, so nothing on screen
  // would redraw. Hand the shell the fresh module; it remounts only in that case.
  import.meta.hot.on('vite:beforeUpdate', () => shell.updating())
  import.meta.hot.on('vite:afterUpdate', async payload => {
    for (const u of payload.updates) {
      shell.compiled(u.path)
      if (u.type !== 'js-update' || !refOfPath(u.path) || !shell.shows(u.path)) continue
      const mod = await import(/* @vite-ignore */ `${u.acceptedPath}?t=${u.timestamp}`)
      shell.replaceVariant(u.path, mod.default)
    }
  })
  // Comments taken, answered or marked done by the agent (the server watches .proto/inbox).
  import.meta.hot.on('proto:inbox', inbox => shell.setInbox(inbox))
  // Viewers' comments on this session's share links (the server polls the host, app/share/routes.mjs).
  import.meta.hot.on('proto:shares', tray => shell.setShares(tray))
  import.meta.hot.on('vite:ws:disconnect', () => shell.setLive(false))
  import.meta.hot.on('vite:ws:connect', () => shell.setLive(true))
}
