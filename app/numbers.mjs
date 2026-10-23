// A variant's number, as the page shows it and as people say it: its letter counted the way
// spreadsheet columns are (A is 1, Z 26, AA 27, AC 29). The letter stays the variant's ID (its
// file, its route, what meta.ts keys it by); the number is only how it is shown and spoken,
// written after a # (#29) so it reads as a name, not a count.
// app/shell/variants.ts keeps the page's copy of numberOf.

/** The number of a letter ID (A → 1, AC → 29); 0 when it isn't one. */
export const numberOf = id => /^[A-Z]{1,2}$/.test(String(id)) ? [...String(id)].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) : 0

/** The letter ID of a number (29 → AC); '' past ZZ (702) or below 1. */
export function letterOf(n) {
  n = Number(n)
  if (!Number.isInteger(n) || n < 1 || n > 702) return ''
  let s = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s
  return s
}

/** A variant as the user writes it, a number (29, #29) or the letter (AC, ac), as its letter ID; '' if neither. */
export const idOf = spec => { const s = String(spec ?? '').replace(/^#/, ''); return /^\d+$/.test(s) ? letterOf(s) : /^[A-Za-z]{1,2}$/.test(s) ? s.toUpperCase() : '' }
