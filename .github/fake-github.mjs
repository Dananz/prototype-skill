// A stand-in for GitHub's OAuth web flow and its /user endpoint, for the host's tests and smokes.
// Point the host at it with GITHUB_OAUTH and GITHUB_API (both this server's url). The authorize page
// answers at once, as if the person had clicked Authorize: a 302 back to redirect_uri with a code.
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

const b64url = buf => Buffer.from(buf).toString('base64url')

/**
 * Starts the fake on 127.0.0.1 at a free port. `user` is who signs in (change it with setUser);
 * `calls` records every request, so a test can see what the host sent.
 */
export async function startFakeGitHub({ clientId = 'fake-client-id', clientSecret = 'fake-client-secret', user } = {}) {
  let who = user || { id: 4242, login: 'dana-test', name: 'Dana', avatar_url: 'https://avatars.githubusercontent.com/u/4242' }
  const codes = new Map() // code -> { challenge, redirect }
  const tokens = new Map() // token -> user
  const calls = []
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake')
    let body = ''
    for await (const chunk of req) body += chunk
    calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body })
    if (req.method === 'GET' && url.pathname === '/login/oauth/authorize') {
      const q = url.searchParams
      if (q.get('client_id') !== clientId || !q.get('redirect_uri')) return send(res, 400, { error: 'bad authorize request' })
      const code = b64url(randomBytes(12))
      codes.set(code, { challenge: q.get('code_challenge'), redirect: q.get('redirect_uri') })
      const back = new URL(q.get('redirect_uri'))
      back.searchParams.set('code', code)
      if (q.get('state') !== null) back.searchParams.set('state', q.get('state'))
      return send(res, 302, undefined, { location: back.href })
    }
    if (req.method === 'POST' && url.pathname === '/login/oauth/access_token') {
      const f = new URLSearchParams(body)
      const c = codes.get(f.get('code'))
      codes.delete(f.get('code'))
      // GitHub answers a bad exchange with 200 and an error field, not an error status.
      if (f.get('client_id') !== clientId || f.get('client_secret') !== clientSecret) return send(res, 200, { error: 'incorrect_client_credentials' })
      if (!c) return send(res, 200, { error: 'bad_verification_code' })
      if (c.redirect !== f.get('redirect_uri')) return send(res, 200, { error: 'redirect_uri_mismatch' })
      if (c.challenge && b64url(createHash('sha256').update(f.get('code_verifier') || '').digest()) !== c.challenge) return send(res, 200, { error: 'bad_verification_code' })
      const token = 'gho_' + b64url(randomBytes(16))
      tokens.set(token, who)
      return send(res, 200, { access_token: token, token_type: 'bearer', scope: '' })
    }
    if (req.method === 'GET' && url.pathname === '/user') {
      if (!req.headers['user-agent']) return send(res, 403, { message: 'User-Agent required' })
      const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '')
      const u = m && tokens.get(m[1])
      if (!u) return send(res, 401, { message: 'Bad credentials' })
      return send(res, 200, u)
    }
    send(res, 404, { message: 'Not Found' })
  })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url, clientId, clientSecret, calls,
    setUser(u) { who = u },
    close: () => new Promise(ok => server.close(() => ok())),
  }
}
