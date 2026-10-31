import { describe, expect, it } from 'vitest'
import { activeCycle, cycleForDate, transactionCycle } from './cycle'
import type { MonthRecord } from './types'

const september: MonthRecord = { month: '2026-09', actualBalance: 100_000, spendBudget: null, closedAt: '2026-09-30T02:00:00Z' }
const october: MonthRecord = { month: '2026-10', actualBalance: 800_000, spendBudget: null, closedAt: '2026-10-31T02:19:00Z' }
const november: MonthRecord = { month: '2026-11', actualBalance: 800_000, spendBudget: null, closedAt: '2026-11-30T02:00:00Z' }
const records = [november, september, october]

describe('cash cycle selection', () => {
  it('switches at the exact close instant within the same Bangkok date', () => {
    expect(cycleForDate('2026-10-31', records, '2026-10-31T02:18:59Z')).toBe('2026-09')
    expect(cycleForDate('2026-10-31', records, '2026-10-31T02:19:00Z')).toBe('2026-10')
    expect(cycleForDate('2026-11-01', records, '2026-11-01T04:00:00Z')).toBe('2026-10')
  })

  it('uses Bangkok dates when closing is on the preceding UTC date', () => {
    const closeAtMidnight = { ...october, closedAt: '2026-10-30T17:00:00Z' }
    expect(cycleForDate('2026-10-30', [september, closeAtMidnight], '2026-10-31T03:00:00Z')).toBe('2026-09')
    expect(cycleForDate('2026-10-31', [september, closeAtMidnight], '2026-10-31T03:00:00Z')).toBe('2026-10')
  })

  it('keeps an open cycle until the next close instead of resetting on day 1', () => {
    expect(cycleForDate('2026-12-10', [september, october], '2026-12-10T03:00:00Z')).toBe('2026-10')
  })

  it('does not assign a backdated entry to a cycle opened after its expense date', () => {
    expect(cycleForDate('2026-10-30', records, '2026-11-02T03:00:00Z')).toBe('2026-09')
  })

  it('uses the previous calendar month if no actual cycle has opened', () => {
    expect(cycleForDate('2027-01-01', [], '2027-01-01T03:00:00Z')).toBe('2026-12')
    expect(activeCycle([{ ...october, actualBalance: null }], '2026-10-31', '2026-10-31T03:00:00Z')).toBeNull()
  })

  it('opens imported actual balances on the first of the following month', () => {
    const imported = { ...october, actualBalance: 0, closedAt: null }
    expect(activeCycle([imported], '2026-10-31', '2026-10-31T03:00:00Z')).toBeNull()
    expect(activeCycle([imported], '2026-11-01', '2026-11-01T03:00:00Z')).toEqual(imported)
  })

  it('ignores future months and malformed close timestamps', () => {
    const futureWithEarlyTimestamp = { ...november, closedAt: '2026-10-31T02:00:00Z' }
    expect(activeCycle([september, futureWithEarlyTimestamp, { ...october, closedAt: 'bad' }], '2026-10-31', '2026-10-31T03:00:00Z')).toEqual(september)
  })

  it('picks the latest opened cycle regardless of record order', () => {
    expect(activeCycle(records, '2026-10-31', '2026-10-31T03:00:00Z')).toEqual(october)
  })

  it('does not replace the current cycle when an older imported month is closed later', () => {
    const septemberClosedLater = { ...september, closedAt: '2026-10-31T04:00:00Z' }
    const updatedRecords = [october, septemberClosedLater]
    expect(activeCycle(updatedRecords, '2026-10-31', '2026-10-31T05:00:00Z')).toEqual(october)
    expect(cycleForDate('2026-10-31', updatedRecords, '2026-10-31T05:00:00Z')).toBe('2026-10')
    expect(transactionCycle({ date: '2026-10-31', createdAt: '2026-10-31T05:00:00Z' }, updatedRecords)).toBe('2026-10')
  })

  it('preserves explicit assignments and falls back safely for old missing creation times', () => {
    expect(transactionCycle({ date: '2026-10-31', createdAt: '', cycleMonth: '2026-10' }, records)).toBe('2026-10')
    expect(transactionCycle({ date: '2026-10-31', createdAt: '' }, records)).toBe('2026-09')
    expect(transactionCycle({ date: '2026-11-01', createdAt: 'bad' }, records)).toBe('2026-10')
    expect(transactionCycle({ date: '2026-10-31', createdAt: '2026-10-31T02:20:00Z' }, records)).toBe('2026-10')
  })

  it('rejects impossible expense dates and explicit invalid reference times', () => {
    expect(() => cycleForDate('2026-02-30', records)).toThrow(/วันที่/)
    expect(() => cycleForDate('2026-10-31', records, 'bad')).toThrow(/เวลา/)
  })
})
