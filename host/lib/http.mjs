// The JSON answers every API route gives. No route sends CORS headers: the API answers same-origin
// pages and the owner's CLI only.
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }

export const json = (body, status = 200, extra = {}) => {
  const res = new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
  for (const [k, v] of Object.entries(extra)) for (const one of [v].flat()) res.headers.append(k, one)
  return res
}
export const fail = (status, error, more = {}) => json({ error, ...more }, status)

export const redirect = (location, cookies = []) => {
  const res = new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } })
  for (const c of cookies) res.headers.append('set-cookie', c)
  return res
}

/** The request's JSON body, or a Response refusing it (JSON bodies only, as the spec's Security says). */
export async function bodyOf(req) {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) return fail(415, 'The body must be JSON.')
  try {
    const b = await req.json()
    if (!b || typeof b !== 'object' || Array.isArray(b)) return fail(400, 'The body must be a JSON object.')
    return b
  } catch { return fail(400, 'The body must be JSON.') }
}
