import { describe, expect, it } from 'vitest'
import { formatBaht, parseMoneyInput, sanitizeText, toSatang, fromSatang, MAX_SATANG } from './money'

describe('parseMoneyInput', () => {
  it.each([
    ['120', 12000],
    ['1,250.50', 125050],
    ['  99.9 ', 9990],
    ['0.01', 1],
    ['฿3,000', 300000],
    ['3000 บาท', 300000],
    ['1​20', 12000], // อักขระล่องหนจากการ copy
    ['１２０', 12000], // เลขเต็มความกว้าง
    ['๑๒๐', 12000], // เลขไทย
  ])('%s → %d', (input, expected) => {
    expect(parseMoneyInput(input)).toEqual({ ok: true, value: expected })
  })

  it.each(['', '  ', 'abc', '1.234', '1,2,3.4.5', '-50', '0', '0.00', '12..5'])('reject %j', (input) => {
    expect(parseMoneyInput(input).ok).toBe(false)
  })

  it('rejects above max', () => {
    expect(parseMoneyInput('10,000,000').ok).toBe(false)
    expect(parseMoneyInput('9,999,999.99')).toEqual({ ok: true, value: MAX_SATANG })
  })

  it('allowZero for plan amounts', () => {
    expect(parseMoneyInput('0', { allowZero: true })).toEqual({ ok: true, value: 0 })
  })
})

describe('satang conversion', () => {
  it('handles floats and strings from DB without drift', () => {
    expect(toSatang(456.78)).toBe(45678)
    expect(toSatang('1234.56')).toBe(123456)
    expect(toSatang(0.1 + 0.2)).toBe(30)
    expect(fromSatang(45678)).toBe('456.78')
    expect(fromSatang(-32145)).toBe('-321.45')
  })
})

describe('formatBaht', () => {
  it('formats with separators and 2 decimals', () => {
    expect(formatBaht(12345678)).toBe('123,456.78')
    expect(formatBaht(-32145)).toBe('-321.45')
    expect(formatBaht(300000, { decimals: false })).toBe('3,000')
  })
})

describe('sanitizeText', () => {
  it('trims, strips invisible chars, collapses spaces, limits length', () => {
    expect(sanitizeText('  ข้าว​ มัน  ไก่  ')).toBe('ข้าว มัน ไก่')
    expect(sanitizeText('a'.repeat(300), 10)).toBe('a'.repeat(10))
    expect(sanitizeText('   ')).toBe('')
  })
})
