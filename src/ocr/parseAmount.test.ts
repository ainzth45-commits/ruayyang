import { describe, expect, it } from 'vitest'
import { parseSlipAmount } from './parseAmount'

describe('parseSlipAmount — สลิปแต่ละธนาคาร', () => {
  it('KBank: จำนวน: บรรทัดเดียวกัน', () => {
    const text = `โอนเงินสำเร็จ
22 ต.ค. 69 10:45 น.
นาย สมชาย ทดสอบ
ธ.กสิกรไทย
xxx-x-x1234-x
ร้านข้าวมันไก่
พร้อมเพย์
xxx-xxx-5678
เลขที่รายการ:
016295104512ATF09876
จำนวน:
120.00 บาท
ค่าธรรมเนียม:
0.00 บาท`
    expect(parseSlipAmount(text)).toBe(12000)
  })

  it('SCB: จำนวนเงิน อยู่บรรทัดถัดไป, มีหลักพัน', () => {
    const text = `ทำรายการสำเร็จ
22 ต.ค. 2569 - 08:15
รหัสอ้างอิง: 202610220815123456
จาก นาย สมชาย ทดสอบ
xxx-xxx456-7
ไปยัง บจก. ไฟฟ้า
xxx-xxx123-4
จำนวนเงิน
1,250.50`
    expect(parseSlipAmount(text)).toBe(125050)
  })

  it('Krungthai: จำนวนเงิน (บาท)', () => {
    const text = `กรุงไทย
โอนเงินสำเร็จ
รหัสอ้างอิง 2026102210451234
จำนวนเงิน (บาท) 3,000.00
ค่าธรรมเนียม (บาท) 0.00
วันที่ทำรายการ 22 ต.ค. 2569 10:45`
    expect(parseSlipAmount(text)).toBe(300000)
  })

  it('Bangkok Bank: Amount ภาษาอังกฤษ', () => {
    const text = `Transfer successful
22 Oct 26, 10:45
From ICE T.
XXX-X-X1234-X
To SOMCHAI S.
Amount 59.00 THB
Fee 0.00 THB
Ref. No. 0123456789`
    expect(parseSlipAmount(text)).toBe(5900)
  })

  it('PromptPay/TrueMoney: มีแค่ ฿ ไม่มีคำว่าจำนวน', () => {
    const text = `ชำระเงินสำเร็จ
ร้านกาแฟดีดี
฿ 65.00
22/10/2026 09:12
เลขที่ธุรกรรม 5012345678901`
    expect(parseSlipAmount(text)).toBe(6500)
  })

  it('Krungsri: ยอดโอน + ยอดคงเหลือ ต้องไม่หยิบคงเหลือ', () => {
    const text = `กรุงศรี โอนเงินสำเร็จ
ยอดโอน 450.00 บาท
ยอดเงินคงเหลือ 12,345.67 บาท
ค่าธรรมเนียม 0.00 บาท`
    expect(parseSlipAmount(text)).toBe(45000)
  })

  it('ttb: Amount บรรทัดถัดไป + ค่าธรรมเนียมไม่ใช่ 0', () => {
    const text = `ttb
Transfer
Amount
2,500.00
Fee
10.00`
    expect(parseSlipAmount(text)).toBe(250000)
  })
})

describe('parseSlipAmount — OCR noise', () => {
  it('ช่องว่างในตัวเลข "1, 250.00"', () => {
    expect(parseSlipAmount('จำนวน: 1, 250.00 บาท')).toBe(125000)
  })
  it('ช่องว่างแทนหลักพัน "1 250.00"', () => {
    expect(parseSlipAmount('จำนวนเงิน 1 250.00')).toBe(125000)
  })
  it('O แทน 0 และ l แทน 1', () => {
    expect(parseSlipAmount('จำนวน: l2O.OO บาท')).toBe(12000)
  })
  it('คอมมาแทนจุดทศนิยม "1,250,00"', () => {
    expect(parseSlipAmount('จำนวน: 1,250,00 บาท')).toBe(125000)
  })
  it('เลขไทย', () => {
    expect(parseSlipAmount('จำนวน: ๑,๒๕๐.๐๐ บาท')).toBe(125000)
  })
  it('ช่องว่างก่อนจุด "120 .00"', () => {
    expect(parseSlipAmount('จำนวน 120 .00 บาท')).toBe(12000)
  })
})

describe('parseSlipAmount — ไม่มั่นใจ → null', () => {
  it('ไม่มีตัวเลขทศนิยม', () => {
    expect(parseSlipAmount('โอนเงินสำเร็จ\nxxx-x-x1234-x\nรหัสอ้างอิง 2026102210451234')).toBeNull()
  })
  it('ข้อความว่าง', () => {
    expect(parseSlipAmount('')).toBeNull()
  })
  it('มีแต่ค่าธรรมเนียม', () => {
    expect(parseSlipAmount('ค่าธรรมเนียม 0.00 บาท\nFee 10.00')).toBeNull()
  })
  it('ยอด 0.00', () => {
    expect(parseSlipAmount('จำนวน: 0.00 บาท')).toBeNull()
  })
  it('ตัวเลขลอยๆ หลายค่าไม่มีบริบท', () => {
    expect(parseSlipAmount('12.50\n99.00')).toBeNull()
  })
  it('ไม่หยิบเวลา "10.45 น." และวันที่ "22.10.69"', () => {
    expect(parseSlipAmount('วันที่ 22.10.69 เวลา 10.45 น.')).toBeNull()
  })
  it('"3,00" อาจเป็นตัวเลขที่ถูกตัด ไม่เดา', () => {
    expect(parseSlipAmount('จำนวนเงิน (บาท) 3,00')).toBeNull()
  })
  it('เกินเพดาน', () => {
    expect(parseSlipAmount('จำนวน: 99,999,999.00 บาท')).toBeNull()
  })
})
