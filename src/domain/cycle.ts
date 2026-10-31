import { addMonths, bangkokToday, monthOf, monthStartDate } from './month'
import type { DateKey, MonthKey, MonthRecord, Transaction } from './types'

function checkDate(date: DateKey): void {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('วันที่ใช้เงินไม่ถูกต้อง')
  }
}

/** ข้อมูลชีตเก่าไม่มีเวลาปิด จึงเริ่มใช้ยอดได้ตั้งแต่วันแรกของเดือนถัดไป */
function openingTime(record: MonthRecord): number {
  return Date.parse(record.closedAt ?? `${monthStartDate(addMonths(record.month, 1))}T00:00:00+07:00`)
}

/** เดือนของรอบที่เปิดใช้งานจริงล่าสุด ไม่ย้อนรอบเมื่อแก้ยอดเดือนเก่าทีหลัง */
export function activeCycle(records: MonthRecord[], today: DateKey, nowIso: string = new Date().toISOString()): MonthRecord | null {
  checkDate(today)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(now)) throw new Error('เวลาอ้างอิงรอบเงินไม่ถูกต้อง')
  let latest: MonthRecord | null = null
  for (const record of records) {
    if (record.actualBalance === null || record.month > monthOf(today)) continue
    const opened = openingTime(record)
    if (!Number.isFinite(opened) || opened > now || bangkokToday(new Date(opened)) > today) continue
    if (!latest || record.month > latest.month) {
      latest = record
    }
  }
  return latest
}

/** เลือกรอบสำหรับการจดรายการใหม่ โดยวันที่เงินจริงคงเดิมเสมอ */
export function cycleForDate(date: DateKey, records: MonthRecord[], atIso: string = new Date().toISOString()): MonthKey {
  return activeCycle(records, date, atIso)?.month ?? addMonths(monthOf(date), -1)
}

/** ใช้รอบที่บันทึกชัดเจนก่อน; รายการเก่าที่ไม่มีเวลาพอแยกรอบคงกติกาเดิม */
export function transactionCycle(transaction: Pick<Transaction, 'date' | 'createdAt' | 'cycleMonth'>, records: MonthRecord[]): MonthKey {
  if (transaction.cycleMonth) return transaction.cycleMonth
  if (!Number.isFinite(Date.parse(transaction.createdAt))) return addMonths(monthOf(transaction.date), -1)
  return cycleForDate(transaction.date, records, transaction.createdAt)
}
