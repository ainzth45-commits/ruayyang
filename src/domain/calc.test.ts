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

  it('remaining = income − fixed − daily of that month only', () => {
    const s = summarizeMonth('2026-10', items, entries, txs, { month: '2026-10', actualBalance: null, spendBudget: null, closedAt: null })
    expect(s.income).toBe(3_600_000)
    expect(s.fixedExpense).toBe(1_300_000)
    expect(s.daily).toBe(20_000)
    expect(s.remaining).toBe(2_280_000)
    expect(s.diff).toBeNull()
    expect(s.pendingEstimates).toBe(1)
    expect(s.unpaid).toBe(0) // rent จ่ายแล้ว, power เป็นยอดประมาณ
  })

  it('extra income counts savings during the month but not the month-end set-aside', () => {
    const sv = (date: string, amount: number, kind: 'deposit' | 'close') => ({ id: date, date, amount, note: null, kind, createdAt: '' })
    const s = summarizeMonth('2026-10', items, entries, txs, { month: '2026-10', actualBalance: 2_000_000, spendBudget: null, closedAt: null }, [
      sv('2026-10-05', 300_000, 'deposit'),
      sv('2026-10-31', 2_000_000, 'close'),
      sv('2026-09-30', 999, 'deposit'), // คนละเดือน
    ])
    expect(s.savedDeposits).toBe(300_000)
    expect(s.savedAtClose).toBe(2_000_000)
    expect(s.diff).toBe(2_000_000 + 300_000 - 2_280_000)
  })

  it('diff = actual − remaining (negative allowed)', () => {
    const s = summarizeMonth('2026-10', items, entries, txs, { month: '2026-10', actualBalance: 2_000_000, spendBudget: null, closedAt: null })
    expect(s.diff).toBe(-280_000)
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
