import type { Satang } from '../domain/types'
import { prepareForOcr } from './image'
import { parseSlipAmount } from './parseAmount'

type TWorker = import('tesseract.js').Worker

let progressCb: ((p: number) => void) | undefined
let workerPromise: Promise<TWorker> | null = null

/**
 * worker ตัวเดียวใช้ซ้ำ (โหลดภาษาไทย+อังกฤษครั้งแรก ~ไม่กี่ MB แล้วเบราว์เซอร์ cache ไว้ใน IndexedDB)
 * tesseract.js โหลดแบบ lazy → ไม่ถ่วงการเปิดแอป
 */
function getWorker(): Promise<TWorker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(({ createWorker }) =>
        createWorker('tha+eng', 1, {
          logger: (m) => {
            if (m.status === 'recognizing text') progressCb?.(m.progress)
          },
        }),
      )
      .catch((e) => {
        workerPromise = null // ให้ลองใหม่ได้ครั้งหน้า (เช่น เน็ตหลุดตอนโหลดภาษา)
        throw e
      })
  }
  return workerPromise
}

/** โหลด worker ล่วงหน้าตอนผู้ใช้กดปุ่มสลิป เพื่อให้อ่านเร็วขึ้น */
export function warmUpOcr(): void {
  getWorker().catch(() => {})
}

/** อ่านยอดเงินจากรูปสลิป — ไม่ throw เด็ดขาด: พังเมื่อไหร่คืน amount null ให้ผู้ใช้กรอกเอง */
export async function readSlipAmount(
  file: Blob,
  onProgress?: (p: number) => void,
): Promise<{ amount: Satang | null; text: string }> {
  try {
    const worker = await getWorker()
    const image = await prepareForOcr(file)
    progressCb = onProgress
    const { data } = await worker.recognize(image)
    return { amount: parseSlipAmount(data.text), text: data.text }
  } catch (e) {
    console.warn('[ocr] อ่านสลิปไม่สำเร็จ', e)
    return { amount: null, text: '' }
  } finally {
    progressCb = undefined
  }
}
