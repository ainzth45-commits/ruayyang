import { dailyAllowance } from './calc'
import { addMonths, monthOf } from './month'
import type { DateKey, MonthKey, MonthRecord, Satang } from './types'

/** งบของเดือนนี้ ถ้าไม่ได้ตั้ง ใช้ของเดือนก่อนหน้าล่าสุดที่ตั้งไว้ (เดือนอนาคตตามค่าใหม่อัตโนมัติ) */
export function effectiveBudget(month: MonthKey, records: MonthRecord[]): Satang | null {
  let best: MonthRecord | null = null
  for (const r of records) {
    if (r.spendBudget === null || r.month > month) continue
    if (!best || r.month > best.month) best = r
  }
  return best?.spendBudget ?? null
}

export interface BudgetStatus {
  left: Satang
  daysLeft: number
  perDay: Satang
  /** สัดส่วนที่เหลือ 0–1 สำหรับวงแหวน */
  frac: number
}

export function budgetStatus(budget: Satang | null, spent: Satang, month: MonthKey, today: DateKey): BudgetStatus | null {
  if (budget === null) return null
  const left = budget - spent
  const { daysLeft, perDay } = dailyAllowance(left, month, today)
  return { left, daysLeft, perDay, frac: budget > 0 ? Math.min(1, Math.max(0, left / budget)) : 0 }
}

/** ใช้รายวันเฉลี่ยต่อเดือนของ n เดือนก่อนหน้า (นับเฉพาะเดือนที่มีรายการ) — ตัวช่วยตอนตั้งงบ */
export function avgDailySpend(txs: { date: DateKey; amount: Satang }[], month: MonthKey, n: number): Satang | null {
  const from = addMonths(month, -n)
  const sums = new Map<MonthKey, Satang>()
  for (const t of txs) {
    const m = monthOf(t.date)
    if (m >= from && m < month) sums.set(m, (sums.get(m) ?? 0) + t.amount)
  }
  if (sums.size === 0) return null
  return Math.round([...sums.values()].reduce((a, b) => a + b, 0) / sums.size)
}
