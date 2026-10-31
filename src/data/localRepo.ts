import type { Repo } from './repo'
import { cycleForDate } from '../domain/cycle'
import { MAX_SATANG } from '../domain/money'
import { monthEndDate } from '../domain/month'
import type { Category, MonthEntry, MonthRecord, NewSaving, RecurringItem, Saving, Transaction, UserSettings } from '../domain/types'

/** ที่เก็บรูปสลิปของ LocalRepo (เบราว์เซอร์ใช้ IndexedDB, เทสใช้ Map) */
export interface SlipStore {
  put(path: string, blob: Blob): Promise<void>
  get(path: string): Promise<Blob | null>
  del(path: string): Promise<void>
}

export interface KV {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface State {
  categories: Category[]
  items: RecurringItem[]
  months: MonthRecord[]
  entries: MonthEntry[]
  transactions: Transaction[]
  savings: Saving[]
  settings: UserSettings
}

const KEY = 'ledger-local-v1'
/** HTTP บน LAN ไม่มี randomUUID แต่ getRandomValues ยังใช้ได้บน iPhone */
function newLocalId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
const empty = (): State => ({ categories: [], items: [], months: [], entries: [], transactions: [], savings: [], settings: { savingsOpening: 0 } })
const newMonth = (month: string): MonthRecord => ({ month, actualBalance: null, spendBudget: null, closedAt: null })

function checkAmount(v: number) {
  if (!Number.isInteger(v) || v <= 0) throw new Error('ยอดต้องมากกว่า 0')
}

export function memorySlipStore(): SlipStore {
  const m = new Map<string, Blob>()
  return {
    async put(p, b) { m.set(p, b) },
    async get(p) { return m.get(p) ?? null },
    async del(p) { m.delete(p) },
  }
}

export function memoryKV(): KV {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

/** เก็บข้อมูลไว้ในเครื่อง — ใช้สำหรับ preview/dev เท่านั้น */
export class LocalRepo implements Repo {
  readonly kind = 'local' as const
  private s: State

  constructor(private kv: KV, private slips: SlipStore) {
    const raw = kv.getItem(KEY)
    this.s = raw ? { ...empty(), ...JSON.parse(raw) } : empty()
    // ข้อมูลที่เก็บไว้ก่อนรอบ 2 ไม่มีฟิลด์ใหม่
    this.s.months = this.s.months.map((m) => ({ ...newMonth(m.month), ...m }))
  }

  isEmpty(): boolean {
    return this.s.items.length === 0 && this.s.transactions.length === 0
  }

  private save() {
    this.kv.setItem(KEY, JSON.stringify(this.s))
  }

  /** Persist the candidate before publishing it in memory (quota failure leaves both unchanged). */
  private commit(next: State) {
    this.kv.setItem(KEY, JSON.stringify(next))
    this.s = next
  }

  private clone<T>(v: T): T {
    return structuredClone(v)
  }

  async listCategories() {
    return this.clone([...this.s.categories].sort((a, b) => a.sort - b.sort))
  }

  async saveCategory(c: Omit<Category, 'id'> & { id?: string }) {
    const row: Category = { ...c, id: c.id ?? newLocalId() }
    upsertBy(this.s.categories, row, (x) => x.id === row.id)
    this.save()
    return this.clone(row)
  }

  async listItems() {
    return this.clone([...this.s.items].sort((a, b) => a.sort - b.sort))
  }

  async saveItem(item: Omit<RecurringItem, 'id'> & { id?: string }) {
    const row: RecurringItem = { ...item, id: item.id ?? newLocalId() }
    upsertBy(this.s.items, row, (x) => x.id === row.id)
    this.save()
    return this.clone(row)
  }

  async listMonths(from: string, to: string) {
    return this.clone(this.s.months.filter((m) => m.month >= from && m.month <= to))
  }

  async insertMonthsIfAbsent(months: string[]) {
    for (const month of months) {
      if (!this.s.months.some((m) => m.month === month)) this.s.months.push(newMonth(month))
    }
    this.save()
  }

  private patchMonth(month: string, patch: Partial<MonthRecord>) {
    const row = this.s.months.find((m) => m.month === month)
    if (row) Object.assign(row, patch)
    else this.s.months.push({ ...newMonth(month), ...patch })
    this.save()
  }

  async setActualBalance(month: string, value: number | null) {
    this.patchMonth(month, { actualBalance: value })
  }

  async setMonthBudget(month: string, value: number | null) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) throw new Error('งบต้องไม่ติดลบ')
    this.patchMonth(month, { spendBudget: value })
  }

  async setMonthClosed(month: string, closedAt: string | null) {
    this.patchMonth(month, { closedAt })
  }

  async closeMonthAtomic(month: string, actual: number, save: number, nowIso: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isFinite(Date.parse(nowIso))) throw new Error('รอบเงินหรือเวลาปิดยอดไม่ถูกต้อง')
    if (!Number.isSafeInteger(actual) || Math.abs(actual) > MAX_SATANG || !Number.isSafeInteger(save) || save < 0 || save > Math.max(actual, 0)) throw new Error('ยอดปิดหรือยอดแยกเก็บไม่ถูกต้อง')
    const next = this.clone(this.s)
    const record = next.months.find((m) => m.month === month)
    if (record) {
      // Imported snapshots with an actual balance already have an implicit opening
      // on next month's first day. Retain null instead of moving that boundary to now.
      const closedAt = record.actualBalance !== null ? record.closedAt : record.closedAt ?? nowIso
      Object.assign(record, { actualBalance: actual, closedAt })
    }
    else next.months.push({ ...newMonth(month), actualBalance: actual, closedAt: nowIso })
    const date = monthEndDate(month)
    const existing = next.savings.find((s) => s.kind === 'close' && s.date === date)
    next.savings = next.savings.filter((s) => s.kind !== 'close' || s.date !== date || (save > 0 && s.id === existing?.id))
    if (save > 0) {
      if (existing) existing.amount = save
      else next.savings.push({ id: newLocalId(), date, amount: save, note: 'แยกเก็บตอนปิดเดือน', kind: 'close', createdAt: nowIso, cycleMonth: month })
    }
    this.commit(next)
  }

  async listEntries(from: string, to: string) {
    return this.clone(this.s.entries.filter((e) => e.month >= from && e.month <= to))
  }

  async insertEntriesIfAbsent(entries: Omit<MonthEntry, 'id'>[]) {
    for (const e of entries) {
      if (this.s.entries.some((x) => x.itemId === e.itemId && x.month === e.month)) continue
      this.s.entries.push({ ...e, id: newLocalId() })
    }
    this.save()
  }

  async updateEntry(id: string, patch: Partial<Pick<MonthEntry, 'amount' | 'paid' | 'note' | 'receiptPath'>>) {
    const next = this.clone(this.s)
    const row = next.entries.find((e) => e.id === id)
    if (!row) throw new Error('ไม่พบรายการนี้แล้ว')
    Object.assign(row, patch)
    this.commit(next)
  }

  async deleteEntries(ids: string[]): Promise<string | null> {
    if (!ids.length) return null
    const set = new Set(ids)
    const paths = [...new Set(this.s.entries.filter((e) => set.has(e.id)).map((e) => e.receiptPath).filter((p): p is string => !!p))]
    const next = this.clone(this.s)
    next.entries = next.entries.filter((e) => !set.has(e.id))
    this.commit(next)
    const results = await Promise.allSettled(paths.map((path) => this.deleteSlip(path)))
    return results.some((r) => r.status === 'rejected') ? 'ลบรายการแล้ว แต่ลบรูปหลักฐานบางรูปไม่สำเร็จ' : null
  }

  async listTransactions(from: string, to: string) {
    return this.clone(
      this.s.transactions
        .filter((t) => t.date >= from && t.date <= to)
        .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)),
    )
  }

  async findTransactionBySlipHash(hash: string) {
    return this.clone(this.s.transactions.find((t) => t.slipHash === hash) ?? null)
  }

  async addTransaction(t: Omit<Transaction, 'id' | 'createdAt'>) {
    if (t.slipHash && this.s.transactions.some((x) => x.slipHash === t.slipHash)) {
      throw new Error('สลิปนี้บันทึกไปแล้ว')
    }
    const createdAt = new Date().toISOString()
    const row: Transaction = { ...t, cycleMonth: t.cycleMonth ?? cycleForDate(t.date, this.s.months, createdAt), id: newLocalId(), createdAt }
    const next = this.clone(this.s)
    next.transactions.push(row)
    this.commit(next)
    return this.clone(row)
  }

  async updateTransaction(id: string, patch: Partial<Omit<Transaction, 'id' | 'createdAt'>>) {
    const next = this.clone(this.s)
    const row = next.transactions.find((t) => t.id === id)
    if (!row) throw new Error('ไม่พบรายการนี้แล้ว')
    const resolved = patch.date !== undefined && patch.date !== row.date && patch.cycleMonth === undefined
      ? { ...patch, cycleMonth: cycleForDate(patch.date, this.s.months) } : patch
    Object.assign(row, resolved)
    this.commit(next)
  }

  async deleteTransaction(id: string) {
    this.s.transactions = this.s.transactions.filter((t) => t.id !== id)
    this.save()
  }

  async listSavings(from: string, to: string) {
    return this.clone(
      this.s.savings
        .filter((x) => x.date >= from && x.date <= to)
        .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)),
    )
  }

  async addSaving(x: NewSaving) {
    checkAmount(x.amount)
    if (x.kind === 'close' && this.s.savings.some((y) => y.kind === 'close' && y.date === x.date)) throw new Error('ข้อมูลนี้มีอยู่แล้ว')
    const createdAt = new Date().toISOString()
    const row: Saving = { ...x, ...(x.kind === 'deposit' ? { cycleMonth: x.cycleMonth ?? cycleForDate(x.date, this.s.months, createdAt) } : {}), id: newLocalId(), createdAt }
    const next = this.clone(this.s)
    next.savings.push(row)
    this.commit(next)
    return this.clone(row)
  }

  async updateSaving(id: string, patch: Partial<NewSaving>) {
    const next = this.clone(this.s)
    const row = next.savings.find((x) => x.id === id)
    if (!row) throw new Error('ไม่พบรายการนี้แล้ว')
    if (patch.amount !== undefined) checkAmount(patch.amount)
    const resolved = patch.date !== undefined && patch.date !== row.date && patch.cycleMonth === undefined && (patch.kind ?? row.kind) === 'deposit'
      ? { ...patch, cycleMonth: cycleForDate(patch.date, this.s.months) } : patch
    Object.assign(row, resolved)
    this.commit(next)
  }

  async deleteSaving(id: string) {
    this.s.savings = this.s.savings.filter((x) => x.id !== id)
    this.save()
  }

  async getSettings() {
    return this.clone(this.s.settings)
  }

  async saveSettings(v: UserSettings) {
    if (!Number.isInteger(v.savingsOpening) || v.savingsOpening < 0) throw new Error('ยอดต้องไม่ติดลบ')
    this.s.settings = { ...v }
    this.save()
  }

  async uploadSlip(file: Blob, month: string) {
    const path = `local/${month}/${newLocalId()}.jpg`
    await this.slips.put(path, file)
    return path
  }

  async slipUrl(path: string) {
    const blob = await this.slips.get(path)
    if (!blob) throw new Error('ไม่พบรูปสลิป')
    return URL.createObjectURL(blob)
  }

  async deleteSlip(path: string) {
    await this.slips.del(path)
  }
}

function upsertBy<T>(arr: T[], row: T, match: (x: T) => boolean) {
  const i = arr.findIndex(match)
  if (i >= 0) arr[i] = row
  else arr.push(row)
}

/** IndexedDB สำหรับรูปสลิปใน preview (localStorage จุไม่พอ) */
export function indexedDbSlipStore(): SlipStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ledger-slips', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('slips')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction('slips', mode).objectStore('slips'))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return {
    async put(p, b) { await run('readwrite', (s) => s.put(b, p)) },
    async get(p) { return (await run<Blob | undefined>('readonly', (s) => s.get(p))) ?? null },
    async del(p) { await run('readwrite', (s) => s.delete(p)) },
  }
}
