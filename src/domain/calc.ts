import { daysInMonth, monthOf } from './month'
import type { DateKey, MonthEntry, MonthKey, MonthRecord, RecurringItem, Satang, Saving, Transaction } from './types'

export interface MonthSummary {
  month: MonthKey
  income: Satang
  fixedExpense: Satang
  daily: Satang
  /** รับ − จ่ายประจำ − จ่ายรายวัน */
  remaining: Satang
  actualBalance: Satang | null
  /** เก็บระหว่างเดือน (ไม่รวมแยกเก็บตอนปิด) */
  savedDeposits: Satang
  /** แยกเก็บตอนปิดเดือน */
  savedAtClose: Satang
  /**
   * รายได้เพิ่ม = คงเหลือจริง + เก็บระหว่างเดือน − คงเหลือ (null ถ้ายังไม่กรอกคงเหลือจริง)
   * ที่มา: รับ + เพิ่ม − ประจำ − รายวัน − เก็บระหว่างเดือน = คงเหลือจริง
   */
  diff: Satang | null
  /** รายจ่ายยอดประมาณที่ยังไม่จ่าย */
  pendingEstimates: number
  /** รายจ่ายยอดแน่นอนที่ยังไม่จ่าย */
  unpaid: number
}

export type EntryStatus = 'paid' | 'estimate' | 'pending'

export function entryStatus(e: MonthEntry, item: RecurringItem | undefined): EntryStatus {
  if (e.paid) return 'paid'
  return item?.isEstimate ? 'estimate' : 'pending'
}

export function summarizeMonth(
  month: MonthKey,
  items: RecurringItem[],
  entries: MonthEntry[],
  txs: Transaction[],
  record: MonthRecord | null,
  savings: Saving[] = [],
): MonthSummary {
  const byId = new Map(items.map((i) => [i.id, i]))
  let income = 0
  let fixedExpense = 0
  let pendingEstimates = 0
  let unpaid = 0
  for (const e of entries) {
    if (e.month !== month) continue
    const it = byId.get(e.itemId)
    if (it?.kind === 'income') {
      income += e.amount
      continue
    }
    fixedExpense += e.amount
    const st = entryStatus(e, it)
    if (st === 'estimate') pendingEstimates++
    else if (st === 'pending') unpaid++
  }
  const daily = txs.reduce((s, t) => (monthOf(t.date) === month ? s + t.amount : s), 0)
  const remaining = income - fixedExpense - daily
  const actualBalance = record?.actualBalance ?? null
  let savedDeposits = 0
  let savedAtClose = 0
  for (const sv of savings) {
    if (monthOf(sv.date) !== month) continue
    if (sv.kind === 'close') savedAtClose += sv.amount
    else savedDeposits += sv.amount
  }
  return {
    month,
    income,
    fixedExpense,
    daily,
    remaining,
    actualBalance,
    savedDeposits,
    savedAtClose,
    diff: actualBalance === null ? null : actualBalance + savedDeposits - remaining,
    pendingEstimates,
    unpaid,
  }
}

/** เงินที่ใช้ได้ต่อวันจนสิ้นเดือน (รวมวันนี้) */
export function dailyAllowance(remaining: Satang, month: MonthKey, today: DateKey): { daysLeft: number; perDay: Satang } {
  const total = daysInMonth(month)
  const current = monthOf(today)
  const daysLeft = month < current ? 0 : month > current ? total : total - Number(today.slice(8, 10)) + 1
  if (daysLeft === 0 || remaining <= 0) return { daysLeft, perDay: 0 }
  return { daysLeft, perDay: Math.floor(remaining / daysLeft) }
}

export function dailyTotals(txs: Transaction[]): Map<DateKey, Satang> {
  const m = new Map<DateKey, Satang>()
  for (const t of txs) m.set(t.date, (m.get(t.date) ?? 0) + t.amount)
  return m
}

export interface CategoryShare {
  categoryId: string | null
  total: Satang
  share: number
}

export function categoryBreakdown(txs: Transaction[]): CategoryShare[] {
  const m = new Map<string | null, Satang>()
  let sum = 0
  for (const t of txs) {
    m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amount)
    sum += t.amount
  }
  if (sum === 0) return []
  return [...m.entries()]
    .map(([categoryId, total]) => ({ categoryId, total, share: total / sum }))
    .sort((a, b) => b.total - a.total)
}
