import { beforeEach, describe, expect, it } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../data/localRepo'
import { applyDefaultToFuture, DEFAULT_CATEGORIES, ensureDefaultCategories, ensureMonths, importSeed, stopItem, type Seed } from './plan'
import type { RecurringItem } from './types'

let repo: LocalRepo
const base: Omit<RecurringItem, 'id'> = {
  name: 'ค่าเน็ต', kind: 'expense', defaultAmount: 45678, isEstimate: false,
  startMonth: '2026-10', endMonth: '2026-12', sort: 0, archived: false,
}

beforeEach(() => {
  repo = new LocalRepo(memoryKV(), memorySlipStore())
})

describe('ensureMonths', () => {
  it('creates entries for active items only, once', async () => {
    const net = await repo.saveItem(base)
    await repo.saveItem({ ...base, name: 'เก่า', archived: true })
    await ensureMonths(repo, '2026-09', '2027-01')
    const entries = await repo.listEntries('2026-01', '2027-12')
    expect(entries.map((e) => e.month).sort()).toEqual(['2026-10', '2026-11', '2026-12'])
    expect(entries.every((e) => e.itemId === net.id && e.amount === 45678 && !e.paid)).toBe(true)
    expect((await repo.listMonths('2026-01', '2027-12')).length).toBe(5)

    // เรียกซ้ำต้องไม่เพิ่ม
    await ensureMonths(repo, '2026-09', '2027-01')
    expect((await repo.listEntries('2026-01', '2027-12')).length).toBe(3)
  })

  it('does not refill a month that already exists (user deleted an entry on purpose)', async () => {
    await repo.saveItem(base)
    await ensureMonths(repo, '2026-10', '2026-10')
    const [e] = await repo.listEntries('2026-10', '2026-10')
    await repo.deleteEntries([e.id])
    await ensureMonths(repo, '2026-10', '2026-10')
    expect(await repo.listEntries('2026-10', '2026-10')).toEqual([])
  })

  it('recovers if months row was not written (crash between steps)', async () => {
    const item = await repo.saveItem(base)
    await repo.insertEntriesIfAbsent([{ itemId: item.id, month: '2026-10', amount: 1, paid: false, note: null }])
    await ensureMonths(repo, '2026-10', '2026-10')
    const entries = await repo.listEntries('2026-10', '2026-10')
    expect(entries).toHaveLength(1)
    expect(entries[0].amount).toBe(1) // ไม่ทับของเดิม
  })
})

describe('applyDefaultToFuture', () => {
  it('updates unpaid entries from month onward, leaves paid and past', async () => {
    const item = await repo.saveItem({ ...base, startMonth: '2026-09', endMonth: null })
    await ensureMonths(repo, '2026-09', '2026-12')
    const all = await repo.listEntries('2026-09', '2026-12')
    const nov = all.find((e) => e.month === '2026-11')!
    await repo.updateEntry(nov.id, { paid: true })

    const n = await applyDefaultToFuture(repo, item, 99900, '2026-10')
    expect(n).toBe(2)
    const after = Object.fromEntries((await repo.listEntries('2026-09', '2026-12')).map((e) => [e.month, e.amount]))
    expect(after).toEqual({ '2026-09': 45678, '2026-10': 99900, '2026-11': 45678, '2026-12': 99900 })
    expect((await repo.listItems())[0].defaultAmount).toBe(99900)
  })
})

describe('stopItem', () => {
  it('ends item before month, removes unpaid entries from then, keeps paid history', async () => {
    const item = await repo.saveItem({ ...base, startMonth: '2026-09', endMonth: null })
    await ensureMonths(repo, '2026-09', '2026-12')
    const sep = (await repo.listEntries('2026-09', '2026-09'))[0]
    await repo.updateEntry(sep.id, { paid: true })
    const dec = (await repo.listEntries('2026-12', '2026-12'))[0]
    await repo.updateEntry(dec.id, { paid: true })

    await stopItem(repo, item, '2026-10')
    const months = (await repo.listEntries('2026-01', '2027-12')).map((e) => e.month).sort()
    expect(months).toEqual(['2026-09', '2026-12']) // ที่จ่ายแล้วเก็บไว้
    expect((await repo.listItems())[0].endMonth).toBe('2026-09')
    await ensureMonths(repo, '2027-01', '2027-01')
    expect(await repo.listEntries('2027-01', '2027-01')).toEqual([])
  })
})

describe('ensureDefaultCategories', () => {
  it('seeds once', async () => {
    await ensureDefaultCategories(repo)
    await ensureDefaultCategories(repo)
    const cats = await repo.listCategories()
    expect(cats.map((c) => c.name)).toEqual(DEFAULT_CATEGORIES.map((c) => c.name))
  })
})

describe('importSeed', () => {
  const seed: Seed = {
    paid_until: '2026-09',
    months: [
      { month: '2026-09', actual_balance: '4321.09' },
      { month: '2026-10', actual_balance: null },
    ],
    items: [
      { name: 'เงินเดือน', kind: 'income', is_estimate: false, default_amount: '20000.00', start_month: '2026-09', end_month: null, sort: 0, entries: { '2026-09': '20000.00', '2026-10': '20000.00' } },
      { name: 'ค่าน้ำมัน', kind: 'expense', is_estimate: false, default_amount: '500.00', start_month: '2026-09', end_month: '2026-09', sort: 1, entries: { '2026-09': '500.00' } },
    ],
  }

  it('imports items/entries/months with paid status by paid_until', async () => {
    await importSeed(repo, seed)
    const items = await repo.listItems()
    expect(items.map((i) => [i.name, i.defaultAmount, i.endMonth])).toEqual([
      ['เงินเดือน', 2_000_000, null],
      ['ค่าน้ำมัน', 50_000, '2026-09'],
    ])
    const entries = await repo.listEntries('2026-01', '2027-12')
    expect(entries.map((e) => [e.month, e.paid]).sort()).toEqual([['2026-09', true], ['2026-09', true], ['2026-10', false]])
    const months = await repo.listMonths('2026-01', '2027-12')
    expect(months).toMatchObject([{ month: '2026-09', actualBalance: 432_109, spendBudget: null }, { month: '2026-10', actualBalance: null, closedAt: null }])
  })

  it('refuses to import twice', async () => {
    await importSeed(repo, seed)
    await expect(importSeed(repo, seed)).rejects.toThrow('มีข้อมูลอยู่แล้ว')
  })
})

describe('ensureDefaultCategories concurrency', () => {
  it('parallel calls seed only once', async () => {
    await Promise.all([ensureDefaultCategories(repo), ensureDefaultCategories(repo), ensureDefaultCategories(repo)])
    expect(await repo.listCategories()).toHaveLength(DEFAULT_CATEGORIES.length)
  })
})
