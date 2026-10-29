const MAX_SIDE = 2000
export const imageIn = (dt: DataTransfer | null) => {
  if (!dt) return null
  for (const f of dt.files) if (f.type.startsWith('image/')) return f
  for (const i of dt.items) if (i.kind === 'file' && i.type.startsWith('image/')) return i.getAsFile()
  return null
}
export const carriesImage = (dt: DataTransfer | null) => !!dt && [...dt.items].some(i => i.kind === 'file' && i.type.startsWith('image/'))
export async function imageUrl(file: File): Promise<string | null> {
  const src = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const png = c.toDataURL('image/png')
    return png.length < 3_000_000 ? png : c.toDataURL('image/jpeg', 0.9)
  } catch { return null } finally { URL.revokeObjectURL(src) }
}
