// ตัวช่วยจัดการรูปสลิปในเบราว์เซอร์

/** ลายนิ้วมือไฟล์ ใช้กันอัปสลิปใบเดิมซ้ำ */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type Canvas2D = OffscreenCanvas | HTMLCanvasElement

function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function ctx2d(c: Canvas2D): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('เบราว์เซอร์ไม่รองรับการประมวลผลรูป')
  return ctx
}

async function toBlob(c: Canvas2D, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality })
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('แปลงรูปไม่สำเร็จ'))), type, quality),
  )
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    throw new Error('เปิดรูปนี้ไม่ได้ (ไฟล์อาจไม่ใช่รูปภาพ)')
  }
}

/** ย่อรูปให้ด้านยาวสุดไม่เกิน maxSide แล้วบีบเป็น JPEG — สลิปเหลือ ~100-200KB */
export async function compressImage(file: Blob, maxSide = 1280, quality = 0.75): Promise<Blob> {
  const bmp = await decode(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const c = makeCanvas(w, h)
  const ctx = ctx2d(c)
  ctx.fillStyle = '#fff' // PNG โปร่งใส → พื้นขาว ไม่ดำ
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return toBlob(c, 'image/jpeg', quality)
}

/** เตรียมรูปให้ OCR อ่านง่าย: ขาวดำ + ขยายรูปเล็ก ×2 (สลิปแคปจอส่วนใหญ่กว้าง ~1000px อยู่แล้ว) */
export async function prepareForOcr(file: Blob): Promise<Blob> {
  const bmp = await decode(file)
  const longSide = Math.max(bmp.width, bmp.height)
  const scale = longSide < 1400 ? 2 : longSide > 3000 ? 3000 / longSide : 1
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const c = makeCanvas(w, h)
  const ctx = ctx2d(c)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    d[i] = d[i + 1] = d[i + 2] = y
  }
  ctx.putImageData(img, 0, 0)
  return toBlob(c, 'image/png')
}
