// A link's QR code, drawn in the page (no service sees the link): dark modules on white, with the
// quiet zone scanners need, whatever the page's theme.
import qrcode from 'qrcode-generator'

export function drawQr(canvas: HTMLCanvasElement, text: string, css = 168) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount(), quiet = 3, dpr = Math.max(1, Math.round(devicePixelRatio || 1))
  const cell = Math.max(1, Math.floor(css * dpr / (n + quiet * 2)))
  const size = cell * (n + quiet * 2)
  canvas.width = size; canvas.height = size
  canvas.style.width = canvas.style.height = `${Math.round(size / dpr)}px`
  const g = canvas.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, size, size)
  g.fillStyle = '#000'
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell)
}
