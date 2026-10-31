import { describe, expect, it } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../data/localRepo'
import { loadMonth } from './monthData'

const closedAt = '2026-10-31T02:19:00Z'
describe('money available follows the opened cycle, not calendar rollover', () => {
  it('uses the new balance immediately, deducts same-day spending and continues on Nov 1', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await repo.insertMonthsIfAbsent(['2026-09', '2026-10', '2026-11'])
    await repo.setActualBalance('2026-09', 900_000)
    await repo.setMonthClosed('2026-09', '2026-09-30T02:00:00Z')
    await repo.setActualBalance('2026-10', 800_000)
    await repo.setMonthClosed('2026-10', closedAt)
    await repo.addTransaction({ date: '2026-10-31', amount: 10_000, categoryId: null, note: null, slipPath: null, slipHash: null, ocrAmount: null, cycleMonth: '2026-10' })
    const october = await loadMonth(repo, '2026-10', '2026-10-31T03:00:00Z')
    expect(october.spending).toMatchObject({ month: '2026-10', startMoney: 800_000, daily: 10_000, left: 790_000 })
    expect(october.txs).toHaveLength(1)
    const november = await loadMonth(repo, '2026-11', '2026-11-01T03:00:00Z')
    expect(november.spending).toMatchObject({ month: '2026-10', left: 790_000 })
    expect(november.txs).toHaveLength(0)
  })
  it('does not present a projected balance as opened cash when nothing has closed', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    const data = await loadMonth(repo, '2026-10', '2026-10-31T03:00:00Z')
    expect(data.spending).toBeNull()
  })
})
