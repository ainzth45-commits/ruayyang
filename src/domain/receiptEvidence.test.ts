import { describe, expect, it } from 'vitest'
import type { MonthEntry, RecurringItem } from './types'
import { entryReceipts, receiptPaymentCheck, validateReceiptEvidence, validateReceiptPayment } from './receipt'

const item: RecurringItem = { id: 'bill', name: 'ค่าไฟ', kind: 'expense', defaultAmount: 87_500, isEstimate: false, startMonth: '2026-10', endMonth: null, sort: 0, archived: false }
const entry: MonthEntry = { id: 'entry', itemId: item.id, month: '2026-10', amount: 87_500, paid: true, note: null }

describe('receipt amount verification', () => {
  it('keeps legacy proof visible and treats unknown OCR as unreadable', () => {
    const legacy = { ...entry, receiptPath: 'old.jpg' }
    expect(entryReceipts(legacy)).toEqual([{ path: 'old.jpg', ocrAmount: null }])
    expect(receiptPaymentCheck(legacy).status).toBe('unreadable')
    expect(entryReceipts({ ...legacy, receipts: [] })).toEqual([])
  })
  it('compares exact integer satang and suggests the slip amount on mismatch', () => {
    const proof = { ...entry, receipts: [{ path: 'a', ocrAmount: 87_500 }] }
    expect(receiptPaymentCheck(proof)).toMatchObject({ status: 'match', suggestedAmount: 87_500 })
    expect(receiptPaymentCheck({ ...proof, amount: 87_499 })).toMatchObject({ status: 'mismatch', suggestedAmount: 87_500 })
  })
  it('requires an explicit interpretation for multiple images, then supports split payments and equal proofs', () => {
    const split = { ...entry, receipts: [{ path: 'a', ocrAmount: 45_000 }, { path: 'b', ocrAmount: 42_500 }] }
    expect(receiptPaymentCheck(split).status).toBe('mode-required')
    expect(receiptPaymentCheck({ ...split, receiptMode: 'sum' }).status).toBe('match')
    expect(receiptPaymentCheck({ ...split, receiptMode: 'each' })).toMatchObject({ status: 'mismatch', suggestedAmount: null })
    const equal = { ...split, receipts: split.receipts.map((r) => ({ ...r, ocrAmount: 87_500 })) }
    expect(receiptPaymentCheck({ ...equal, receiptMode: 'each' }).status).toBe('match')
    expect(receiptPaymentCheck({ ...equal, receiptMode: 'sum' })).toMatchObject({ status: 'mismatch', suggestedAmount: 175_000 })
  })
  it('does not count an unreadable or malformed amount as zero or as matching', () => {
    for (const ocrAmount of [null, NaN, -1, 0.5, Infinity]) {
      expect(receiptPaymentCheck({ ...entry, receipts: [{ path: 'a', ocrAmount }] }).status).toBe('unreadable')
    }
  })
  it('blocks paid mismatch/unknown/new legacy payment, but permits draft, no proof and income', () => {
    const mismatch = { ...entry, receipts: [{ path: 'a', ocrAmount: 80_000 }] }
    expect(() => validateReceiptPayment(mismatch, item)).toThrow('ยอด')
    expect(() => validateReceiptPayment({ ...entry, receiptPath: 'legacy' }, item)).toThrow('อ่าน')
    expect(() => validateReceiptPayment({ ...mismatch, paid: false }, item)).not.toThrow()
    expect(() => validateReceiptPayment(entry, item)).not.toThrow()
    expect(() => validateReceiptPayment(mismatch, { ...item, kind: 'income' })).not.toThrow()
  })
  it('preserves unchanged old paid records but requires checks when their amount/proof changes', () => {
    const legacy = { ...entry, receiptPath: 'legacy' }
    expect(() => validateReceiptPayment({ ...legacy, note: 'note' }, item, legacy)).not.toThrow()
    expect(() => validateReceiptPayment({ ...legacy, amount: 90_000 }, item, legacy)).toThrow()
    expect(() => validateReceiptPayment({ ...legacy, receipts: [{ path: 'new', ocrAmount: null }] }, item, legacy)).toThrow()
  })
  it('validates duplicate paths, invalid shapes and numeric limits before upload/save', () => {
    expect(() => validateReceiptEvidence([{ path: 'a', ocrAmount: 1 }, { path: 'a', ocrAmount: 2 }])).toThrow()
    for (const ocrAmount of [-1, NaN, 1.1, 1_000_000_000]) expect(() => validateReceiptEvidence([{ path: 'a', ocrAmount }])).toThrow()
    expect(() => validateReceiptEvidence([{ path: '', ocrAmount: null }])).toThrow()
    expect(() => validateReceiptEvidence([{ path: 'a', ocrAmount: null }])).not.toThrow()
  })
})
