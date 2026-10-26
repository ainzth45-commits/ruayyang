import type { Satang } from './types'

export const MAX_SATANG: Satang = 999_999_999 // 9,999,999.99 — เพดาน numeric(12,2) ที่สมเหตุสมผล

const INVISIBLE = /[​-‍⁠﻿­]/g

/** แปลงเลขไทย/เลขเต็มความกว้างเป็นเลขอารบิก */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[，]/g, ',')
    .replace(/[．]/g, '.')
}

export function sanitizeText(s: string, maxLength = 200): string {
  return s.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export type ParseResult = { ok: true; value: Satang } | { ok: false; error: string }

/** รับข้อความที่ผู้ใช้พิมพ์ เช่น "1,250.50", "฿3,000", "3000 บาท" */
export function parseMoneyInput(raw: string, opts: { allowZero?: boolean } = {}): ParseResult {
  const s = normalizeDigits(raw.replace(INVISIBLE, ''))
    .replace(/฿|บาท|thb/gi, '')
    .replace(/\s+/g, '')
  if (!s) return { ok: false, error: 'กรุณากรอกจำนวนเงิน' }
  // คอมมาต้องเป็นหลักพันจริง ทศนิยมไม่เกิน 2 ตำแหน่ง
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'รูปแบบจำนวนเงินไม่ถูกต้อง' }
  const [whole, frac = ''] = s.replace(/,/g, '').split('.')
  const value = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(value)) return { ok: false, error: 'จำนวนเงินไม่ถูกต้อง' }
  if (value === 0 && !opts.allowZero) return { ok: false, error: 'จำนวนเงินต้องมากกว่า 0' }
  if (value > MAX_SATANG) return { ok: false, error: 'จำนวนเงินสูงเกินไป' }
  return { ok: true, value }
}

/** จาก numeric ของ DB (number หรือ string) → สตางค์ */
export function toSatang(v: number | string): Satang {
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n)) throw new Error(`จำนวนเงินไม่ถูกต้อง: ${v}`)
  return Math.round(n * 100)
}

/** สตางค์ → string ทศนิยม 2 ตำแหน่งสำหรับส่งเข้า DB */
export function fromSatang(v: Satang): string {
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
}

export function formatBaht(v: Satang, opts: { decimals?: boolean } = {}): string {
  const decimals = opts.decimals ?? true
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  const whole = Math.floor(a / 100).toLocaleString('en-US')
  if (!decimals) return `${sign}${Math.round(a / 100).toLocaleString('en-US')}`
  return `${sign}${whole}.${String(a % 100).padStart(2, '0')}`
}
