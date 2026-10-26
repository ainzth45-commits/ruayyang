import type { Repo } from '../data/repo'
import { effectiveBudget } from '../domain/budget'
import { summarizeMonth, type MonthSummary } from '../domain/calc'
import { addMonths, monthEndDate, monthOf, monthStartDate } from '../domain/month'
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
  /** ทุกเดือนตั้งแต่ต้นจนถึงเดือนนี้ (ใช้หางบที่สืบทอด + เช็กการปิดเดือน) */
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
  /** รอบเดือนก่อน = เงินที่กำลังใช้อยู่ในเดือนนี้ (null ถ้าไม่มีเดือนก่อนในระบบ) */
  spending: MonthSummary | null
}

export async function loadMonth(repo: Repo, month: MonthKey): Promise<MonthData> {
  await ensureMonths(repo, month, month)
  const prev = addMonths(month, -1)
  const next = addMonths(month, 1)
  const [items, entries, txs, records, categories, allSavings, settings] = await Promise.all([
    repo.listItems(),
    repo.listEntries(prev, month),
    repo.listTransactions(monthStartDate(month), monthEndDate(next)),
    repo.listMonths('2000-01', month),
    repo.listCategories(),
    repo.listSavings('2000-01-01', monthEndDate(next)),
    repo.getSettings(),
  ])
  const record = records.find((r) => r.month === month) ?? null
  const prevRecord = records.find((r) => r.month === prev) ?? null
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
    summary: summarizeMonth(month, items, entries, txs, record, allSavings),
    spending: prevRecord ? summarizeMonth(prev, items, entries, txs, prevRecord, allSavings) : null,
  }
}
