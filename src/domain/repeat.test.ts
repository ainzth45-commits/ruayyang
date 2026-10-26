import { describe, expect, it } from 'vitest'
import { orderCategories, repeatSuggestions } from './repeat'

const t = (date: string, amount: number, categoryId: string | null, note: string | null, createdAt = '') => ({
  id: `${date}${amount}${note}${createdAt}`, date, amount, categoryId, note, slipPath: null, slipHash: null, ocrAmount: null, createdAt,
})

describe('repeatSuggestions', () => {
  const txs = [
    t('2026-10-20', 6000, 'food', 'ข้าวเที่ยง'),
    t('2026-10-21', 6000, 'food', 'ข้าวเที่ยง'),
    t('2026-10-22', 6000, 'food', ' ข้าวเที่ยง '),
    t('2026-10-22', 4500, 'drink', 'ชาไทย'),
    t('2026-10-15', 3000, 'drink', null),
    t('2026-09-01', 9999, 'food', 'เก่าเกิน 30 วัน'),
    t('2026-10-10', 30000, null, 'ไม่มีหมวด'),
    t('2026-10-23', 1, 'food', 'อนาคต'),
  ]
  it('groups by category+note+amount, frequent first then latest, 30-day window, skips uncategorised/future', () =>
    expect(repeatSuggestions(txs, '2026-10-22', 6)).toEqual([
      { categoryId: 'food', note: 'ข้าวเที่ยง', amount: 6000, count: 3 },
      { categoryId: 'drink', note: 'ชาไทย', amount: 4500, count: 1 },
      { categoryId: 'drink', note: null, amount: 3000, count: 1 },
    ]))
  it('respects limit', () => expect(repeatSuggestions(txs, '2026-10-22', 1)).toHaveLength(1))
  it('window crosses month/year boundary', () =>
    expect(repeatSuggestions([t('2025-12-10', 5, 'a', null)], '2026-01-05', 6)).toHaveLength(1))
  it('same-day tie broken by createdAt', () =>
    expect(repeatSuggestions([t('2026-10-22', 1, 'a', 'x', '09'), t('2026-10-22', 2, 'a', 'y', '10')], '2026-10-22', 6).map((p) => p.note)).toEqual(['y', 'x']))
})

describe('orderCategories', () => {
  const cats = [
    { id: 'food', sort: 0, archived: false },
    { id: 'drink', sort: 1, archived: false },
    { id: 'fuel', sort: 2, archived: false },
    { id: 'old', sort: 3, archived: true },
  ].map((c) => ({ name: c.id, icon: 'more', ...c }))
  it('most used in 60 days first, then original sort; archived dropped', () => {
    const txs = [t('2026-10-20', 1, 'fuel', null), t('2026-10-21', 1, 'fuel', null), t('2026-10-22', 1, 'drink', null), t('2026-01-01', 1, 'food', null), t('2026-10-01', 1, 'old', null)]
    expect(orderCategories(cats, txs, '2026-10-22').map((c) => c.id)).toEqual(['fuel', 'drink', 'food'])
  })
  it('does not mutate input', () => {
    const copy = structuredClone(cats)
    orderCategories(cats, [t('2026-10-20', 1, 'fuel', null)], '2026-10-22')
    expect(cats).toEqual(copy)
  })
})
