import { describe, expect, it } from 'vitest'
import { buildDailySheet, buildPlanSheet, buildSavingsSheet, type ExportData } from './exportXlsx'

const data: ExportData = {
  items: [
    { id: 'sal', name: 'เงินเดือน', kind: 'income', defaultAmount: 2_000_000, isEstimate: false, startMonth: '2026-09', endMonth: null, sort: 0, archived: false },
    { id: 'pw', name: 'ค่าไฟ', kind: 'expense', defaultAmount: 300_000, isEstimate: true, startMonth: '2026-09', endMonth: null, sort: 1, archived: false },
    { id: 'old', name: 'เลิกแล้ว', kind: 'expense', defaultAmount: 1, isEstimate: false, startMonth: '2020-01', endMonth: '2020-01', sort: 2, archived: true },
  ],
  entries: [
    { id: '1', itemId: 'sal', month: '2026-09', amount: 2_000_000, paid: true, note: null },
    { id: '2', itemId: 'sal', month: '2026-10', amount: 2_000_000, paid: false, note: null },
    { id: '3', itemId: 'pw', month: '2026-10', amount: 246_802, paid: true, note: null },
  ],
  records: [
    { month: '2026-09', actualBalance: 432_109, spendBudget: null, closedAt: '2026-09-30T12:00:00Z' },
    { month: '2026-10', actualBalance: null, spendBudget: 600_000, closedAt: null },
  ],
  savings: [
    { id: 's2', date: '2026-10-03', amount: 50_000, note: 'ออมทรัพย์', kind: 'deposit', createdAt: '2' },
    { id: 's1', date: '2026-09-30', amount: 300_000, note: null, kind: 'close', createdAt: '1' },
    { id: 's0', date: '2026-09-10', amount: 10_000, note: null, kind: 'deposit', createdAt: '0' },
  ],
  settings: { savingsOpening: 2_500_000 },
  txs: [
    { id: 't2', date: '2026-10-05', amount: 12_000, categoryId: 'food', note: 'ข้าว', slipPath: 'x', slipHash: null, ocrAmount: null, createdAt: '2' },
    { id: 't1', date: '2026-10-01', amount: 5_050, categoryId: 'gone', note: null, slipPath: null, slipHash: null, ocrAmount: null, createdAt: '1' },
  ],
  categories: [{ id: 'food', name: 'อาหาร', icon: 'utensils', sort: 0, archived: false }],
}

describe('buildPlanSheet', () => {
  it('lays out items × months like the original sheet, with totals', () => {
    const rows = buildPlanSheet(data)
    const byLabel = Object.fromEntries(rows.filter((r) => r.length > 1).map((r) => [r[0], r.slice(1)]))
    expect(rows[0]).toEqual(['รายการ', 'ก.ย. 2026', 'ต.ค. 2026'])
    expect(byLabel['เงินเดือน']).toEqual([20000, 20000])
    expect(byLabel['ค่าไฟ (ประมาณ)']).toEqual([null, 2468.02])
    expect(byLabel['เลิกแล้ว']).toBeUndefined() // ไม่มียอดในช่วงที่ export
    expect(byLabel['จ่ายรายวัน']).toEqual([0, 170.5])
    expect(byLabel['คงเหลือ']).toEqual([20000, 17361.48])
    expect(byLabel['คงเหลือจริง']).toEqual([4321.09, null])
    expect(byLabel['งบใช้จ่าย']).toEqual([null, 6000]) // ก.ย. ไม่มีงบ, ต.ค. ตั้ง 6,000
    expect(byLabel['เก็บระหว่างเดือน']).toEqual([100, 500])
    expect(byLabel['แยกเก็บตอนปิดเดือน']).toEqual([3000, 0])
    expect(byLabel['รายได้เพิ่ม']).toEqual([4321.09 + 100 - 20000, null])
    expect(byLabel['ส่วนต่าง']).toBeUndefined()
  })
})

describe('buildDailySheet', () => {
  it('sorted by date, unknown category blank', () => {
    expect(buildDailySheet(data)).toEqual([
      ['วันที่', 'หมวด', 'ยอด (บาท)', 'โน้ต', 'มีสลิป'],
      ['2026-10-01', '', 50.5, '', ''],
      ['2026-10-05', 'อาหาร', 120, 'ข้าว', 'มี'],
    ])
  })
})

describe('buildSavingsSheet', () => {
  it('opening first, oldest → newest, total last', () => {
    expect(buildSavingsSheet(data)).toEqual([
      ['วันที่', 'ประเภท', 'ยอด (บาท)', 'โน้ต'],
      ['', 'ยอดตั้งต้น', 25000, ''],
      ['2026-09-10', 'เก็บระหว่างเดือน', 100, ''],
      ['2026-09-30', 'แยกเก็บตอนปิดเดือน', 3000, ''],
      ['2026-10-03', 'เก็บระหว่างเดือน', 500, 'ออมทรัพย์'],
      ['', 'รวมเงินเก็บสะสม', 28600, ''],
    ])
  })
})
