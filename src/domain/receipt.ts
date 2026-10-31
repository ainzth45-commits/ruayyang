import type { Repo } from '../data/repo'
import type { MonthEntry } from './types'

const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024
const MAX_STORED_BYTES = 2 * 1024 * 1024

export interface ReceiptResult {
  receiptPath: string | null
  /** การผูกหลักฐานสำเร็จแล้ว แต่ล้างไฟล์เก่าไม่สำเร็จ */
  warning: string | null
}

export function validateReceiptFile(file: Pick<File, 'name' | 'type' | 'size'>): void {
  if (file.size === 0) throw new Error('ไฟล์ว่าง กรุณาเลือกรูปใหม่')
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error('รูปต้องมีขนาดไม่เกิน 15 MB')
  const isImage = file.type.startsWith('image/') || (!file.type && /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name))
  if (!isImage) throw new Error('กรุณาเลือกไฟล์รูปภาพสลิปหรือใบเสร็จ')
}

/** แนบกับบิลเดือนนั้นโดยตรง ไม่สร้างรายจ่ายรายวันและไม่แก้ยอด/สถานะจ่าย */
export async function attachReceipt(repo: Repo, entry: MonthEntry, jpeg: Blob): Promise<ReceiptResult> {
  if (jpeg.type !== 'image/jpeg') throw new Error('ต้องแปลงหลักฐานเป็นรูป JPEG ก่อนอัปโหลด')
  if (jpeg.size === 0) throw new Error('ไฟล์ว่าง กรุณาเลือกรูปใหม่')
  if (jpeg.size > MAX_STORED_BYTES) throw new Error('รูปหลังย่อต้องมีขนาดไม่เกิน 2 MB กรุณาเลือกรูปที่เล็กลง')
  const path = await repo.uploadSlip(jpeg, entry.month)
  try {
    await repo.updateEntry(entry.id, { receiptPath: path })
  } catch (error) {
    try {
      await repo.deleteSlip(path)
    } catch {
      const reason = error instanceof Error ? error.message : 'บันทึกหลักฐานไม่สำเร็จ'
      throw new Error(`${reason} · ล้างรูปที่อัปโหลดใหม่ไม่สำเร็จ กรุณาลองใหม่ภายหลัง`, { cause: error })
    }
    throw error
  }
  let warning: string | null = null
  if (entry.receiptPath && entry.receiptPath !== path) {
    try {
      await repo.deleteSlip(entry.receiptPath)
    } catch {
      warning = 'บันทึกหลักฐานใหม่แล้ว แต่ลบรูปเก่าไม่สำเร็จ'
    }
  }
  return { receiptPath: path, warning }
}

/** ล้างการอ้างอิงก่อนลบไฟล์ เพื่อไม่ให้บิลชี้ไปยังรูปที่หายไป */
export async function detachReceipt(repo: Repo, entry: MonthEntry): Promise<ReceiptResult> {
  if (!entry.receiptPath) return { receiptPath: null, warning: null }
  await repo.updateEntry(entry.id, { receiptPath: null })
  try {
    await repo.deleteSlip(entry.receiptPath)
    return { receiptPath: null, warning: null }
  } catch {
    return { receiptPath: null, warning: 'ถอดหลักฐานจากบิลแล้ว แต่ลบไฟล์รูปไม่สำเร็จ' }
  }
}
