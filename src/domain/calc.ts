import { addMonths, daysInMonth, monthOf } from './month'
import { transactionCycle } from './cycle'
import type { DateKey, MonthEntry, MonthKey, MonthRecord, RecurringItem, Satang, Saving, Transaction } from './types'

/**
 * สรุป "รอบเงินเดือน" M (ปิดรอบวันสุดท้ายของ M):
 * รับเงินเดือน M + จ่ายบิลประจำ M → ปิดยอดเริ่มใช้ได้ทันทีต่อเนื่องใน M+1
 */
export interface MonthSummary {
  month: MonthKey
  /** เดือนที่ใช้เงินของรอบนี้ (M+1) */
  spendMonth: MonthKey
  income: Satang
  fixedExpense: Satang
  /** แผนเหลือไว้ใช้เดือนหน้า = รับ − จ่ายประจำ */
  planLeft: Satang
  /** คงเหลือจริงวันสุดท้ายของ M (หลังรับเงินเดือน + จ่ายบิลครบ) */
  actualBalance: Satang | null
  /** เงินเกินแผน = คงเหลือจริง − แผนเหลือ (รายได้เสริม + เงินเหลือจากรอบก่อน) · null ถ้ายังไม่กรอก */
  diff: Satang | null
  /** แยกเก็บตอนปิดรอบ M */
  savedAtClose: Satang
  /** เงินตั้งต้นใช้เดือนหน้า = (คงเหลือจริง หรือแผนเหลือถ้ายังไม่กรอก) − แยกเก็บตอนปิด */
  startMoney: Satang
  /** รายจ่ายรายวันของรอบนี้ (วันที่จริงอาจเริ่มปลายเดือน M) */
  daily: Satang
  /** เก็บเงินระหว่างรอบนี้ */
  savedDeposits: Satang
  /** เงินรอบนี้เหลือ = เงินตั้งต้น − ใช้รายวัน − เก็บระหว่างเดือน */
  left: Satang
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
  records: MonthRecord[] = [],
): MonthSummary {
  const spendMonth = addMonths(month, 1)
  const cycleRecords = record && !records.some((r) => r.month === record.month) ? [...records, record] : records
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
  const daily = txs.reduce((s, t) => (transactionCycle(t, cycleRecords) === month ? s + t.amount : s), 0)
  let savedDeposits = 0
  let savedAtClose = 0
  for (const sv of savings) {
    const m = monthOf(sv.date)
    if (sv.kind === 'close' && m === month) savedAtClose += sv.amount
    else if (sv.kind === 'deposit' && transactionCycle(sv, cycleRecords) === month) savedDeposits += sv.amount
  }
  const planLeft = income - fixedExpense
  const actualBalance = record?.actualBalance ?? null
  const startMoney = (actualBalance ?? planLeft) - savedAtClose
  return {
    month,
    spendMonth,
    income,
    fixedExpense,
    planLeft,
    actualBalance,
    diff: actualBalance === null ? null : actualBalance - planLeft,
    savedAtClose,
    startMoney,
    daily,
    savedDeposits,
    left: startMoney - daily - savedDeposits,
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
