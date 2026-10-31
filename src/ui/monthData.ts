import type { Repo } from '../data/repo'
import { effectiveBudget } from '../domain/budget'
import { activeCycle } from '../domain/cycle'
import { summarizeMonth, type MonthSummary } from '../domain/calc'
import { addMonths, bangkokToday, monthEndDate, monthOf, monthStartDate } from '../domain/month'
import { ensureMonths } from '../domain/plan'
import { savingsTotal } from '../domain/savings'
import type { Category, MonthEntry, MonthKey, MonthRecord, RecurringItem, Satang, Saving, Transaction } from '../domain/types'

export interface MonthData {
  month: MonthKey
  items: RecurringItem[]
  /** รายการประจำของเดือนนี้ */
  entries: MonthEntry[]
  /** รายจ่ายรายวันของเดือนนี้ (ตามปฏิทิน) */
  txs: Transaction[]
  categories: Category[]
  /** เดือนตั้งแต่ต้นจนถึงเดือนถัดไป (ใช้งบสืบทอดและขอบเขตรอบเงินจริง) */
  records: MonthRecord[]
  record: MonthRecord | null
  /** งบใช้จ่ายที่ใช้จริงของเดือนนี้ */
  budget: Satang | null
  /** เงินเก็บที่ลงวันที่ในเดือนนี้ */
  savings: Saving[]
  /** เงินเก็บสะสมถึงสิ้นเดือนนี้ */
  savingsTotal: Satang
  /** รอบเงินเดือนของเดือนนี้ (เงินไว้ใช้เดือนหน้า) */
  summary: MonthSummary
  /** รอบที่ปิดยอดและเปิดใช้แล้วล่าสุด (null ถ้ายังไม่มีเงินจริงตั้งต้น) */
  spending: MonthSummary | null
}

export async function loadMonth(repo: Repo, month: MonthKey, nowIso = new Date().toISOString()): Promise<MonthData> {
  await ensureMonths(repo, month, month)
  const prev = addMonths(month, -1)
  const next = addMonths(month, 1)
  const records = await repo.listMonths('2000-01', next)
  const today = bangkokToday(new Date(nowIso))
  const viewDate = month === monthOf(today) ? today : monthEndDate(month)
  const opened = activeCycle(records, viewDate, nowIso)
  const from = opened && opened.month < prev ? opened.month : prev
  const [items, entries, txs, categories, allSavings, settings] = await Promise.all([
    repo.listItems(),
    repo.listEntries(from, month),
    repo.listTransactions(monthStartDate(from), monthEndDate(next)),
    repo.listCategories(),
    repo.listSavings('2000-01-01', monthEndDate(next)),
    repo.getSettings(),
  ])
  const record = records.find((r) => r.month === month) ?? null
  const upToMonth = allSavings.filter((s) => s.date <= monthEndDate(month))
  return {
    month,
    items,
    entries: entries.filter((e) => e.month === month),
    txs: txs.filter((t) => monthOf(t.date) === month),
    categories,
    records,
    record,
    budget: effectiveBudget(month, records),
    savings: allSavings.filter((s) => monthOf(s.date) === month),
    savingsTotal: savingsTotal(settings.savingsOpening, upToMonth),
    summary: summarizeMonth(month, items, entries, txs, record, allSavings, records),
    spending: opened ? summarizeMonth(opened.month, items, entries, txs, opened, allSavings, records) : null,
  }
}
