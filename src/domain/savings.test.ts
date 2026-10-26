import { describe, expect, it } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../data/localRepo'
import { closeMonth, isMonthClosed, needsClosing, savedIn, savingsTotal } from './savings'
import type { SavingKind } from './types'

const s = (date: string, amount: number, kind: SavingKind = 'deposit') => ({ id: date + kind, date, amount, note: null, kind, createdAt: '' })
const r = (month: string, actualBalance: number | null, closedAt: string | null) => ({ month, actualBalance, spendBudget: null, closedAt })

describe('savings math', () => {
  it('total = opening + every saving', () => expect(savingsTotal(1000, [s('2026-09-30', 300, 'close'), s('2026-10-02', 200)])).toBe(1500))
  it('total with nothing = opening', () => expect(savingsTotal(0, [])).toBe(0))
  it('savedIn splits deposits / close for one month', () =>
    expect(savedIn([s('2026-10-02', 200), s('2026-10-31', 900, 'close'), s('2026-09-05', 7), s('2026-10-09', 1)], '2026-10')).toEqual({ deposits: 201, atClose: 900 }))
})

describe('closing state', () => {
  it('closed = closedAt or actualBalance', () => {
    expect(isMonthClosed(r('2026-09', 100, null))).toBe(true)
    expect(isMonthClosed(r('2026-09', 0, null))).toBe(true)
    expect(isMonthClosed(r('2026-09', null, 'x'))).toBe(true)
    expect(isMonthClosed(r('2026-09', null, null))).toBe(false)
    expect(isMonthClosed(undefined)).toBe(false)
  })
  it('current month: only in the last 2 days, until closed', () => {
    const prevClosed = r('2026-09', 1, null)
    expect(needsClosing('2026-10-29', [prevClosed])).toBeNull()
    expect(needsClosing('2026-10-30', [prevClosed])).toBe('2026-10')
    expect(needsClosing('2026-10-31', [prevClosed, r('2026-10', null, 'x')])).toBeNull()
    expect(needsClosing('2026-02-27', [r('2026-01', 1, null)])).toBe('2026-02') // ก.พ. 28 วัน
  })
  it('previous month still open wins (only if it exists)', () => {
    expect(needsClosing('2026-11-03', [r('2026-10', null, null)])).toBe('2026-10')
    expect(needsClosing('2026-11-03', [])).toBeNull()
    expect(needsClosing('2027-01-02', [r('2026-12', null, null)])).toBe('2026-12') // ข้ามปี
  })
})

describe('closeMonth', () => {
  it('saves balance + one close saving on the last day + closedAt; re-close edits; 0 removes', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await repo.insertMonthsIfAbsent(['2026-10'])
    await repo.addSaving({ date: '2026-10-05', amount: 50_000, note: null, kind: 'deposit' })
    await closeMonth(repo, '2026-10', 450_000, 300_000, '2026-10-31T12:00:00Z')
    const close = async () => (await repo.listSavings('2026-10-01', '2026-10-31')).filter((x) => x.kind === 'close')
    expect(await close()).toMatchObject([{ date: '2026-10-31', amount: 300_000 }])
    expect((await repo.listMonths('2026-10', '2026-10'))[0]).toMatchObject({ actualBalance: 450_000, closedAt: '2026-10-31T12:00:00Z' })

    await closeMonth(repo, '2026-10', 460_000, 100_000, '2026-11-01T00:00:00Z')
    expect((await close()).map((x) => x.amount)).toEqual([100_000])
    expect((await repo.listMonths('2026-10', '2026-10'))[0].actualBalance).toBe(460_000)

    await closeMonth(repo, '2026-10', 460_000, 0, '2026-11-01T00:00:00Z')
    expect(await close()).toEqual([])
    // เงินเก็บระหว่างเดือนไม่โดนแตะ
    expect((await repo.listSavings('2026-10-01', '2026-10-31')).map((x) => x.amount)).toEqual([50_000])
  })
  it('rejects negative save; negative actual balance is allowed', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await expect(closeMonth(repo, '2026-10', 1, -1, 'x')).rejects.toThrow()
    await closeMonth(repo, '2026-10', -20_000, 0, 'x')
    expect((await repo.listMonths('2026-10', '2026-10'))[0].actualBalance).toBe(-20_000)
  })
})
