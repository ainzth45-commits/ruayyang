import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { Auth, AuthUser, Repo } from './repo'
import { fromSatang, MAX_SATANG, toSatang } from '../domain/money'
import { cycleForDate } from '../domain/cycle'
import { entryReceipts, validateReceiptEvidence } from '../domain/receipt'
import type { Category, MonthEntry, MonthKey, MonthRecord, NewEntry, NewSaving, NewTransaction, ReceiptCheckMode, ReceiptEvidence, RecurringItem, Saving, Transaction, UserSettings } from '../domain/types'

const toDate = (m: MonthKey) => `${m}-01`
const toMonth = (d: string): MonthKey => d.slice(0, 7)
const money = (v: number | string | null) => (v === null ? null : toSatang(v))
const RECEIPT_ERRORS: Record<string, string> = {
  receipt_payment_unreadable: 'ยังอ่านยอดหลักฐานไม่ได้ กรุณาอ่านใหม่หรือเปลี่ยนรูปก่อนบันทึกจ่ายแล้ว',
  receipt_payment_mode_required: 'กรุณาเลือกวิธีตรวจยอดหลายสลิปก่อนบันทึกจ่ายแล้ว',
  receipt_payment_mismatch: 'ยอดหลักฐานไม่ตรงกับยอดบิล กรุณาเปลี่ยนยอดหรือเปลี่ยนรูปก่อนบันทึกจ่ายแล้ว',
  receipt_invalid_revision: 'หลักฐานเปลี่ยนไป กรุณาโหลดใหม่ก่อนแก้ไข',
  receipt_first_path_mismatch: 'ข้อมูลรูปหลักฐานไม่ตรงกัน กรุณาโหลดใหม่ก่อนแก้ไข',
  receipt_invalid_evidence: 'ข้อมูลหลักฐานไม่ถูกต้อง กรุณาโหลดใหม่ก่อนแก้ไข',
  receipt_invalid_path: 'ข้อมูลรูปหลักฐานไม่ถูกต้อง กรุณาเลือกรูปใหม่',
  receipt_invalid_amount: 'ยอดที่อ่านจากหลักฐานไม่ถูกต้อง กรุณาอ่านใหม่หรือเปลี่ยนรูป',
}

function fail(error: PostgrestError | Error | null, what: string): never {
  console.error(what, error)
  const msg = error?.message ?? ''
  if ('code' in (error ?? {}) && (error as PostgrestError).code === '23514' && RECEIPT_ERRORS[msg]) throw new Error(RECEIPT_ERRORS[msg])
  if ('code' in (error ?? {}) && ['PGRST204', '42703'].includes((error as PostgrestError).code)) throw new Error('ต้องอัปเดตฐานข้อมูลสำหรับหลักฐานหลายรูปก่อน กรุณาติดต่อผู้ดูแล')
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
  ...(r.receipt_path === undefined ? {} : { receiptPath: r.receipt_path }),
  ...(r.receipts === undefined ? {} : { receipts: r.receipts }),
  ...(r.receipt_revision === undefined ? {} : { receiptRevision: r.receipt_revision }),
  ...(r.receipt_mode === undefined ? {} : { receiptMode: r.receipt_mode }),
})
const mapMonth = (r: Row): MonthRecord => ({
  month: toMonth(r.month),
  actualBalance: money(r.actual_balance),
  spendBudget: money(r.spend_budget ?? null),
  closedAt: r.closed_at ?? null,
})
const mapSaving = (r: Row): Saving => ({
  id: r.id, date: r.date, amount: toSatang(r.amount), note: r.note, kind: r.kind, createdAt: r.created_at,
  ...(r.cycle_month === undefined ? {} : { cycleMonth: r.cycle_month ? toMonth(r.cycle_month) : null }),
})
function savingRow(x: Partial<NewSaving>): Row {
  const r: Row = {}
  if (x.date !== undefined) r.date = x.date
  if (x.amount !== undefined) r.amount = fromSatang(x.amount)
  if (x.note !== undefined) r.note = x.note
  if (x.kind !== undefined) r.kind = x.kind
  if (x.cycleMonth !== undefined) r.cycle_month = x.cycleMonth === null ? null : toDate(x.cycleMonth)
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
  ...(r.cycle_month === undefined ? {} : { cycleMonth: r.cycle_month ? toMonth(r.cycle_month) : null }),
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
  if (t.cycleMonth !== undefined) r.cycle_month = t.cycleMonth === null ? null : toDate(t.cycleMonth)
  return r
}

export class SupabaseRepo implements Repo {
  readonly kind = 'supabase' as const
  constructor(private sb: SupabaseClient) {}

  private async allRows(what: string, query: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: PostgrestError | null; count?: number | null }>): Promise<Row[]> {
    const rows: Row[] = []
    const pageSize = 1000
    while (true) {
      const { data, error, count } = await query(rows.length, rows.length + pageSize - 1)
      if (error) fail(error, what)
      if (!data?.length) {
        if (count !== null && count !== undefined && rows.length < count) throw new Error(`${what}ไม่ครบ กรุณาลองใหม่`)
        return rows
      }
      rows.push(...data)
      if (count !== null && count !== undefined ? rows.length >= count : data.length < pageSize) return rows
    }
  }

  private async cycleAt(date: string): Promise<MonthKey> {
    return cycleForDate(date, await this.listMonths('2000-01', date.slice(0, 7)))
  }

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

  async closeMonthAtomic(month: MonthKey, actual: number, save: number, nowIso: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isFinite(Date.parse(nowIso))) throw new Error('รอบเงินหรือเวลาปิดยอดไม่ถูกต้อง')
    if (!Number.isSafeInteger(actual) || Math.abs(actual) > MAX_SATANG || !Number.isSafeInteger(save) || save < 0 || save > Math.max(actual, 0)) throw new Error('ยอดปิดหรือยอดแยกเก็บไม่ถูกต้อง')
    const { error } = await this.sb.rpc('close_month_ledger', { p_month: toDate(month), p_actual: fromSatang(actual), p_save: fromSatang(save), p_closed_at: nowIso })
    if (error?.code === 'PGRST202' || error?.code === '42883') throw new Error('ต้องอัปเดตฐานข้อมูลสำหรับการปิดยอดแบบใหม่ก่อน กรุณาติดต่อผู้ดูแล')
    if (error) fail(error, 'ปิดยอด')
  }

  async listEntries(from: MonthKey, to: MonthKey) {
    const data = await this.allRows('โหลดรายการเดือน', (start, end) => this.sb.from('month_entries').select('*', { count: 'exact' }).gte('month', toDate(from)).lte('month', toDate(to)).order('month').order('id').range(start, end))
    return data.map(mapEntry)
  }

  async insertEntriesIfAbsent(entries: NewEntry[]) {
    if (!entries.length) return
    const user_id = await this.uid()
    const rows = entries.map((e) => {
      if (e.receipts != null) validateReceiptEvidence(e.receipts)
      return {
        user_id, item_id: e.itemId, month: toDate(e.month), amount: fromSatang(e.amount), paid: e.paid, note: e.note,
        ...(e.receiptPath === undefined ? {} : { receipt_path: e.receiptPath }),
        ...(e.receipts === undefined ? {} : { receipts: e.receipts, ...(e.receipts === null ? {} : { receipt_path: e.receipts[0]?.path ?? null }) }),
        ...(e.receiptRevision === undefined ? {} : { receipt_revision: e.receiptRevision }),
        ...(e.receiptMode === undefined ? {} : { receipt_mode: e.receiptMode }),
      }
    })
    // แบ่ง batch กัน payload ใหญ่เกิน
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.sb
        .from('month_entries')
        .upsert(rows.slice(i, i + 500), { onConflict: 'user_id,item_id,month', ignoreDuplicates: true })
      if (error) fail(error, 'สร้างรายการเดือน')
    }
  }

  async updateEntry(id: string, patch: Partial<Pick<MonthEntry, 'amount' | 'paid' | 'note' | 'receiptPath'>>) {
    const row: Row = {}
    if (patch.amount !== undefined) row.amount = fromSatang(patch.amount)
    if (patch.paid !== undefined) row.paid = patch.paid
    if (patch.note !== undefined) row.note = patch.note
    if (patch.receiptPath !== undefined) row.receipt_path = patch.receiptPath
    const { error, count } = await this.sb.from('month_entries').update(row, { count: 'exact' }).eq('id', id)
    if (error) fail(error, 'บันทึกรายการ')
    if (count === 0) throw new Error('ไม่พบรายการนี้แล้ว')
  }

  async deleteEntries(ids: string[]): Promise<string | null> {
    if (!ids.length) return null
    const entries = await this.allRows('โหลดหลักฐานรายการ', (start, end) => this.sb
      .from('month_entries').select('receipt_path,receipts', { count: 'exact' }).in('id', ids).order('id').range(start, end))
    const paths = [...new Set(entries.flatMap((e) => [...entryReceipts({ receiptPath: e.receipt_path, receipts: e.receipts }).map((r) => r.path), ...(e.receipt_path ? [e.receipt_path as string] : [])]))]
    const { error } = await this.sb.from('month_entries').delete().in('id', ids)
    if (error) fail(error, 'ลบรายการ')
    const results = await Promise.allSettled(paths.map((path) => this.deleteSlip(path)))
    return results.some((r) => r.status === 'rejected') ? 'ลบรายการแล้ว แต่ลบรูปหลักฐานบางรูปไม่สำเร็จ' : null
  }

  async saveEntryReceipts(entry: MonthEntry, receipts: ReceiptEvidence[], mode?: ReceiptCheckMode | null, payment?: Partial<Pick<MonthEntry, 'amount' | 'paid' | 'note'>>): Promise<MonthEntry> {
    validateReceiptEvidence(receipts)
    const revision = entry.receiptRevision ?? 0
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= 2_147_483_647) throw new Error('เวอร์ชันหลักฐานไม่ถูกต้อง กรุณาโหลดใหม่')
    const receiptMode = receipts.length === 0 ? null : mode === undefined ? entry.receiptMode ?? null : mode
    if (receiptMode !== null && receiptMode !== 'sum' && receiptMode !== 'each') throw new Error('วิธีตรวจยอดหลักฐานไม่ถูกต้อง')
    const row: Row = { receipts, receipt_path: receipts[0]?.path ?? null, receipt_revision: revision + 1, receipt_mode: receiptMode }
    if (payment?.amount !== undefined) {
      if (!Number.isSafeInteger(payment.amount) || payment.amount < 0 || payment.amount > MAX_SATANG) throw new Error('ยอดรายการไม่ถูกต้อง')
      row.amount = fromSatang(payment.amount)
    }
    if (payment?.paid !== undefined) row.paid = payment.paid
    if (payment?.note !== undefined) row.note = payment.note
    let query = this.sb.from('month_entries')
      .update(row)
      .eq('id', entry.id).eq('receipt_revision', revision)
      .eq('amount', fromSatang(entry.amount)).eq('paid', entry.paid)
    query = entry.note === null ? query.is('note', null) : query.eq('note', entry.note)
    const { data, error } = await query.select('*').maybeSingle()
    if (error) fail(error, 'บันทึกหลักฐาน')
    if (!data) throw new Error('หลักฐานหรือรายการเปลี่ยนไปหรือถูกลบแล้ว กรุณาโหลดใหม่ก่อนแก้ไข')
    return mapEntry(data)
  }

  async listTransactions(from: string, to: string) {
    const data = await this.allRows('โหลดรายจ่าย', (start, end) => this.sb
      .from('transactions')
      .select('*', { count: 'exact' })
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false }).order('id').range(start, end))
    return data.map(mapTx)
  }

  async findTransactionBySlipHash(hash: string) {
    const { data, error } = await this.sb.from('transactions').select('*').eq('slip_hash', hash).maybeSingle()
    if (error) fail(error, 'ตรวจสลิปซ้ำ')
    return data ? mapTx(data) : null
  }

  async addTransaction(t: NewTransaction) {
    const cycleMonth = t.cycleMonth ?? await this.cycleAt(t.date)
    const { data, error } = await this.sb.from('transactions').insert(txRow({ ...t, cycleMonth })).select().single()
    if (error?.code === '23505') throw new Error('สลิปนี้บันทึกไปแล้ว')
    if (error) fail(error, 'บันทึกรายจ่าย')
    return mapTx(data)
  }

  async updateTransaction(id: string, patch: Partial<NewTransaction>) {
    let resolved = patch
    if (patch.date !== undefined && patch.cycleMonth === undefined) {
      const { data, error } = await this.sb.from('transactions').select('date').eq('id', id).maybeSingle()
      if (error) fail(error, 'โหลดรายการ')
      if (!data) throw new Error('ไม่พบรายการนี้แล้ว')
      if (patch.date !== data.date) resolved = { ...patch, cycleMonth: await this.cycleAt(patch.date) }
    }
    const { error, count } = await this.sb.from('transactions').update(txRow(resolved), { count: 'exact' }).eq('id', id)
    if (error) fail(error, 'แก้ไขรายจ่าย')
    if (count === 0) throw new Error('ไม่พบรายการนี้แล้ว')
  }

  async deleteTransaction(id: string) {
    const { error } = await this.sb.from('transactions').delete().eq('id', id)
    if (error) fail(error, 'ลบรายจ่าย')
  }

  async listSavings(from: string, to: string) {
    const data = await this.allRows('โหลดเงินเก็บ', (start, end) => this.sb
      .from('savings')
      .select('*', { count: 'exact' })
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false }).order('id').range(start, end))
    return data.map(mapSaving)
  }

  async addSaving(x: NewSaving) {
    const resolved = x.kind === 'deposit' ? { ...x, cycleMonth: x.cycleMonth ?? await this.cycleAt(x.date) } : x
    const { data, error } = await this.sb.from('savings').insert(savingRow(resolved)).select().single()
    if (error) fail(error, 'บันทึกเงินเก็บ')
    return mapSaving(data)
  }

  async updateSaving(id: string, patch: Partial<NewSaving>) {
    let resolved = patch
    if (patch.date !== undefined && patch.cycleMonth === undefined) {
      const { data, error } = await this.sb.from('savings').select('date,kind').eq('id', id).maybeSingle()
      if (error) fail(error, 'โหลดเงินเก็บ')
      if (!data) throw new Error('ไม่พบรายการนี้แล้ว')
      if (patch.date !== data.date && (patch.kind ?? data.kind) === 'deposit') resolved = { ...patch, cycleMonth: await this.cycleAt(patch.date) }
    }
    const { error, count } = await this.sb.from('savings').update(savingRow(resolved), { count: 'exact' }).eq('id', id)
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
