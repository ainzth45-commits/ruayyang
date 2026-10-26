import type {
  Category,
  DateKey,
  MonthEntry,
  MonthKey,
  MonthRecord,
  NewEntry,
  NewSaving,
  NewTransaction,
  RecurringItem,
  Satang,
  Saving,
  Transaction,
  UserSettings,
} from '../domain/types'

/**
 * ชั้นข้อมูล — มี 2 แบบ: SupabaseRepo (ใช้จริง) / LocalRepo (preview ในเครื่อง)
 * ทุกเมธอด throw Error ที่มี message ภาษาไทยเมื่อพัง ให้ UI แสดง toast ได้เลย
 */
export interface Repo {
  readonly kind: 'supabase' | 'local'

  listCategories(): Promise<Category[]>
  saveCategory(c: Omit<Category, 'id'> & { id?: string }): Promise<Category>

  listItems(): Promise<RecurringItem[]>
  saveItem(item: Omit<RecurringItem, 'id'> & { id?: string }): Promise<RecurringItem>

  listMonths(from: MonthKey, to: MonthKey): Promise<MonthRecord[]>
  /** ไม่ทับแถวเดิม */
  insertMonthsIfAbsent(months: MonthKey[]): Promise<void>
  setActualBalance(month: MonthKey, value: number | null): Promise<void>
  /** งบใช้จ่ายของเดือน (null = ใช้ของเดือนก่อนหน้า) */
  setMonthBudget(month: MonthKey, value: Satang | null): Promise<void>
  setMonthClosed(month: MonthKey, closedAt: string | null): Promise<void>

  listEntries(from: MonthKey, to: MonthKey): Promise<MonthEntry[]>
  /** ข้ามแถวที่ (itemId, month) ซ้ำ */
  insertEntriesIfAbsent(entries: NewEntry[]): Promise<void>
  updateEntry(id: string, patch: Partial<Pick<MonthEntry, 'amount' | 'paid' | 'note'>>): Promise<void>
  deleteEntries(ids: string[]): Promise<void>

  listTransactions(from: DateKey, to: DateKey): Promise<Transaction[]>
  findTransactionBySlipHash(hash: string): Promise<Transaction | null>
  addTransaction(t: NewTransaction): Promise<Transaction>
  updateTransaction(id: string, patch: Partial<NewTransaction>): Promise<void>
  deleteTransaction(id: string): Promise<void>

  /** เรียงใหม่ → เก่า */
  listSavings(from: DateKey, to: DateKey): Promise<Saving[]>
  addSaving(s: NewSaving): Promise<Saving>
  updateSaving(id: string, patch: Partial<NewSaving>): Promise<void>
  deleteSaving(id: string): Promise<void>

  getSettings(): Promise<UserSettings>
  saveSettings(s: UserSettings): Promise<void>

  uploadSlip(file: Blob, month: MonthKey): Promise<string>
  slipUrl(path: string): Promise<string>
  deleteSlip(path: string): Promise<void>
}

export interface AuthUser {
  id: string
  email: string
}

export interface Auth {
  currentUser(): Promise<AuthUser | null>
  signIn(email: string, password: string): Promise<AuthUser>
  signOut(): Promise<void>
  onChange(cb: (user: AuthUser | null) => void): () => void
}
