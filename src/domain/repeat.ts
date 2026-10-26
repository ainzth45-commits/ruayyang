import { addDays } from './month'
import type { Category, DateKey, Satang, Transaction } from './types'

export interface RepeatPick {
  categoryId: string
  note: string | null
  amount: Satang
  count: number
}

/** ชิป "จดซ้ำ": รายการที่จดบ่อยใน 30 วันล่าสุด (หมวด + โน้ต + ยอดเดียวกัน) เรียงตามความถี่ → ล่าสุด */
export function repeatSuggestions(txs: Transaction[], today: DateKey, limit: number): RepeatPick[] {
  const from = addDays(today, -30)
  const groups = new Map<string, RepeatPick & { last: string }>()
  for (const t of txs) {
    if (!t.categoryId || t.date < from || t.date > today) continue
    const note = t.note?.trim() || null
    const k = `${t.categoryId}|${note ?? ''}|${t.amount}`
    const last = t.date + t.createdAt
    const g = groups.get(k)
    if (g) {
      g.count++
      if (last > g.last) g.last = last
    } else groups.set(k, { categoryId: t.categoryId, note, amount: t.amount, count: 1, last })
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, limit)
    .map(({ last: _last, ...p }) => p)
}

/** หมวดที่ใช้บ่อยใน 60 วันล่าสุดขึ้นก่อน ที่เหลือตามลำดับเดิม (ซ่อนหมวดที่เก็บไว้) */
export function orderCategories(cats: Category[], txs: Transaction[], today: DateKey): Category[] {
  const from = addDays(today, -60)
  const used = new Map<string, number>()
  for (const t of txs) if (t.categoryId && t.date >= from && t.date <= today) used.set(t.categoryId, (used.get(t.categoryId) ?? 0) + 1)
  return cats
    .filter((c) => !c.archived)
    .sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || a.sort - b.sort)
}
