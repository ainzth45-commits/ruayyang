import type { Repo } from './repo'
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

  private clone<T>(v: T): T {
    return structuredClone(v)
  }

  async listCategories() {
    return this.clone([...this.s.categories].sort((a, b) => a.sort - b.sort))
  }

  async saveCategory(c: Omit<Category, 'id'> & { id?: string }) {
    const row: Category = { ...c, id: c.id ?? crypto.randomUUID() }
    upsertBy(this.s.categories, row, (x) => x.id === row.id)
    this.save()
    return this.clone(row)
  }

  async listItems() {
    return this.clone([...this.s.items].sort((a, b) => a.sort - b.sort))
  }

  async saveItem(item: Omit<RecurringItem, 'id'> & { id?: string }) {
    const row: RecurringItem = { ...item, id: item.id ?? crypto.randomUUID() }
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

  async listEntries(from: string, to: string) {
    return this.clone(this.s.entries.filter((e) => e.month >= from && e.month <= to))
  }

  async insertEntriesIfAbsent(entries: Omit<MonthEntry, 'id'>[]) {
    for (const e of entries) {
      if (this.s.entries.some((x) => x.itemId === e.itemId && x.month === e.month)) continue
      this.s.entries.push({ ...e, id: crypto.randomUUID() })
    }
    this.save()
  }

  async updateEntry(id: string, patch: Partial<Pick<MonthEntry, 'amount' | 'paid' | 'note'>>) {
    const row = this.s.entries.find((e) => e.id === id)
    if (!row) throw new Error('ไม่พบรายการนี้แล้ว')
    Object.assign(row, patch)
    this.save()
  }

  async deleteEntries(ids: string[]) {
    const set = new Set(ids)
    this.s.entries = this.s.entries.filter((e) => !set.has(e.id))
    this.save()
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
    const row: Transaction = { ...t, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    this.s.transactions.push(row)
    this.save()
    return this.clone(row)
  }

  async updateTransaction(id: string, patch: Partial<Omit<Transaction, 'id' | 'createdAt'>>) {
    const row = this.s.transactions.find((t) => t.id === id)
    if (!row) throw new Error('ไม่พบรายการนี้แล้ว')
    Object.assign(row, patch)
    this.save()
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
    const row: Saving = { ...x, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    this.s.savings.push(row)
    this.save()
    return this.clone(row)
  }

  async updateSaving(id: string, patch: Partial<NewSaving>) {
    const row = this.s.savings.find((x) => x.id === id)
    if (!row) throw new Error('ไม่พบรายการนี้แล้ว')
    if (patch.amount !== undefined) checkAmount(patch.amount)
    Object.assign(row, patch)
    this.save()
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
    const path = `local/${month}/${crypto.randomUUID()}.jpg`
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
