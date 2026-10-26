import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { Auth, AuthUser, Repo } from './repo'
import { fromSatang, toSatang } from '../domain/money'
import type { Category, MonthEntry, MonthKey, MonthRecord, NewEntry, NewSaving, NewTransaction, RecurringItem, Saving, Transaction, UserSettings } from '../domain/types'

const toDate = (m: MonthKey) => `${m}-01`
const toMonth = (d: string): MonthKey => d.slice(0, 7)
const money = (v: number | string | null) => (v === null ? null : toSatang(v))

function fail(error: PostgrestError | Error | null, what: string): never {
  console.error(what, error)
  const msg = error?.message ?? ''
  if ('code' in (error ?? {}) && (error as PostgrestError).code === '23505') throw new Error('ข้อมูลนี้มีอยู่แล้ว')
  if (/JWT|token|401/i.test(msg)) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')
  if (/fetch|network|Failed to/i.test(msg)) throw new Error('เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่')
  throw new Error(`${what}ไม่สำเร็จ`)
}

type Row = Record<string, any>

const mapCategory = (r: Row): Category => ({ id: r.id, name: r.name, icon: r.icon, sort: r.sort, archived: r.archived })
const mapItem = (r: Row): RecurringItem => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  defaultAmount: toSatang(r.default_amount),
  isEstimate: r.is_estimate,
  startMonth: toMonth(r.start_month),
  endMonth: r.end_month ? toMonth(r.end_month) : null,
  sort: r.sort,
  archived: r.archived,
})
const mapEntry = (r: Row): MonthEntry => ({
  id: r.id, itemId: r.item_id, month: toMonth(r.month), amount: toSatang(r.amount), paid: r.paid, note: r.note,
})
const mapMonth = (r: Row): MonthRecord => ({
  month: toMonth(r.month),
  actualBalance: money(r.actual_balance),
  spendBudget: money(r.spend_budget ?? null),
  closedAt: r.closed_at ?? null,
})
const mapSaving = (r: Row): Saving => ({
  id: r.id, date: r.date, amount: toSatang(r.amount), note: r.note, kind: r.kind, createdAt: r.created_at,
})
function savingRow(x: Partial<NewSaving>): Row {
  const r: Row = {}
  if (x.date !== undefined) r.date = x.date
  if (x.amount !== undefined) r.amount = fromSatang(x.amount)
  if (x.note !== undefined) r.note = x.note
  if (x.kind !== undefined) r.kind = x.kind
  return r
}
const mapTx = (r: Row): Transaction => ({
  id: r.id,
  date: r.date,
  amount: toSatang(r.amount),
  categoryId: r.category_id,
  note: r.note,
  slipPath: r.slip_path,
  slipHash: r.slip_hash,
  ocrAmount: money(r.ocr_amount),
  createdAt: r.created_at,
})

function txRow(t: Partial<NewTransaction>): Row {
  const r: Row = {}
  if (t.date !== undefined) r.date = t.date
  if (t.amount !== undefined) r.amount = fromSatang(t.amount)
  if (t.categoryId !== undefined) r.category_id = t.categoryId
  if (t.note !== undefined) r.note = t.note
  if (t.slipPath !== undefined) r.slip_path = t.slipPath
  if (t.slipHash !== undefined) r.slip_hash = t.slipHash
  if (t.ocrAmount !== undefined) r.ocr_amount = t.ocrAmount === null ? null : fromSatang(t.ocrAmount)
  return r
}

export class SupabaseRepo implements Repo {
  readonly kind = 'supabase' as const
  constructor(private sb: SupabaseClient) {}

  private async uid(): Promise<string> {
    const { data } = await this.sb.auth.getSession()
    const id = data.session?.user.id
    if (!id) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')
    return id
  }

  async listCategories() {
    const { data, error } = await this.sb.from('categories').select('*').order('sort')
    if (error) fail(error, 'โหลดหมวด')
    return data.map(mapCategory)
  }

  async saveCategory(c: Omit<Category, 'id'> & { id?: string }) {
    const row = { ...(c.id ? { id: c.id } : {}), name: c.name, icon: c.icon, sort: c.sort, archived: c.archived }
    const { data, error } = await this.sb.from('categories').upsert(row).select().single()
    if (error) fail(error, 'บันทึกหมวด')
    return mapCategory(data)
  }

  async listItems() {
    const { data, error } = await this.sb.from('recurring_items').select('*').order('sort')
    if (error) fail(error, 'โหลดรายการประจำ')
    return data.map(mapItem)
  }

  async saveItem(i: Omit<RecurringItem, 'id'> & { id?: string }) {
    const row = {
      ...(i.id ? { id: i.id } : {}),
      name: i.name,
      kind: i.kind,
      default_amount: fromSatang(i.defaultAmount),
      is_estimate: i.isEstimate,
      start_month: toDate(i.startMonth),
      end_month: i.endMonth ? toDate(i.endMonth) : null,
      sort: i.sort,
      archived: i.archived,
    }
    const { data, error } = await this.sb.from('recurring_items').upsert(row).select().single()
    if (error) fail(error, 'บันทึกรายการประจำ')
    return mapItem(data)
  }

  async listMonths(from: MonthKey, to: MonthKey) {
    const { data, error } = await this.sb.from('months').select('*').gte('month', toDate(from)).lte('month', toDate(to)).order('month')
    if (error) fail(error, 'โหลดข้อมูลเดือน')
    return data.map(mapMonth)
  }

  async insertMonthsIfAbsent(months: MonthKey[]) {
    if (!months.length) return
    const user_id = await this.uid()
    const { error } = await this.sb
      .from('months')
      .upsert(months.map((m) => ({ user_id, month: toDate(m) })), { onConflict: 'user_id,month', ignoreDuplicates: true })
    if (error) fail(error, 'สร้างเดือน')
  }

  async setActualBalance(month: MonthKey, value: number | null) {
    const user_id = await this.uid()
    const { error } = await this.sb
      .from('months')
      .upsert({ user_id, month: toDate(month), actual_balance: value === null ? null : fromSatang(value) }, { onConflict: 'user_id,month' })
    if (error) fail(error, 'บันทึกคงเหลือจริง')
  }

  private async patchMonth(month: MonthKey, patch: Row, what: string) {
    const user_id = await this.uid()
    const { error } = await this.sb.from('months').upsert({ user_id, month: toDate(month), ...patch }, { onConflict: 'user_id,month' })
    if (error) fail(error, what)
  }

  async setMonthBudget(month: MonthKey, value: number | null) {
    await this.patchMonth(month, { spend_budget: value === null ? null : fromSatang(value) }, 'บันทึกงบใช้จ่าย')
  }

  async setMonthClosed(month: MonthKey, closedAt: string | null) {
    await this.patchMonth(month, { closed_at: closedAt }, 'บันทึกการปิดเดือน')
  }

  async listEntries(from: MonthKey, to: MonthKey) {
    const { data, error } = await this.sb.from('month_entries').select('*').gte('month', toDate(from)).lte('month', toDate(to))
    if (error) fail(error, 'โหลดรายการเดือน')
    return data.map(mapEntry)
  }

  async insertEntriesIfAbsent(entries: NewEntry[]) {
    if (!entries.length) return
    const user_id = await this.uid()
    const rows = entries.map((e) => ({
      user_id, item_id: e.itemId, month: toDate(e.month), amount: fromSatang(e.amount), paid: e.paid, note: e.note,
    }))
    // แบ่ง batch กัน payload ใหญ่เกิน
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.sb
        .from('month_entries')
        .upsert(rows.slice(i, i + 500), { onConflict: 'user_id,item_id,month', ignoreDuplicates: true })
      if (error) fail(error, 'สร้างรายการเดือน')
    }
  }

  async updateEntry(id: string, patch: Partial<Pick<MonthEntry, 'amount' | 'paid' | 'note'>>) {
    const row: Row = {}
    if (patch.amount !== undefined) row.amount = fromSatang(patch.amount)
    if (patch.paid !== undefined) row.paid = patch.paid
    if (patch.note !== undefined) row.note = patch.note
    const { error, count } = await this.sb.from('month_entries').update(row, { count: 'exact' }).eq('id', id)
    if (error) fail(error, 'บันทึกรายการ')
    if (count === 0) throw new Error('ไม่พบรายการนี้แล้ว')
  }

  async deleteEntries(ids: string[]) {
    if (!ids.length) return
    const { error } = await this.sb.from('month_entries').delete().in('id', ids)
    if (error) fail(error, 'ลบรายการ')
  }

  async listTransactions(from: string, to: string) {
    const { data, error } = await this.sb
      .from('transactions')
      .select('*')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) fail(error, 'โหลดรายจ่าย')
    return data.map(mapTx)
  }

  async findTransactionBySlipHash(hash: string) {
    const { data, error } = await this.sb.from('transactions').select('*').eq('slip_hash', hash).maybeSingle()
    if (error) fail(error, 'ตรวจสลิปซ้ำ')
    return data ? mapTx(data) : null
  }

  async addTransaction(t: NewTransaction) {
    const { data, error } = await this.sb.from('transactions').insert(txRow(t)).select().single()
    if (error?.code === '23505') throw new Error('สลิปนี้บันทึกไปแล้ว')
    if (error) fail(error, 'บันทึกรายจ่าย')
    return mapTx(data)
  }

  async updateTransaction(id: string, patch: Partial<NewTransaction>) {
    const { error, count } = await this.sb.from('transactions').update(txRow(patch), { count: 'exact' }).eq('id', id)
    if (error) fail(error, 'แก้ไขรายจ่าย')
    if (count === 0) throw new Error('ไม่พบรายการนี้แล้ว')
  }

  async deleteTransaction(id: string) {
    const { error } = await this.sb.from('transactions').delete().eq('id', id)
    if (error) fail(error, 'ลบรายจ่าย')
  }

  async listSavings(from: string, to: string) {
    const { data, error } = await this.sb
      .from('savings')
      .select('*')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) fail(error, 'โหลดเงินเก็บ')
    return data.map(mapSaving)
  }

  async addSaving(x: NewSaving) {
    const { data, error } = await this.sb.from('savings').insert(savingRow(x)).select().single()
    if (error) fail(error, 'บันทึกเงินเก็บ')
    return mapSaving(data)
  }

  async updateSaving(id: string, patch: Partial<NewSaving>) {
    const { error, count } = await this.sb.from('savings').update(savingRow(patch), { count: 'exact' }).eq('id', id)
    if (error) fail(error, 'แก้ไขเงินเก็บ')
    if (count === 0) throw new Error('ไม่พบรายการนี้แล้ว')
  }

  async deleteSaving(id: string) {
    const { error } = await this.sb.from('savings').delete().eq('id', id)
    if (error) fail(error, 'ลบเงินเก็บ')
  }

  async getSettings(): Promise<UserSettings> {
    const { data, error } = await this.sb.from('user_settings').select('*').maybeSingle()
    if (error) fail(error, 'โหลดการตั้งค่า')
    return { savingsOpening: data ? toSatang(data.savings_opening) : 0 }
  }

  async saveSettings(v: UserSettings) {
    const user_id = await this.uid()
    const { error } = await this.sb
      .from('user_settings')
      .upsert({ user_id, savings_opening: fromSatang(v.savingsOpening), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) fail(error, 'บันทึกการตั้งค่า')
  }

  async uploadSlip(file: Blob, month: MonthKey) {
    const path = `${await this.uid()}/${month}/${crypto.randomUUID()}.jpg`
    const { error } = await this.sb.storage.from('slips').upload(path, file, { contentType: 'image/jpeg', upsert: false })
    if (error) fail(error, 'อัปโหลดสลิป')
    return path
  }

  async slipUrl(path: string) {
    const { data, error } = await this.sb.storage.from('slips').createSignedUrl(path, 3600)
    if (error) fail(error, 'เปิดรูปสลิป')
    return data.signedUrl
  }

  async deleteSlip(path: string) {
    const { error } = await this.sb.storage.from('slips').remove([path])
    if (error) fail(error, 'ลบรูปสลิป')
  }
}

export class SupabaseAuth implements Auth {
  constructor(private sb: SupabaseClient) {}

  async currentUser(): Promise<AuthUser | null> {
    const { data } = await this.sb.auth.getSession()
    const u = data.session?.user
    return u ? { id: u.id, email: u.email ?? '' } : null
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password })
    if (error) {
      if (/invalid/i.test(error.message)) throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
      if (/fetch|network/i.test(error.message)) throw new Error('เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่')
      throw new Error('เข้าสู่ระบบไม่สำเร็จ')
    }
    return { id: data.user.id, email: data.user.email ?? '' }
  }

  async signOut() {
    await this.sb.auth.signOut()
  }

  onChange(cb: (user: AuthUser | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange((_e, session) => {
      const u = session?.user
      cb(u ? { id: u.id, email: u.email ?? '' } : null)
    })
    return () => data.subscription.unsubscribe()
  }
}
