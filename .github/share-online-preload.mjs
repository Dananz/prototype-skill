// Loaded with `node --import` into every process the online smoke starts (share-online-checks.mjs):
// a name under .localhost reaches 127.0.0.1, as Chrome resolves it by itself and macOS doesn't, and
// the self-signed certificate of `wrangler dev --local-protocol https` is taken. Node's fetch uses
// the undici that wrangler's miniflare brings, set as the global dispatcher. Never in production code.
import { lookup } from 'node:dns'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

const tools = process.env.PROTO_SHARE_TOOLS || join(homedir(), '.prototypes', 'share-tools')
const wrangler = createRequire(realpathSync(join(tools, 'node_modules', 'wrangler', 'package.json')))
const undici = createRequire(wrangler.resolve('miniflare'))('undici')
const local = host => host === 'localhost' || host.endsWith('.localhost')
undici.setGlobalDispatcher(new undici.Agent({
  connect: {
    rejectUnauthorized: false,
    lookup: (host, options, done) => {
      if (!local(host)) return lookup(host, options, done)
      return options?.all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4)
    },
  },
}))
