import { MAX_SATANG, normalizeDigits } from '../domain/money'
import type { Satang } from '../domain/types'

// คำที่บอกว่าบรรทัดนี้ (หรือบรรทัดถัดไป) คือยอดโอน
const KEYWORD = /จำนวนเงิน|จำนวน|ยอดเงิน|ยอดโอน|ยอดชำระ|ยอดรวม|amount|total/i
// บรรทัดที่ไม่ใช่ยอดโอน — ข้ามทั้งบรรทัด
const EXCLUDE = /ค่าธรรมเนียม|ธรรมเนียม|fee|คงเหลือ|balance|ส่วนลด|discount/i
const CURRENCY = /บาท|thb|฿/i
// ตัวเลขที่มีทศนิยม 2 ตำแหน่ง (ตัวคั่นอาจเป็น , หรือ . จาก OCR)
// คอมมาเป็นทศนิยมได้เฉพาะเมื่อมีหลักพันนำหน้า ("1,250,00") — "3,00" อาจเป็น "3,000" ที่ถูกตัด จึงไม่รับ
const AMOUNT = /(?<![\d.,:/-])(?:(\d{1,3}(?:[.,]\d{3})+)[.,]|(\d+)\.)(\d{2})(?![\d]|[.,:/]\d)/g

/** แก้ noise ที่ OCR ชอบทำกับตัวเลข */
function cleanLine(raw: string): string {
  let s = normalizeDigits(raw)
  // O/o → 0, l/I/| → 1 เมื่ออยู่ติดตัวเลขหรือตัวคั่น
  // วนซ้ำเพราะแก้ตัวหนึ่งแล้วตัวข้างๆ จะติดตัวเลขตามมา เช่น "l2O.OO"
  for (let i = 0; i < 4; i++) {
    const next = s
      .replace(/(?<=\d[.,]?)[Oo]|[Oo](?=[.,]?\d)/g, '0')
      .replace(/(?<=\d[.,]?)[lI|]|[lI|](?=[.,]?\d)/g, '1')
    if (next === s) break
    s = next
  }
  // ช่องว่างรอบตัวคั่นระหว่างตัวเลข: "1, 250.00" / "120 .00" → ติดกัน
  s = s.replace(/(\d)\s*([.,])\s*(\d)/g, '$1$2$3')
  // ช่องว่างแทนหลักพัน: "1 250.00" → "1250.00"
  s = s.replace(/(?<![\d.,])(\d{1,3}) (\d{3}[.,]\d{2})(?!\d)/g, '$1$2')
  return s
}

function toSatang(whole: string, frac: string): Satang | null {
  const w = Number(whole.replace(/[.,]/g, ''))
  const v = w * 100 + Number(frac)
  return Number.isSafeInteger(v) && v > 0 && v <= MAX_SATANG ? v : null
}

interface Candidate {
  value: Satang
  score: number
}

/**
 * หายอดโอนจากข้อความ OCR ของสลิปธนาคาร (คืนหน่วยสตางค์)
 * คืน null ถ้าไม่มั่นใจ — UI จะให้กรอกเอง
 */
export function parseSlipAmount(text: string): Satang | null {
  const lines = text.split(/\r?\n/).map(cleanLine)
  const cands: Candidate[] = []
  lines.forEach((line, i) => {
    if (EXCLUDE.test(line)) return
    const prev = lines.slice(Math.max(0, i - 2), i).filter((l) => l.trim())
    for (const m of line.matchAll(AMOUNT)) {
      const after = line.slice((m.index ?? 0) + m[0].length)
      if (/^\s*(น\.|นาฬิกา|น\b)/.test(after)) continue // เวลา เช่น 10.45 น.
      const value = toSatang(m[1] ?? m[2], m[3])
      if (value === null) continue
      let score = 1
      if (KEYWORD.test(line)) score += 10
      else if (prev.length && KEYWORD.test(prev[prev.length - 1]) && !EXCLUDE.test(prev[prev.length - 1])) score += 6
      if (CURRENCY.test(line)) score += 3
      cands.push({ value, score })
    }
  })
  if (cands.length === 0) return null
  const best = Math.max(...cands.map((c) => c.score))
  const top = new Set(cands.filter((c) => c.score === best).map((c) => c.value))
  if (top.size === 1) return [...top][0]
  return null
}
