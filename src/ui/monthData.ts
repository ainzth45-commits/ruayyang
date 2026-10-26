import type { Repo } from '../data/repo'
import { effectiveBudget } from '../domain/budget'
import { summarizeMonth, type MonthSummary } from '../domain/calc'
import { monthEndDate, monthStartDate } from '../domain/month'
import { ensureMonths } from '../domain/plan'
import { savingsTotal } from '../domain/savings'
import type { Category, MonthEntry, MonthKey, MonthRecord, RecurringItem, Satang, Saving, Transaction } from '../domain/types'

export interface MonthData {
  month: MonthKey
  items: RecurringItem[]
  entries: MonthEntry[]
  txs: Transaction[]
  categories: Category[]
  /** ทุกเดือนตั้งแต่ต้นจนถึงเดือนนี้ (ใช้หางบที่สืบทอด + เช็กการปิดเดือน) */
  records: MonthRecord[]
  record: MonthRecord | null
  /** งบใช้จ่ายที่ใช้จริงของเดือนนี้ */
  budget: Satang | null
  /** เงินเก็บของเดือนนี้ */
  savings: Saving[]
  /** เงินเก็บสะสมถึงสิ้นเดือนนี้ */
  savingsTotal: Satang
  summary: MonthSummary
}

export async function loadMonth(repo: Repo, month: MonthKey): Promise<MonthData> {
  await ensureMonths(repo, month, month)
  const [items, entries, txs, records, categories, allSavings, settings] = await Promise.all([
    repo.listItems(),
    repo.listEntries(month, month),
    repo.listTransactions(monthStartDate(month), monthEndDate(month)),
    repo.listMonths('2000-01', month),
    repo.listCategories(),
    repo.listSavings('2000-01-01', monthEndDate(month)),
    repo.getSettings(),
  ])
  const record = records.find((r) => r.month === month) ?? null
  const savings = allSavings.filter((s) => s.date >= monthStartDate(month))
  return {
    month,
    items,
    entries,
    txs,
    categories,
    records,
    record,
    budget: effectiveBudget(month, records),
    savings,
    savingsTotal: savingsTotal(settings.savingsOpening, allSavings),
    summary: summarizeMonth(month, items, entries, txs, record, savings),
  }
}
