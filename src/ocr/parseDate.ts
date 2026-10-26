import { normalizeDigits } from '../domain/money'
import type { DateKey } from '../domain/types'

// อ่านวันที่โอนจากข้อความ OCR ของสลิป (ไว้ใส่รายการย้อนหลังโดยไม่ต้องแก้วันที่เอง)
// รองรับ: 22 ต.ค. 69 / 22 ต.ค. 2569 / 22 ตุลาคม 2026 / 22/10/2569 / 22-10-26 / 2026-10-22 / 22 Oct 2026 / Oct 22, 2026
// คืน null ถ้าไม่มั่นใจ (ไม่มีวันที่, เป็นวันในอนาคต, หรือเก่าเกิน 2 ปี) — UI ใช้วันนี้แทน

const TH_MONTHS: [RegExp, number][] = [
  [/^(ม\.?ค\.?|มกราคม|มกรา)$/, 1], [/^(ก\.?พ\.?|กุมภาพันธ์|กุมภา)$/, 2], [/^(มี\.?ค\.?|มีนาคม|มีนา)$/, 3],
  [/^(เม\.?ย\.?|เมษายน|เมษา)$/, 4], [/^(พ\.?ค\.?|พฤษภาคม|พฤษภา)$/, 5], [/^(มิ\.?ย\.?|มิถุนายน|มิถุนา)$/, 6],
  [/^(ก\.?ค\.?|กรกฎาคม|กรกฎา)$/, 7], [/^(ส\.?ค\.?|สิงหาคม|สิงหา)$/, 8], [/^(ก\.?ย\.?|กันยายน|กันยา)$/, 9],
  [/^(ต\.?ค\.?|ตุลาคม|ตุลา)$/, 10], [/^(พ\.?ย\.?|พฤศจิกายน|พฤศจิกา)$/, 11], [/^(ธ\.?ค\.?|ธันวาคม|ธันวา)$/, 12],
]
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function thaiMonth(tok: string): number | null {
  const t = tok.replace(/\s+/g, '')
  for (const [re, m] of TH_MONTHS) if (re.test(t)) return m
  return null
}

function enMonth(tok: string): number | null {
  const i = EN_MONTHS.indexOf(tok.slice(0, 3).toLowerCase())
  return i >= 0 ? i + 1 : null
}

const pad = (n: number) => String(n).padStart(2, '0')

function toKey(y: number, m: number, d: number): DateKey | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null // 31 ก.พ. ฯลฯ
  return `${y}-${pad(m)}-${pad(d)}`
}

/** ปีจากสลิป: พ.ศ. 4 หลัก / ค.ศ. 4 หลัก / 2 หลัก (ลองทั้ง พ.ศ. และ ค.ศ. แล้วเลือกที่ใกล้วันนี้) */
function yearCandidates(raw: string): number[] {
  const y = Number(raw)
  if (raw.length === 4) return [y > 2400 ? y - 543 : y]
  if (raw.length === 2) return [2500 + y - 543, 2000 + y]
  return []
}

function daysBetween(a: DateKey, b: DateKey): number {
  return (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

export function parseSlipDate(text: string, today: DateKey): DateKey | null {
  const s = normalizeDigits(text).replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0')
  const found: DateKey[] = []
  const push = (y: string, m: number | null, d: string) => {
    if (m === null) return
    // ปี 2 หลักกำกวม → เลือกตัวเลือกที่ไม่เป็นอนาคตและใกล้วันนี้ที่สุด
    const opts = yearCandidates(y)
      .map((yy) => toKey(yy, m, Number(d)))
      .filter((k): k is DateKey => k !== null && daysBetween(k, today) <= 1)
      .sort((a, b) => daysBetween(today, a) - daysBetween(today, b))
    if (opts[0]) found.push(opts[0])
  }
  // 22 ต.ค. 69 / 22 ตุลาคม 2569 (OCR อาจแทรกช่องว่างในตัวย่อ "ต. ค.")
  for (const m of s.matchAll(/(?<!\d)(\d{1,2})\s*([ก-๙](?:[ก-๙.\s]{0,12}[ก-๙.])?)\s*(\d{4}|\d{2})(?!\d)/g)) push(m[3], thaiMonth(m[2]), m[1])
  // 22/10/2569 · 22-10-26 · 22.10.2026
  for (const m of s.matchAll(/(?<![\d.:/-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d:]|[.,]\d)/g)) push(m[3], Number(m[2]), m[1])
  // 2026-10-22
  for (const m of s.matchAll(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g)) push(m[1], Number(m[2]), m[3])
  // 22 Oct 2026 · Oct 22, 2026
  for (const m of s.matchAll(/(?<!\d)(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4}|\d{2})(?!\d)/g)) push(m[3], enMonth(m[2]), m[1])
  for (const m of s.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?!\d)/g)) push(m[3], enMonth(m[1]), m[2])

  const valid = found.filter((k) => daysBetween(today, k) <= 730)
  if (valid.length === 0) return null
  // สลิปมักมีวันที่เดียว ถ้าเจอหลายวันที่ต่างกัน → ไม่เดา
  return new Set(valid).size === 1 ? valid[0] : null
}
