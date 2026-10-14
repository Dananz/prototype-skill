/** A display label in the prototype's original order. Routes and actions keep the file ID. */
export function variantLabel(p: { variants: { id: string }[] }, id: string): string {
  const index = p.variants.findIndex(v => v.id === id)
  return index >= 0 && (p.variants.length > 22 || p.variants.some(v => v.id.length > 1)) ? String(index + 1) : id
}
