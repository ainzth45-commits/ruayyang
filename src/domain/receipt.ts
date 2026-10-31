import type { Repo } from '../data/repo'
import { MAX_SATANG } from './money'
import type { MonthEntry, MonthKey, ReceiptCheckMode, ReceiptEvidence, RecurringItem } from './types'

export function entryReceipts(entry: Pick<MonthEntry, 'receipts' | 'receiptPath'>): ReceiptEvidence[] {
  return entry.receipts ?? (entry.receiptPath ? [{ path: entry.receiptPath, ocrAmount: null }] : [])
}

export function validateReceiptEvidence(receipts: ReceiptEvidence[]): void {
  if (!Array.isArray(receipts)) throw new Error('ข้อมูลหลักฐานไม่ถูกต้อง')
  const paths = new Set<string>()
  for (const receipt of receipts) {
    if (!receipt || typeof receipt.path !== 'string' || !receipt.path.trim() || receipt.path.length > 200 || paths.has(receipt.path)) throw new Error('รูปหลักฐานซ้ำหรือข้อมูลรูปไม่ถูกต้อง')
    paths.add(receipt.path)
    if (receipt.ocrAmount !== null && (!Number.isSafeInteger(receipt.ocrAmount) || receipt.ocrAmount < 0 || receipt.ocrAmount > MAX_SATANG)) throw new Error('ยอดที่อ่านจากหลักฐานไม่ถูกต้อง')
  }
}

export function receiptPaymentCheck(entry: Pick<MonthEntry, 'amount' | 'receipts' | 'receiptPath' | 'receiptMode'>): {
  status: 'none' | 'unreadable' | 'mode-required' | 'match' | 'mismatch'
  suggestedAmount: number | null
} {
  const receipts = entryReceipts(entry)
  if (!receipts.length) return { status: 'none', suggestedAmount: null }
  try { validateReceiptEvidence(receipts) } catch { return { status: 'unreadable', suggestedAmount: null } }
  if (receipts.some((r) => r.ocrAmount === null)) return { status: 'unreadable', suggestedAmount: null }
  if (receipts.length > 1 && !entry.receiptMode) return { status: 'mode-required', suggestedAmount: null }
  const amounts = receipts.map((r) => r.ocrAmount!)
  const amount = entry.receiptMode === 'each' ? (amounts.every((n) => n === amounts[0]) ? amounts[0] : null) : amounts.reduce((sum, n) => sum + n, 0)
  const suggestedAmount = amount !== null && Number.isSafeInteger(amount) && amount <= MAX_SATANG ? amount : null
  return { status: suggestedAmount !== null && suggestedAmount === entry.amount ? 'match' : 'mismatch', suggestedAmount }
}

/** เก็บประวัติ paid เดิมได้ แต่ห้ามบันทึก paid พร้อมยอด/หลักฐานใหม่ที่ไม่ผ่านการอ่าน */
export function validateReceiptPayment(entry: MonthEntry, item?: RecurringItem, previous?: MonthEntry): void {
  if (!entry.paid || item?.kind === 'income') return
  if (previous?.paid && previous.amount === entry.amount && previous.receiptPath === entry.receiptPath && (previous.receiptMode ?? null) === (entry.receiptMode ?? null) && JSON.stringify(entryReceipts(previous)) === JSON.stringify(entryReceipts(entry))) return
  const check = receiptPaymentCheck(entry)
  if (check.status === 'unreadable') throw new Error('ยังอ่านยอดหลักฐานไม่ได้ กรุณาอ่านใหม่หรือเปลี่ยนรูปก่อนบันทึกจ่ายแล้ว')
  if (check.status === 'mode-required') throw new Error('กรุณาเลือกวิธีตรวจยอดหลายสลิปก่อนบันทึกจ่ายแล้ว')
  if (check.status === 'mismatch') throw new Error('ยอดหลักฐานไม่ตรงกับยอดบิล กรุณาเปลี่ยนยอดหรือเปลี่ยนรูปก่อนบันทึกจ่ายแล้ว')
}

const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024
const MAX_STORED_BYTES = 2 * 1024 * 1024

export function validateReceiptFile(file: Pick<File, 'name' | 'type' | 'size'>): void {
  if (file.size === 0) throw new Error('ไฟล์ว่าง กรุณาเลือกรูปใหม่')
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error('รูปต้องมีขนาดไม่เกิน 15 MB')
  const isImage = file.type.startsWith('image/') || (!file.type && /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name))
  if (!isImage) throw new Error('กรุณาเลือกไฟล์รูปภาพสลิปหรือใบเสร็จ')
}

/** อัปโหลดรูปเป็นร่างเท่านั้น เงินและสถานะจะเปลี่ยนพร้อมหลักฐานเมื่อกดบันทึกบิล */
export async function uploadReceipt(repo: Repo, month: MonthKey, jpeg: Blob, ocrAmount: number | null): Promise<ReceiptEvidence> {
  if (jpeg.type !== 'image/jpeg') throw new Error('ต้องแปลงหลักฐานเป็นรูป JPEG ก่อนอัปโหลด')
  if (jpeg.size === 0) throw new Error('ไฟล์ว่าง กรุณาเลือกรูปใหม่')
  if (jpeg.size > MAX_STORED_BYTES) throw new Error('รูปหลังย่อต้องมีขนาดไม่เกิน 2 MB กรุณาเลือกรูปที่เล็กลง')
  validateReceiptEvidence([{ path: 'draft', ocrAmount }])
  return { path: await repo.uploadSlip(jpeg, month), ocrAmount }
}

export async function saveReceiptChanges(repo: Repo, entry: MonthEntry, receipts: ReceiptEvidence[], mode: ReceiptCheckMode | null, payment: Partial<Pick<MonthEntry, 'amount' | 'paid' | 'note'>>) {
  const saved = await repo.saveEntryReceipts(entry, receipts, mode, payment)
  const keep = new Set(receipts.map((r) => r.path))
  const removed = entryReceipts(entry).map((r) => r.path).filter((path) => !keep.has(path))
  const cleanup = await Promise.allSettled(removed.map((path) => repo.deleteSlip(path)))
  return { saved, warning: cleanup.some((r) => r.status === 'rejected') ? 'บันทึกบิลแล้ว แต่ลบรูปหลักฐานเก่าบางรูปไม่สำเร็จ' : null }
}

/** ตรวจข้อมูลจริงก่อนล้างร่าง เผื่อเซิร์ฟเวอร์บันทึกสำเร็จแต่เครือข่ายทำคำตอบหาย */
export async function discardReceiptUploads(repo: Repo, entry: MonthEntry, paths: string[]): Promise<string | null> {
  if (!paths.length) return null
  let used: Set<string>
  try {
    const current = (await repo.listEntries(entry.month, entry.month)).find((e) => e.id === entry.id)
    used = new Set(current ? entryReceipts(current).map((r) => r.path) : [])
  } catch {
    return 'ยังตรวจสอบรูปที่บันทึกไม่ได้ จึงเก็บรูปฉบับร่างไว้ก่อน'
  }
  const results = await Promise.allSettled([...new Set(paths)].filter((path) => !used.has(path)).map((path) => repo.deleteSlip(path)))
  return results.some((r) => r.status === 'rejected') ? 'ลบรูปฉบับร่างบางรูปไม่สำเร็จ กรุณาลองใหม่ภายหลัง' : null
}
