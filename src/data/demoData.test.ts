import { describe, expect, it } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from './localRepo'
import { seedDemo } from './demoData'
import { ensureDefaultCategories } from '../domain/plan'

async function build() {
  const repo = new LocalRepo(memoryKV(), memorySlipStore())
  await ensureDefaultCategories(repo)
  await repo.saveItem({ name: 'ค่าอินเทอร์เน็ต', kind: 'expense', defaultAmount: 45678, isEstimate: false, startMonth: '2026-01', endMonth: null, sort: 0, archived: false })
  await repo.saveItem({ name: 'ค่าน้ำ+ค่าไฟ', kind: 'expense', defaultAmount: 300000, isEstimate: true, startMonth: '2026-01', endMonth: null, sort: 1, archived: false })
  await seedDemo(repo, '2026-10-22')
  return repo
}

describe('seedDemo', () => {
  it('creates varied, valid daily transactions up to today only', async () => {
    const repo = await build()
    const txs = await repo.listTransactions('2000-01-01', '9999-12-31')
    const cats = new Set((await repo.listCategories()).map((c) => c.id))
    expect(txs.length).toBeGreaterThan(30)
    expect(txs.every((t) => t.date >= '2026-10-01' && t.date <= '2026-10-22')).toBe(true)
    expect(txs.every((t) => t.amount > 0 && t.amount % 500 === 0 && cats.has(t.categoryId!))).toBe(true)
    expect(new Set(txs.map((t) => t.categoryId)).size).toBeGreaterThanOrEqual(5)
    expect(new Set(txs.map((t) => t.date)).size).toBeGreaterThanOrEqual(18)
  })

  it('is deterministic and marks some fixed items paid, leaves estimates unpaid', async () => {
    const a = (await (await build()).listTransactions('2000-01-01', '9999-12-31')).map((t) => `${t.date}|${t.amount}|${t.note}`).sort()
    const b = (await (await build()).listTransactions('2000-01-01', '9999-12-31')).map((t) => `${t.date}|${t.amount}|${t.note}`).sort()
    expect(a).toEqual(b)
    const repo = await build()
    const items = new Map((await repo.listItems()).map((i) => [i.id, i.name]))
    const oct = await repo.listEntries('2026-10', '2026-10')
    expect(oct.find((e) => items.get(e.itemId) === 'ค่าอินเทอร์เน็ต')?.paid).toBe(true)
    expect(oct.find((e) => items.get(e.itemId) === 'ค่าน้ำ+ค่าไฟ')?.paid).toBe(false)
  })

  it('sets a budget, opening savings and a few savings (deposits + last month close)', async () => {
    const repo = await build()
    expect((await repo.listMonths('2026-10', '2026-10'))[0].spendBudget).toBe(600_000)
    expect(await repo.getSettings()).toEqual({ savingsOpening: 2_500_000 })
    const sv = await repo.listSavings('2000-01-01', '9999-12-31')
    expect(sv.map((x) => `${x.date}|${x.kind}|${x.amount}`)).toEqual(['2026-10-15|deposit|50000', '2026-10-01|deposit|100000', '2026-09-30|close|300000'])
  })
})
