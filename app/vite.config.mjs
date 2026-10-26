import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import tailwind from '@tailwindcss/vite'
import { prototypeServer } from './server.mjs'
import { reactSource, vueSource } from './source.mjs'

const session = JSON.parse(readFileSync(new URL('./session.json', import.meta.url), 'utf8'))
// Only the session's own framework plugin is installed; a non-literal import keeps the
// bundler from looking for the other one. Vue stamps where each element is written through its
// template compiler; React through its JSX runtime (reactSource).
const plugins = { react: '@vitejs/plugin-react', vue: '@vitejs/plugin-vue' }
const options = { vue: { template: { compilerOptions: { nodeTransforms: [vueSource] } } } }
const framework = (await import(plugins[session.stack])).default(options[session.stack])

// A share (`vite build --mode share`, run by share/build.mjs) builds the same app with its
// modules cut down to the variants being shared; the scope and the share's facts come in a JSON
// file, and the dev server's own plugins stay out.
async function shareMode() {
  const { sharePlugins, loadSharp } = await import('./share/plugin.mjs')
  const file = process.env.PROTO_SHARE_SCOPE, outDir = process.env.PROTO_SHARE_OUT
  if (!file || !outDir) throw new Error('a share build needs PROTO_SHARE_SCOPE and PROTO_SHARE_OUT')
  const { scope, info } = JSON.parse(readFileSync(file, 'utf8'))
  return sharePlugins({ scope, info, session, sharp: loadSharp(), appDir: fileURLToPath(new URL('.', import.meta.url)), outDir, report: join(dirname(file), 'report.json') })
}

export default defineConfig(async ({ mode }) => ({
  plugins: [framework, tailwind(), ...(mode === 'share' ? await shareMode() : [prototypeServer(session), reactSource()])],
  // An inline config stops Vite from loading the project's own PostCSS config from above.
  css: { postcss: {} },
  resolve: { alias: { '@project': session.project } },
  // The shell's sheet runs on React in every stack; bundled up front, a Vue app doesn't reload
  // the first time it opens.
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@base-ui/react/dialog', '@base-ui/react/drawer', '@base-ui/react/menu', '@base-ui/react/tooltip', 'modern-screenshot'] },
  server: {
    host: '127.0.0.1',
    port: session.port,
    strictPort: true,
    // Reached through `tailscale serve` as <machine>.<tailnet>.ts.net.
    allowedHosts: ['.ts.net'],
    // Only the page itself calls this server. Vite's default CORS answers a preflight from any
    // localhost page, which would let another dev server on this Mac send JSON to /__proto.
    cors: false,
    // Vite checks a file's real path, so a project reached through a link (macOS /tmp is
    // /private/tmp) is allowed by both names.
    fs: {
      allow: [session.project, realpathSync(session.project)],
      // Keep Vite's default sensitive-file exclusions and the server-only wakeup credential.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.proto/inbox/listener.json'],
    },
    // The server's own log and pid live in .proto/; changes there are not edits.
    watch: { ignored: ['**/.proto/**'] },
  },
}))
