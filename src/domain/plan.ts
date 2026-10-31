import type { Repo } from '../data/repo'
import { addMonths, isActiveIn, monthRange } from './month'
import { toSatang } from './money'
import type { Category, MonthKey, NewEntry, RecurringItem, Satang } from './types'

/**
 * สร้างรายการประจำให้เดือนที่ยังไม่เคยเปิด (idempotent)
 * ลำดับ: ใส่ entries ก่อน แล้วค่อยบันทึกแถว months — ถ้าพังกลางทาง รอบหน้าจะเติมต่อได้โดยไม่ซ้ำ
 */
export async function ensureMonths(repo: Repo, from: MonthKey, to: MonthKey): Promise<void> {
  const wanted = monthRange(from, to)
  if (wanted.length === 0) return
  const existing = new Set((await repo.listMonths(from, to)).map((m) => m.month))
  const missing = wanted.filter((m) => !existing.has(m))
  if (missing.length === 0) return
  const items = await repo.listItems()
  const entries: NewEntry[] = []
  for (const month of missing) {
    for (const it of items) {
      if (isActiveIn(it, month)) entries.push({ itemId: it.id, month, amount: it.defaultAmount, paid: false, note: null })
    }
  }
  if (entries.length) await repo.insertEntriesIfAbsent(entries)
  await repo.insertMonthsIfAbsent(missing)
}

/**
 * รายการประจำที่เพิ่มใหม่ → ใส่ยอดลงเดือนที่เปิดไว้แล้วทุกเดือนในช่วง [เดือนเริ่ม, เดือนสุดท้าย]
 * (ensureMonths เติมให้เฉพาะเดือนที่ยังไม่เคยเปิด) คืนจำนวนเดือนที่เพิ่ม
 */
export async function addItemToExistingMonths(repo: Repo, item: RecurringItem): Promise<number> {
  const months = await repo.listMonths(item.startMonth, item.endMonth ?? '9999-12')
  const have = new Set((await repo.listEntries(item.startMonth, item.endMonth ?? '9999-12')).filter((e) => e.itemId === item.id).map((e) => e.month))
  const entries: NewEntry[] = months
    .filter((m) => !have.has(m.month) && isActiveIn(item, m.month))
    .map((m) => ({ itemId: item.id, month: m.month, amount: item.defaultAmount, paid: false, note: null }))
  if (entries.length) await repo.insertEntriesIfAbsent(entries)
  return entries.length
}

/** เปลี่ยนยอดตั้งต้น + อัปเดตเดือนที่ยังไม่จ่ายตั้งแต่ fromMonth คืนจำนวนเดือนที่อัปเดต */
export async function applyDefaultToFuture(repo: Repo, item: RecurringItem, amount: Satang, fromMonth: MonthKey): Promise<number> {
  await repo.saveItem({ ...item, defaultAmount: amount })
  const entries = await repo.listEntries(fromMonth, '9999-12')
  const targets = entries.filter((e) => e.itemId === item.id && !e.paid && e.amount !== amount)
  for (const e of targets) await repo.updateEntry(e.id, { amount })
  return targets.length
}

/**
 * เลิกรายการประจำตั้งแต่ fromMonth: ลบเดือนที่ยังไม่จ่าย เก็บที่จ่ายแล้วไว้เป็นประวัติ
 * เดือนสุดท้ายเลื่อนได้แค่ "เข้ามา" — รายการที่จบไปแล้วต้องไม่ถูกยืดออก
 */
export async function stopItem(repo: Repo, item: RecurringItem, fromMonth: MonthKey, patch: Partial<RecurringItem> = {}): Promise<string | null> {
  const stopAt = addMonths(fromMonth, -1)
  const endMonth = item.endMonth !== null && item.endMonth < stopAt ? item.endMonth : stopAt
  await repo.saveItem({ ...item, ...patch, endMonth })
  const entries = await repo.listEntries(fromMonth, '9999-12')
  const ids = entries.filter((e) => e.itemId === item.id && !e.paid).map((e) => e.id)
  return ids.length ? repo.deleteEntries(ids) : null
}

/** ลบรายการประจำ: เลิกตั้งแต่ fromMonth + ซ่อนจากหน้าตั้งค่า (เดือนที่ผ่านมา/จ่ายแล้วเก็บไว้เป็นประวัติ) */
export function removeItem(repo: Repo, item: RecurringItem, fromMonth: MonthKey): Promise<string | null> {
  return stopItem(repo, item, fromMonth, { archived: true })
}

export const DEFAULT_CATEGORIES: Omit<Category, 'id' | 'sort' | 'archived'>[] = [
  { name: 'อาหาร', icon: 'utensils' },
  { name: 'เครื่องดื่ม', icon: 'coffee' },
  { name: 'เดินทาง/น้ำมัน', icon: 'fuel' },
  { name: 'ของใช้', icon: 'shopping-basket' },
  { name: 'ช้อปปิ้ง', icon: 'shopping-bag' },
  { name: 'สุขภาพ', icon: 'heart-pulse' },
  { name: 'บันเทิง', icon: 'gamepad' },
  { name: 'ให้/ทำบุญ', icon: 'gift' },
  { name: 'อื่นๆ', icon: 'more' },
]

const seeding = new WeakMap<Repo, Promise<void>>()

/** สร้างหมวดเริ่มต้นครั้งแรก — กันเรียกซ้อนพร้อมกัน (StrictMode / หลายจุด) ด้วย promise เดียวต่อ repo */
export function ensureDefaultCategories(repo: Repo): Promise<void> {
  let p = seeding.get(repo)
  if (!p) {
    p = seedCategories(repo).finally(() => seeding.delete(repo))
    seeding.set(repo, p)
  }
  return p
}

async function seedCategories(repo: Repo): Promise<void> {
  if ((await repo.listCategories()).length > 0) return
  for (const [sort, c] of DEFAULT_CATEGORIES.entries()) {
    await repo.saveCategory({ ...c, sort, archived: false })
  }
}

/** รูปแบบไฟล์ private/seed.json จาก scripts/import_xlsx.py */
export interface Seed {
  paid_until: MonthKey
  months: { month: MonthKey; actual_balance: string | null }[]
  items: {
    name: string
    kind: 'income' | 'expense'
    is_estimate: boolean
    default_amount: string
    start_month: MonthKey
    end_month: MonthKey | null
    sort: number
    entries: Record<MonthKey, string>
  }[]
}

export async function importSeed(repo: Repo, seed: Seed): Promise<void> {
  if ((await repo.listItems()).length > 0) throw new Error('มีข้อมูลอยู่แล้ว ไม่นำเข้าซ้ำ')
  const entries: NewEntry[] = []
  for (const s of seed.items) {
    const item = await repo.saveItem({
      name: s.name,
      kind: s.kind,
      defaultAmount: toSatang(s.default_amount),
      isEstimate: s.is_estimate,
      startMonth: s.start_month,
      endMonth: s.end_month,
      sort: s.sort,
      archived: false,
    })
    for (const [month, amount] of Object.entries(s.entries)) {
      entries.push({ itemId: item.id, month, amount: toSatang(amount), paid: month <= seed.paid_until, note: null })
    }
  }
  await repo.insertEntriesIfAbsent(entries)
  await repo.insertMonthsIfAbsent(seed.months.map((m) => m.month))
  for (const m of seed.months) {
    if (m.actual_balance !== null) await repo.setActualBalance(m.month, toSatang(m.actual_balance))
  }
}
