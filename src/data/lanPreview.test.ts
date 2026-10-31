import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from './localRepo'

afterEach(() => vi.unstubAllGlobals())
describe('HTTP LAN preview on iPhone', () => {
  it('creates categories, bills, expenses and receipt paths without secure-context randomUUID', async () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    const category = await repo.saveCategory({ name: 'อาหาร', icon: 'utensils', sort: 0, archived: false })
    const item = await repo.saveItem({ name: 'บิลทดสอบ', kind: 'expense', defaultAmount: 10_000, isEstimate: false, startMonth: '2026-10', endMonth: null, sort: 0, archived: false })
    await repo.insertEntriesIfAbsent([{ itemId: item.id, month: '2026-10', amount: 10_000, paid: true, note: null }])
    await repo.closeMonthAtomic('2026-10', 800_000, 10_000, '2026-10-31T02:00:00Z')
    const tx = await repo.addTransaction({ date: '2026-10-31', amount: 10_000, categoryId: category.id, note: null, slipPath: null, slipHash: null, ocrAmount: null })
    const receipt = await repo.uploadSlip(new Blob(['test'], { type: 'image/jpeg' }), '2026-10')
    const ids = [category.id, item.id, tx.id, (await repo.listEntries('2026-10', '2026-10'))[0].id]
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(new Set(ids).size).toBe(ids.length)
    expect(receipt).toMatch(/^local\/2026-10\/[0-9a-f-]+\.jpg$/)
  })
})
