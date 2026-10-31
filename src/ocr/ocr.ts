import { bangkokToday } from '../domain/month'
import type { DateKey, Satang } from '../domain/types'
import { prepareForOcr } from './image'
import { parseSlipAmount } from './parseAmount'
import { parseSlipDate } from './parseDate'

type TWorker = import('tesseract.js').Worker
type OcrResult = { amount: Satang | null; date: DateKey | null; text: string }
interface WorkerSlot {
  promise: Promise<TWorker>
  worker?: TWorker
  retired: boolean
  loadTimer?: ReturnType<typeof setTimeout>
  active?: { id: string; progress?: (p: number) => void }
}

const OCR_TIMEOUT_MS = 90_000
let currentWorker: WorkerSlot | null = null
let queue: Promise<unknown> = Promise.resolve()
let nextJob = 0

function terminate(worker: TWorker): void {
  // ไม่รอ terminate เพราะ worker ที่ค้างอาจไม่ตอบกลับ และต้องให้ผู้ใช้ลองรูปใหม่ได้
  try { void worker.terminate().catch(() => {}) } catch { /* worker อาจตายไปแล้ว */ }
}

function retire(slot: WorkerSlot): void {
  if (slot.retired) return
  slot.retired = true
  slot.active = undefined
  clearTimeout(slot.loadTimer)
  if (currentWorker === slot) currentWorker = null
  if (slot.worker) terminate(slot.worker)
}

/** โหลดภาษาแบบ lazy และคืน worker เดิมเฉพาะเมื่อยังทำงานได้ */
function getWorker(): WorkerSlot {
  if (currentWorker) return currentWorker
  const slot: WorkerSlot = {
    retired: false,
    promise: Promise.resolve().then(() => new Promise<TWorker>((resolve, reject) => {
      slot.loadTimer = setTimeout(() => {
        retire(slot)
        reject(new Error('OCR initialization timeout'))
      }, OCR_TIMEOUT_MS)
      void import('tesseract.js')
        .then(({ createWorker }) => createWorker('tha+eng', 1, {
          logger: (message) => {
            const active = slot.active
            if (slot.retired || !active || message.status !== 'recognizing text' || message.userJobId !== active.id || !Number.isFinite(message.progress)) return
            try { active.progress?.(Math.max(0, Math.min(1, message.progress))) } catch { /* callback UI ไม่ควรทำให้ worker พัง */ }
          },
          // Tesseract reject job อยู่แล้ว; อย่าให้ default handler throw ข้อความสลิปนอก Promise
          errorHandler: () => {},
        }))
        .then((worker) => {
          clearTimeout(slot.loadTimer)
          if (slot.retired) {
            terminate(worker)
            reject(new Error('OCR worker expired'))
            return
          }
          slot.worker = worker
          resolve(worker)
        }, () => {
          clearTimeout(slot.loadTimer)
          retire(slot)
          reject(new Error('OCR worker unavailable'))
        })
    })),
  }
  currentWorker = slot
  return slot
}

/** โหลด worker ล่วงหน้าตอนผู้ใช้กดปุ่มสลิป โดยมีเวลารอสูงสุดเหมือนการอ่านจริง */
export function warmUpOcr(): void {
  getWorker().promise.catch(() => {})
}

async function readOne(file: Blob, onProgress?: (p: number) => void): Promise<OcrResult> {
  const slot = getWorker()
  const id = `receipt-${++nextJob}`
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const work = async (): Promise<OcrResult> => {
      const worker = await slot.promise
      if (!active) return { amount: null, date: null, text: '' }
      const image = await prepareForOcr(file)
      if (!active) return { amount: null, date: null, text: '' }
      slot.active = { id, progress: onProgress }
      const { data } = await worker.recognize(image, {}, { text: true }, id)
      if (!active) return { amount: null, date: null, text: '' }
      return { amount: parseSlipAmount(data.text), date: parseSlipDate(data.text, bangkokToday()), text: data.text }
    }
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('OCR recognition timeout')), OCR_TIMEOUT_MS)
      }),
    ])
  } catch {
    retire(slot)
    // ไม่ log error ของ worker เพราะอาจมีข้อความส่วนตัวจากสลิปติดมาด้วย
    console.warn('[ocr] อ่านสลิปไม่สำเร็จ กรุณาลองใหม่')
    return { amount: null, date: null, text: '' }
  } finally {
    active = false
    clearTimeout(timer)
    if (slot.active?.id === id) slot.active = undefined
  }
}

/** อ่านทีละรูปด้วย worker ร่วม; ล้มเหลว/หมดเวลาคืน null และปล่อยคิวถัดไปให้ลองใหม่ */
export function readSlipAmount(file: Blob, onProgress?: (p: number) => void): Promise<OcrResult> {
  const result = queue.then(() => readOne(file, onProgress))
  queue = result.then(() => {}, () => {})
  return result
}
