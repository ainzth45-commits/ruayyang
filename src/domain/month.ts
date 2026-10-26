import type { DateKey, MonthKey, RecurringItem } from './types'

const SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
export const WEEKDAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

function parse(m: MonthKey): [number, number] {
  const match = /^(\d{4})-(\d{2})$/.exec(m)
  if (!match) throw new Error(`MonthKey ไม่ถูกต้อง: ${m}`)
  return [Number(match[1]), Number(match[2])]
}

function key(y: number, m: number): MonthKey {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}

export function addMonths(m: MonthKey, n: number): MonthKey {
  const [y, mo] = parse(m)
  const idx = y * 12 + (mo - 1) + n
  return key(Math.floor(idx / 12), (idx % 12) + 1)
}

export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m)
  return out
}

export function daysInMonth(m: MonthKey): number {
  const [y, mo] = parse(m)
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

/** วันที่วันนี้ตามเวลาไทย (UTC+7 ไม่มี DST) ไม่ขึ้นกับ timezone ของเครื่อง */
export function bangkokToday(now: Date = new Date()): DateKey {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
}

export function monthOf(d: DateKey): MonthKey {
  return d.slice(0, 7)
}

export function monthLabel(m: MonthKey, opts: { long?: boolean } = {}): string {
  const [y, mo] = parse(m)
  return `${(opts.long ? LONG : SHORT)[mo - 1]} ${y}`
}

export function dateLabel(d: DateKey): string {
  const [y, m, day] = d.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay()
  return `${WEEKDAYS_SHORT[wd]} ${day} ${SHORT[m - 1]}`
}

/** บวก/ลบวัน (คิดแบบ UTC ล้วน ไม่ขึ้นกับ timezone เครื่อง) */
export function addDays(d: DateKey, n: number): DateKey {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10)
}

export function monthStartDate(m: MonthKey): DateKey {
  return `${m}-01`
}

export function monthEndDate(m: MonthKey): DateKey {
  return `${m}-${String(daysInMonth(m)).padStart(2, '0')}`
}

export function isActiveIn(item: Pick<RecurringItem, 'startMonth' | 'endMonth' | 'archived'>, m: MonthKey): boolean {
  if (item.archived) return false
  if (m < item.startMonth) return false
  return item.endMonth === null || m <= item.endMonth
}
