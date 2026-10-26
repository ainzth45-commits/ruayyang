import { describe, expect, it } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from './localRepo'

describe('LocalRepo: budget / closing / savings / settings', () => {
  it('month fields default null, upsert, and persist', async () => {
    const kv = memoryKV()
    const r = new LocalRepo(kv, memorySlipStore())
    await r.insertMonthsIfAbsent(['2026-10'])
    expect((await r.listMonths('2026-10', '2026-10'))[0]).toEqual({ month: '2026-10', actualBalance: null, spendBudget: null, closedAt: null })
    await r.setMonthBudget('2026-11', 600_000)
    await r.setMonthClosed('2026-10', '2026-10-31T10:00:00Z')
    const again = new LocalRepo(kv, memorySlipStore())
    expect(await again.listMonths('2026-10', '2026-11')).toMatchObject([
      { month: '2026-10', closedAt: '2026-10-31T10:00:00Z', spendBudget: null },
      { month: '2026-11', spendBudget: 600_000, actualBalance: null },
    ])
    await expect(r.setMonthBudget('2026-11', -1)).rejects.toThrow()
  })

  it('months stored before round 2 read new fields as null', async () => {
    const kv = memoryKV()
    kv.setItem('ledger-local-v1', JSON.stringify({ months: [{ month: '2026-09', actualBalance: 5 }] }))
    const r = new LocalRepo(kv, memorySlipStore())
    expect((await r.listMonths('2026-09', '2026-09'))[0]).toEqual({ month: '2026-09', actualBalance: 5, spendBudget: null, closedAt: null })
    expect(await r.listSavings('2000-01-01', '9999-12-31')).toEqual([])
    expect(await r.getSettings()).toEqual({ savingsOpening: 0 })
  })

  it('savings CRUD, newest first, rejects amount <= 0 and second close on same day', async () => {
    const r = new LocalRepo(memoryKV(), memorySlipStore())
    const a = await r.addSaving({ date: '2026-10-01', amount: 100, note: null, kind: 'deposit' })
    await r.addSaving({ date: '2026-10-05', amount: 200, note: 'x', kind: 'deposit' })
    await expect(r.addSaving({ date: '2026-10-05', amount: 0, note: null, kind: 'deposit' })).rejects.toThrow()
    await expect(r.addSaving({ date: '2026-10-05', amount: 1.5, note: null, kind: 'deposit' })).rejects.toThrow()
    await r.addSaving({ date: '2026-10-31', amount: 1, note: null, kind: 'close' })
    await expect(r.addSaving({ date: '2026-10-31', amount: 2, note: null, kind: 'close' })).rejects.toThrow()
    expect((await r.listSavings('2026-10-01', '2026-10-30')).map((s) => s.amount)).toEqual([200, 100])
    await r.updateSaving(a.id, { amount: 150 })
    await expect(r.updateSaving(a.id, { amount: -5 })).rejects.toThrow()
    expect((await r.listSavings('2026-10-01', '2026-10-01'))[0].amount).toBe(150)
    await r.deleteSaving(a.id)
    await expect(r.updateSaving(a.id, { amount: 1 })).rejects.toThrow('ไม่พบ')
    expect(await r.listSavings('2026-10-01', '2026-10-31')).toHaveLength(2)
  })

  it('settings default 0, save, reject negative', async () => {
    const r = new LocalRepo(memoryKV(), memorySlipStore())
    await r.saveSettings({ savingsOpening: 2_500_000 })
    expect(await r.getSettings()).toEqual({ savingsOpening: 2_500_000 })
    await expect(r.saveSettings({ savingsOpening: -1 })).rejects.toThrow()
  })
})
