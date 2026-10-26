import { describe, expect, it } from 'vitest'
import { addDays, addMonths, bangkokToday, daysInMonth, isActiveIn, monthOf, monthRange, monthLabel } from './month'

describe('month utils', () => {
  it('addMonths crosses years both ways', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-10', 14)).toBe('2027-12')
  })

  it('monthRange inclusive', () => {
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(monthRange('2026-03', '2026-02')).toEqual([])
  })

  it('daysInMonth handles leap years', () => {
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2026-10')).toBe(31)
  })

  it('bangkokToday uses UTC+7 regardless of device timezone', () => {
    // 2026-10-22 18:30 UTC = 2026-10-23 01:30 ในไทย
    expect(bangkokToday(new Date('2026-10-22T18:30:00Z'))).toBe('2026-10-23')
    expect(bangkokToday(new Date('2026-10-22T16:59:59Z'))).toBe('2026-10-22')
  })

  it('monthOf and label', () => {
    expect(monthOf('2026-10-23')).toBe('2026-10')
    expect(monthLabel('2026-10')).toBe('ต.ค. 2026')
    expect(monthLabel('2027-01', { long: true })).toBe('มกราคม 2027')
  })

  it('isActiveIn respects start/end/archived', () => {
    const item = { startMonth: '2026-02', endMonth: '2026-12', archived: false }
    expect(isActiveIn(item, '2026-01')).toBe(false)
    expect(isActiveIn(item, '2026-02')).toBe(true)
    expect(isActiveIn(item, '2026-12')).toBe(true)
    expect(isActiveIn(item, '2027-01')).toBe(false)
    expect(isActiveIn({ ...item, endMonth: null }, '2030-05')).toBe(true)
    expect(isActiveIn({ ...item, archived: true }, '2026-05')).toBe(false)
  })
})

describe('addDays', () => {
  it('crosses month/year/leap boundaries', () => {
    expect(addDays('2026-01-05', -30)).toBe('2025-12-06')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})
