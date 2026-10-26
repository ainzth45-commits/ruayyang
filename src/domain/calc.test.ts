import { describe, expect, it } from 'vitest'
import { categoryBreakdown, dailyAllowance, dailyTotals, entryStatus, summarizeMonth } from './calc'
import type { MonthEntry, RecurringItem, Transaction } from './types'

const item = (id: string, kind: 'income' | 'expense', isEstimate = false): RecurringItem => ({
  id, name: id, kind, defaultAmount: 0, isEstimate, startMonth: '2026-01', endMonth: null, sort: 0, archived: false,
})
const entry = (itemId: string, month: string, amount: number, paid = false): MonthEntry => ({
  id: `${itemId}-${month}`, itemId, month, amount, paid, note: null,
})
const tx = (date: string, amount: number, categoryId: string | null = 'food'): Transaction => ({
  id: `${date}-${amount}`, date, amount, categoryId, note: null, slipPath: null, slipHash: null, ocrAmount: null, createdAt: '',
})

const items = [item('salary', 'income'), item('rent', 'expense'), item('power', 'expense', true)]

describe('summarizeMonth', () => {
  const entries = [
    entry('salary', '2026-10', 3_600_000),
    entry('rent', '2026-10', 1_000_000, true),
    entry('power', '2026-10', 300_000),
    entry('rent', '2026-11', 999_999), // คนละเดือน ต้องไม่นับ
  ]
  const txs = [tx('2026-10-01', 12_000), tx('2026-10-31', 8_000), tx('2026-11-01', 50_000)]

  const rec = (actualBalance: number | null) => ({ month: '2026-10', actualBalance, spendBudget: null, closedAt: null })
  const sv = (date: string, amount: number, kind: 'deposit' | 'close') => ({ id: date + kind, date, amount, note: null, kind, createdAt: '' })

  it('cycle Oct: plan left = income − fixed of Oct; spending comes from NOVEMBER', () => {
    const s = summarizeMonth('2026-10', items, entries, txs, rec(null))
    expect(s).toMatchObject({ spendMonth: '2026-11', income: 3_600_000, fixedExpense: 1_300_000, planLeft: 2_300_000 })
    expect(s.daily).toBe(50_000) // เฉพาะ พ.ย. — รายจ่าย ต.ค. เป็นของรอบ ก.ย.
    expect(s.diff).toBeNull()
    expect(s.startMoney).toBe(2_300_000) // ยังไม่กรอกคงเหลือจริง → ใช้แผนเหลือ
    expect(s.left).toBe(2_250_000)
    expect(s.pendingEstimates).toBe(1)
    expect(s.unpaid).toBe(0) // rent จ่ายแล้ว, power เป็นยอดประมาณ
  })

  it('actual balance (after salary + bills) becomes next month start money; diff = actual − plan', () => {
    const s = summarizeMonth('2026-10', items, entries, txs, rec(2_800_000))
    expect(s.diff).toBe(500_000)
    expect(s.startMoney).toBe(2_800_000)
    expect(s.left).toBe(2_750_000)
  })

  it('negative diff allowed', () => expect(summarizeMonth('2026-10', items, entries, txs, rec(2_000_000)).diff).toBe(-300_000))

  it('set-aside at close (end of Oct) and deposits during Nov reduce the money left; other months ignored', () => {
    const s = summarizeMonth('2026-10', items, entries, txs, rec(2_800_000), [
      sv('2026-10-31', 1_000_000, 'close'),
      sv('2026-11-05', 300_000, 'deposit'),
      sv('2026-10-05', 777, 'deposit'), // เก็บระหว่าง ต.ค. = รอบ ก.ย.
      sv('2026-11-30', 999, 'close'), // ปิดรอบ พ.ย.
    ])
    expect(s).toMatchObject({ savedAtClose: 1_000_000, savedDeposits: 300_000, startMoney: 1_800_000, left: 1_800_000 - 50_000 - 300_000 })
    expect(s.diff).toBe(500_000) // แยกเก็บไม่กระทบเงินเกินแผน
  })

  it('entries of unknown/deleted items still count by kind fallback = expense', () => {
    const s = summarizeMonth('2026-10', items, [...entries, entry('ghost', '2026-10', 100)], [], null)
    expect(s.fixedExpense).toBe(1_300_100)
  })
})

describe('dailyAllowance', () => {
  it('divides remaining by days left including today', () => {
    expect(dailyAllowance(1_000_000, '2026-10', '2026-10-22')).toEqual({ daysLeft: 10, perDay: 100_000 })
    expect(dailyAllowance(1_000_000, '2026-10', '2026-10-31')).toEqual({ daysLeft: 1, perDay: 1_000_000 })
  })
  it('negative remaining → perDay 0', () => {
    expect(dailyAllowance(-5_000, '2026-10', '2026-10-22').perDay).toBe(0)
  })
  it('viewing a past or future month', () => {
    expect(dailyAllowance(1_000_000, '2026-09', '2026-10-22')).toEqual({ daysLeft: 0, perDay: 0 })
    expect(dailyAllowance(3_000_000, '2026-11', '2026-10-22')).toEqual({ daysLeft: 30, perDay: 100_000 })
  })
})

describe('daily aggregations', () => {
  const txs = [tx('2026-10-01', 100, 'food'), tx('2026-10-01', 50, 'fuel'), tx('2026-10-03', 25, null)]
  it('dailyTotals by date', () => {
    expect(dailyTotals(txs)).toEqual(new Map([['2026-10-01', 150], ['2026-10-03', 25]]))
  })
  it('categoryBreakdown sorted desc with share', () => {
    expect(categoryBreakdown(txs)).toEqual([
      { categoryId: 'food', total: 100, share: 100 / 175 },
      { categoryId: 'fuel', total: 50, share: 50 / 175 },
      { categoryId: null, total: 25, share: 25 / 175 },
    ])
    expect(categoryBreakdown([])).toEqual([])
  })
})

describe('entryStatus', () => {
  it('paid > estimate > pending', () => {
    expect(entryStatus(entry('x', '2026-10', 1, true), item('x', 'expense', true))).toBe('paid')
    expect(entryStatus(entry('x', '2026-10', 1), item('x', 'expense', true))).toBe('estimate')
    expect(entryStatus(entry('x', '2026-10', 1), item('x', 'expense'))).toBe('pending')
  })
})
