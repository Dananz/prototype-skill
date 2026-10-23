/**
 * A variant's number, as the page shows it: its letter counted the way columns are (A is 1, Z 26,
 * AA 27, AC 29). Fixed by the letter, so removing a variant never renumbers the others. Routes,
 * files and actions keep the letter. app/numbers.mjs is the same count for the CLI.
 */
export const numberOf = (id: string): number => /^[A-Z]{1,2}$/.test(id) ? [...id].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) : 0
/** The label the page shows for a variant: its number; an ID that isn't a letter, its place in the list. */
export function variantLabel(p: { variants: { id: string }[] } | null, id: string): string {
  const n = numberOf(id)
  if (n) return String(n)
  const index = p ? p.variants.findIndex(v => v.id === id) : -1
  return index >= 0 ? String(index + 1) : id
}
/** A variant named in words (Picked #4, from #4, Open #4): its number after a #, so it reads as a name, not a count. */
export const variantRef = (p: { variants: { id: string }[] } | null, id: string): string => `#${variantLabel(p, id)}`
