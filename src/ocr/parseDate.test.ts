import { describe, expect, it } from 'vitest'
import { parseSlipDate } from './parseDate'

const T = '2026-10-27'

describe('parseSlipDate', () => {
  it.each([
    ['KBank: 22 ต.ค. 69 10:45 น.', 'โอนเงินสำเร็จ\n22 ต.ค. 69 10:45 น.\nนาย สมชาย', '2026-10-22'],
    ['SCB: 22 ต.ค. 2569 - 08:15', 'ทำรายการสำเร็จ\n22 ต.ค. 2569 - 08:15', '2026-10-22'],
    ['เดือนเต็ม พ.ศ.', 'วันที่ 5 กันยายน 2569 เวลา 09:00', '2026-09-05'],
    ['เดือนเต็ม ค.ศ.', '5 กันยายน 2026', '2026-09-05'],
    ['ตัวเลขไทย', '๒๒ ต.ค. ๖๙', '2026-10-22'],
    ['OCR แทรกช่องว่าง', '22 ต. ค. 69', '2026-10-22'],
    ['OCR ตกจุด', '22 ตค 69', '2026-10-22'],
    ['dd/mm/yyyy พ.ศ.', 'วันที่ 22/10/2569 10:45', '2026-10-22'],
    ['dd/mm/yyyy ค.ศ.', '22/10/2026  08:15 น.', '2026-10-22'],
    ['dd-mm-yy ค.ศ.', 'Date 22-10-26', '2026-10-22'],
    ['ISO', '2026-10-22T10:45', '2026-10-22'],
    ['อังกฤษ', 'Transfer successful 22 Oct 2026 10:45', '2026-10-22'],
    ['อังกฤษแบบ US', 'Oct 22, 2026', '2026-10-22'],
    ['ข้ามปี', '30 ธ.ค. 68', '2025-12-30'],
    ['วันนี้', '27 ต.ค. 69', '2026-10-27'],
  ])('%s', (_name, text, want) => expect(parseSlipDate(text, T)).toBe(want))

  it('ignores times, amounts and reference numbers', () => {
    expect(parseSlipDate('จำนวน 1,250.50 บาท\nเลขที่ 016295104512\n10:45 น.', T)).toBeNull()
  })
  it('rejects future dates (no slip from tomorrow+)', () => expect(parseSlipDate('5 พ.ย. 69', T)).toBeNull())
  it('rejects dates older than 2 years', () => expect(parseSlipDate('1 ม.ค. 2566', T)).toBeNull())
  it('rejects impossible dates', () => expect(parseSlipDate('31 ก.พ. 69', T)).toBeNull())
  it('two different dates → do not guess', () => expect(parseSlipDate('22 ต.ค. 69\nครบกำหนด 1 ต.ค. 69', T)).toBeNull())
  it('same date twice → fine', () => expect(parseSlipDate('22 ต.ค. 69\n22/10/2569', T)).toBe('2026-10-22'))
  it('empty / garbage', () => {
    expect(parseSlipDate('', T)).toBeNull()
    expect(parseSlipDate('สวัสดี ไม่มีวันที่', T)).toBeNull()
  })
})
