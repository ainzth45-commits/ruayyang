import type { Repo } from '../data/repo'
import { effectiveBudget } from '../domain/budget'
import { summarizeMonth } from '../domain/calc'
import { savingsTotal } from '../domain/savings'
import { addMonths, bangkokToday, monthEndDate, monthLabel, monthStartDate } from '../domain/month'
import type { Category, MonthEntry, MonthRecord, RecurringItem, Saving, Transaction, UserSettings } from '../domain/types'

type Cell = string | number | null
const baht = (satang: number) => satang / 100

export interface ExportData {
  items: RecurringItem[]
  entries: MonthEntry[]
  records: MonthRecord[]
  txs: Transaction[]
  categories: Category[]
  savings: Saving[]
  settings: UserSettings
}

/** แผ่นงานแบบเดียวกับชีตเดิม: แถว = รายการ, คอลัมน์ = เดือน */
export function buildPlanSheet(d: ExportData): Cell[][] {
  const months = d.records.map((r) => r.month)
  const amount = (itemId: string, m: string) => d.entries.find((e) => e.itemId === itemId && e.month === m)?.amount
  const rowsFor = (kind: 'income' | 'expense') =>
    d.items
      .filter((i) => i.kind === kind && months.some((m) => amount(i.id, m) !== undefined))
      .map((i) => [i.name + (i.isEstimate && !i.name.includes('(') ? ' (ประมาณ)' : ''), ...months.map((m) => { const a = amount(i.id, m); return a === undefined ? null : baht(a) })])
  const sums = d.records.map((r) => summarizeMonth(r.month, d.items, d.entries, d.txs, r, d.savings, d.records))
  const money = (v: number | null) => (v === null ? null : baht(v))
  return [
    ['รายการ', ...months.map((m) => monthLabel(m))],
    ['รายรับ'],
    ...rowsFor('income'),
    ['รวมรายรับ', ...sums.map((s) => baht(s.income))],
    [],
    ['จ่ายประจำ'],
    ...rowsFor('expense'),
    ['รวมจ่ายประจำ', ...sums.map((s) => baht(s.fixedExpense))],
    ['แผนเหลือไว้ใช้เดือนหน้า', ...sums.map((s) => baht(s.planLeft))],
    ['คงเหลือจริง', ...sums.map((s) => money(s.actualBalance))],
    ['เงินเกินแผน', ...sums.map((s) => money(s.diff))],
    ['แยกเก็บตอนปิดเดือน', ...sums.map((s) => baht(s.savedAtClose))],
    [],
    ['ใช้จ่ายเดือนถัดไป'],
    ['เงินตั้งต้น', ...sums.map((s) => baht(s.startMoney))],
    ['ใช้รายวัน', ...sums.map((s) => baht(s.daily))],
    ['เก็บระหว่างเดือน', ...sums.map((s) => baht(s.savedDeposits))],
    ['เงินรอบนี้เหลือ', ...sums.map((s) => baht(s.left))],
    ['งบใช้จ่ายที่ตั้งไว้', ...months.map((m) => money(effectiveBudget(addMonths(m, 1), d.records)))],
  ]
}

export function buildDailySheet(d: ExportData): Cell[][] {
  const cat = new Map(d.categories.map((c) => [c.id, c.name]))
  return [
    ['วันที่', 'หมวด', 'ยอด (บาท)', 'โน้ต', 'มีสลิป'],
    ...[...d.txs]
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .map((t) => [t.date, (t.categoryId && cat.get(t.categoryId)) || '', baht(t.amount), t.note ?? '', t.slipPath ? 'มี' : '']),
  ]
}

export function buildSavingsSheet(d: ExportData): Cell[][] {
  return [
    ['วันที่', 'ประเภท', 'ยอด (บาท)', 'โน้ต'],
    ['', 'ยอดตั้งต้น', baht(d.settings.savingsOpening), ''],
    ...[...d.savings]
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .map((s) => [s.date, s.kind === 'close' ? 'แยกเก็บตอนปิดเดือน' : 'เก็บระหว่างเดือน', baht(s.amount), s.note ?? '']),
    ['', 'รวมเงินเก็บสะสม', baht(savingsTotal(d.settings.savingsOpening, d.savings)), ''],
  ]
}

export function buildItemsSheet(d: ExportData): Cell[][] {
  return [
    ['รายการ', 'ประเภท', 'ยอดตั้งต้น', 'ยอดประมาณ', 'เดือนเริ่ม', 'เดือนสุดท้าย', 'ซ่อน'],
    ...d.items.map((i) => [i.name, i.kind === 'income' ? 'รายรับ' : 'รายจ่าย', baht(i.defaultAmount), i.isEstimate ? 'ใช่' : '', i.startMonth, i.endMonth ?? '', i.archived ? 'ใช่' : '']),
  ]
}

export async function loadExportData(repo: Repo): Promise<ExportData> {
  const records = await repo.listMonths('2000-01', '9999-12')
  const first = records[0]?.month ?? '2000-01'
  const last = records.at(-1)?.month ?? '9999-12'
  const [items, entries, txs, categories, savings, settings] = await Promise.all([
    repo.listItems(),
    repo.listEntries(first, last),
    repo.listTransactions(monthStartDate('2000-01'), monthEndDate('9999-12')),
    repo.listCategories(),
    repo.listSavings(monthStartDate('2000-01'), monthEndDate('9999-12')),
    repo.getSettings(),
  ])
  return { items, entries, records, txs, categories, savings, settings }
}

/** สร้างไฟล์ .xlsx แล้วแชร์ (iOS) หรือดาวน์โหลด */
export async function exportXlsx(repo: Repo): Promise<void> {
  const [XLSX, data] = await Promise.all([import('xlsx'), loadExportData(repo)])
  const wb = XLSX.utils.book_new()
  const plan = XLSX.utils.aoa_to_sheet(buildPlanSheet(data))
  plan['!cols'] = [{ wch: 28 }]
  XLSX.utils.book_append_sheet(wb, plan, 'แผนรายเดือน')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildDailySheet(data)), 'รายจ่ายรายวัน')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildSavingsSheet(data)), 'เงินเก็บ')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildItemsSheet(data)), 'รายการประจำ')
  const name = `ruayyang-backup-${bangkokToday()}.xlsx`
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return // ผู้ใช้กดยกเลิก
    }
  }
  const url = URL.createObjectURL(file)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
