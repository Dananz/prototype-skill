// Share and link ids: 10 characters of Crockford base32 (no i, l, o, u), lowercase so they work as
// DNS labels. 5 bits per character from crypto.getRandomValues; 256 is a multiple of 32, so
// masking a byte is unbiased.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const LENGTH = 10

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH))
  let id = ''
  for (const b of bytes) id += ALPHABET[b & 31]
  return id
}

export const isId = s => typeof s === 'string' && s.length === LENGTH && [...s].every(c => ALPHABET.includes(c))
