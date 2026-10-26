// เงินทุกตัวใน domain เป็น "สตางค์" (integer) กันทศนิยมเพี้ยน — แปลงที่ขอบ repo เท่านั้น
export type Satang = number
/** 'YYYY-MM' */
export type MonthKey = string
/** 'YYYY-MM-DD' ตามเวลาไทย */
export type DateKey = string

export type ItemKind = 'income' | 'expense'

export interface Category {
  id: string
  name: string
  icon: string
  sort: number
  archived: boolean
}

export interface RecurringItem {
  id: string
  name: string
  kind: ItemKind
  defaultAmount: Satang
  isEstimate: boolean
  startMonth: MonthKey
  endMonth: MonthKey | null
  sort: number
  archived: boolean
}

export interface MonthEntry {
  id: string
  itemId: string
  month: MonthKey
  amount: Satang
  paid: boolean
  note: string | null
}

export interface MonthRecord {
  month: MonthKey
  /** คงเหลือจริงตอนสิ้นเดือน (ก่อนแยกเก็บตอนปิดเดือน) */
  actualBalance: Satang | null
  /** งบใช้จ่ายรายวันที่ตั้งเองของเดือนนี้ (null = ใช้ของเดือนก่อนหน้า) */
  spendBudget: Satang | null
  closedAt: string | null
}

export interface Transaction {
  id: string
  date: DateKey
  amount: Satang
  categoryId: string | null
  note: string | null
  slipPath: string | null
  slipHash: string | null
  ocrAmount: Satang | null
  createdAt: string
}

/** deposit = เก็บระหว่างเดือน · close = แยกเก็บตอนปิดเดือน (เดือนละ 1 รายการ ลงวันสุดท้ายของเดือน) */
export type SavingKind = 'deposit' | 'close'

export interface Saving {
  id: string
  date: DateKey
  amount: Satang
  note: string | null
  kind: SavingKind
  createdAt: string
}

export interface UserSettings {
  /** เงินเก็บที่มีอยู่ก่อนเริ่มใช้แอป */
  savingsOpening: Satang
}

export type NewEntry = Omit<MonthEntry, 'id'>
export type NewTransaction = Omit<Transaction, 'id' | 'createdAt'>
export type NewSaving = Omit<Saving, 'id' | 'createdAt'>
