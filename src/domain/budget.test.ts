import { describe, expect, it } from 'vitest'
import { avgDailySpend, budgetStatus, effectiveBudget } from './budget'

const rec = (month: string, spendBudget: number | null) => ({ month, actualBalance: null, spendBudget, closedAt: null })

describe('effectiveBudget', () => {
  it('own value wins', () => expect(effectiveBudget('2026-10', [rec('2026-09', 500_000), rec('2026-10', 600_000)])).toBe(600_000))
  it('inherits nearest earlier month', () =>
    expect(effectiveBudget('2026-12', [rec('2026-08', 1), rec('2026-10', 600_000), rec('2026-11', null)])).toBe(600_000))
  it('ignores later months', () => expect(effectiveBudget('2026-09', [rec('2026-10', 600_000)])).toBeNull())
  it('0 is a real budget', () => expect(effectiveBudget('2026-10', [rec('2026-09', 0)])).toBe(0))
  it('order of records does not matter', () =>
    expect(effectiveBudget('2026-12', [rec('2026-10', 2), rec('2026-08', 1)])).toBe(2))
})

describe('budgetStatus', () => {
  it('left / perDay counting today', () =>
    expect(budgetStatus(600_000, 180_000, '2026-10', '2026-10-22')).toEqual({ left: 420_000, daysLeft: 10, perDay: 42_000, frac: 0.7 }))
  it('over budget → negative left, no per-day', () =>
    expect(budgetStatus(100_000, 150_000, '2026-10', '2026-10-22')).toMatchObject({ left: -50_000, perDay: 0, frac: 0 }))
  it('no budget → null', () => expect(budgetStatus(null, 1, '2026-10', '2026-10-22')).toBeNull())
  it('zero budget → frac 0 (no divide by zero)', () => expect(budgetStatus(0, 0, '2026-10', '2026-10-22')).toMatchObject({ left: 0, frac: 0 }))
  it('past month → no days left', () => expect(budgetStatus(600_000, 0, '2026-09', '2026-10-22')).toMatchObject({ daysLeft: 0, perDay: 0 }))
})

describe('avgDailySpend', () => {
  const tx = (date: string, amount: number) => ({ date, amount })
  it('averages months before current that have spending', () =>
    expect(avgDailySpend([tx('2026-09-01', 300_000), tx('2026-08-03', 600_000), tx('2026-10-01', 999), tx('2026-06-01', 7)], '2026-10', 3)).toBe(450_000))
  it('null when no history', () => expect(avgDailySpend([tx('2026-10-01', 5)], '2026-10', 3)).toBeNull())
})
