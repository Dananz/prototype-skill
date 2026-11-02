// The dev server sends modules uncompressed, which is most of the wait on a phone over the tailnet. This
// compresses each finished text response (brotli where the browser takes it) and keeps the result by
// its ETag, so a module is only compressed once. Anything streamed or already encoded passes through.
import { brotliCompress, constants, gzip } from 'node:zlib'

const TEXT = /^(text\/|application\/(javascript|json)|image\/svg)/
const MIN = 1024, KEEP = 96 * 1024 * 1024

export function compression() {
  const kept = new Map()
  let size = 0
  const remember = (key, buf) => {
    kept.set(key, buf); size += buf.length
    for (const [k, b] of kept) { if (size <= KEEP) break; kept.delete(k); size -= b.length }
  }
  return (req, res, next) => {
    const accepts = String(req.headers['accept-encoding'] ?? '')
    const enc = /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : ''
    if (!enc || req.method !== 'GET' || req.url?.startsWith('/__proto')) return next()
    const end = res.end
    res.end = function (body, ...rest) {
      res.end = end
      const type = String(res.getHeader('content-type') ?? '')
      const data = typeof body === 'string' ? Buffer.from(body) : body
      if (!Buffer.isBuffer(data) || data.length < MIN || res.headersSent || res.statusCode !== 200 || res.getHeader('content-encoding') || !TEXT.test(type)) return end.call(res, body, ...rest)
      const send = out => {
        res.setHeader('content-encoding', enc); res.setHeader('vary', 'accept-encoding'); res.setHeader('content-length', out.length)
        end.call(res, out)
      }
      const etag = res.getHeader('etag'), key = etag ? `${enc}:${etag}` : ''
      if (key && kept.has(key)) { send(kept.get(key)); return res }
      const done = (err, out) => {
        if (err) { end.call(res, data); return }
        if (key) remember(key, out)
        send(out)
      }
      if (enc === 'br') brotliCompress(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 4, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }, done)
      else gzip(data, { level: 6 }, done)
      return res
    }
    next()
  }
}
