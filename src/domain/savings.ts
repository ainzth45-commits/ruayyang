import type { Repo } from '../data/repo'
import { addMonths, monthEndDate, monthOf, monthStartDate } from './month'
import type { DateKey, MonthKey, MonthRecord, Satang, Saving } from './types'

/** เงินเก็บสะสม = ยอดตั้งต้น + เงินเก็บทุกรายการ */
export const savingsTotal = (opening: Satang, all: Saving[]): Satang => all.reduce((a, s) => a + s.amount, opening)

export function savedIn(all: Saving[], month: MonthKey): { deposits: Satang; atClose: Satang } {
  let deposits = 0
  let atClose = 0
  for (const s of all) {
    if (monthOf(s.date) !== month) continue
    if (s.kind === 'close') atClose += s.amount
    else deposits += s.amount
  }
  return { deposits, atClose }
}

/** ปิดแล้ว = กดปิดเดือนในแอป หรือมีคงเหลือจริงแล้ว (ข้อมูลเก่าจากชีต) */
export const isMonthClosed = (r: MonthRecord | undefined): boolean => !!r && (r.closedAt !== null || r.actualBalance !== null)

/** เดือนที่ควรชวนปิด: เดือนที่แล้วที่ยังไม่ปิด (ถ้ามีเดือนนั้นในระบบ) หรือเดือนนี้ช่วง 2 วันสุดท้าย */
export function needsClosing(today: DateKey, records: MonthRecord[]): MonthKey | null {
  const month = monthOf(today)
  const prev = addMonths(month, -1)
  const byMonth = new Map(records.map((r) => [r.month, r]))
  if (byMonth.has(prev) && !isMonthClosed(byMonth.get(prev))) return prev
  const lastDay = Number(monthEndDate(month).slice(8, 10))
  if (Number(today.slice(8, 10)) >= lastDay - 1 && !isMonthClosed(byMonth.get(month))) return month
  return null
}

/**
 * บันทึกปิดเดือน: คงเหลือจริง + เงินแยกเก็บตอนปิด (เดือนละ 1 รายการ, 0 = ไม่มี) + เวลาปิด
 * เรียกซ้ำได้ (แก้การปิดเดือน) — แก้/ลบรายการปิดเดือนเดิม ไม่สร้างซ้ำ
 */
export async function closeMonth(repo: Repo, month: MonthKey, actual: Satang, save: Satang, nowIso: string): Promise<void> {
  if (!Number.isInteger(save) || save < 0) throw new Error('ยอดแยกเก็บต้องไม่ติดลบ')
  await repo.setActualBalance(month, actual)
  const existing = (await repo.listSavings(monthStartDate(month), monthEndDate(month))).filter((s) => s.kind === 'close')
  const [keep, ...extra] = existing
  for (const s of extra) await repo.deleteSaving(s.id)
  if (save === 0) {
    if (keep) await repo.deleteSaving(keep.id)
  } else if (keep) {
    await repo.updateSaving(keep.id, { amount: save, date: monthEndDate(month) })
  } else {
    await repo.addSaving({ date: monthEndDate(month), amount: save, note: 'แยกเก็บตอนปิดเดือน', kind: 'close' })
  }
  await repo.setMonthClosed(month, nowIso)
}
