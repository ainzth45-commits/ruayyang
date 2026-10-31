import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MonthEntry, ReceiptEvidence } from '../domain/types'
import { LocalRepo, memoryKV, memorySlipStore, type KV } from './localRepo'
import { SupabaseRepo } from './supabaseRepo'

afterEach(() => vi.restoreAllMocks())
const images: ReceiptEvidence[] = [
  { path: 'owner/2026-10/first.jpg', ocrAmount: 45_000 },
  { path: 'owner/2026-10/second.jpg', ocrAmount: 42_500 },
]
const original: MonthEntry = { id: 'entry', itemId: 'bill', month: '2026-10', amount: 87_500, paid: false, note: 'เดิม', receiptPath: 'owner/2026-10/first.jpg' }

async function fixture(kv: KV = memoryKV()) {
  const slips = memorySlipStore()
  const repo = new LocalRepo(kv, slips)
  const { id: _id, ...entry } = original
  await repo.insertEntriesIfAbsent([entry])
  return { repo, slips, entry: (await repo.listEntries('2026-10', '2026-10'))[0] }
}

describe('local multiple bill receipts', () => {
  it('upgrades a legacy single proof and round-trips OCR satang without changing payment fields', async () => {
    const kv = memoryKV()
    const { repo, entry } = await fixture(kv)
    const saved = await repo.saveEntryReceipts(entry, images)
    expect(saved).toEqual({ ...entry, receipts: images, receiptRevision: 1, receiptMode: null })
    expect(await repo.listEntries('2026-10', '2026-10')).toEqual([saved])
    expect(await new LocalRepo(kv, memorySlipStore()).listEntries('2026-10', '2026-10')).toEqual([saved])
    expect(await repo.listTransactions('2026-10-01', '2026-10-31')).toEqual([])
    // The returned data must not be a mutable alias into local state.
    saved.receipts![0].ocrAmount = 1
    expect((await repo.listEntries('2026-10', '2026-10'))[0].receipts).toEqual(images)
  })

  it('rejects stale receipt or payment snapshots and keeps the newer amount/note until reloaded', async () => {
    const { repo, entry } = await fixture()
    const saved = await repo.saveEntryReceipts(entry, images)
    await repo.updateEntry(entry.id, { amount: 90_000, note: 'แก้ยอดแล้ว' })
    await expect(repo.saveEntryReceipts(entry, [])).rejects.toThrow(/เปลี่ยน.*โหลดใหม่/)
    await expect(repo.saveEntryReceipts(saved, images.slice(1))).rejects.toThrow(/เปลี่ยน.*โหลดใหม่/)
    const current = (await repo.listEntries('2026-10', '2026-10'))[0]
    const next = await repo.saveEntryReceipts(current, images.slice(1))
    expect(next).toMatchObject({ amount: 90_000, note: 'แก้ยอดแล้ว', receiptPath: images[1].path, receipts: images.slice(1), receiptRevision: 2 })
    const cleared = await repo.saveEntryReceipts(next, [])
    expect(cleared).toMatchObject({ receipts: [], receiptPath: null, receiptRevision: 3 })
  })

  it.each([
    { amount: 90_000 },
    { paid: true },
    { note: 'เปลี่ยนในอีกแท็บ' },
  ])('does not overwrite a concurrent payment edit %o when saving receipt drafts', async (patch) => {
    const { repo, entry } = await fixture()
    const saved = await repo.saveEntryReceipts(entry, images, 'sum')
    await repo.updateEntry(saved.id, patch)
    const current = (await repo.listEntries('2026-10', '2026-10'))[0]
    await expect(repo.saveEntryReceipts(saved, images, 'sum', { amount: saved.amount, paid: saved.paid, note: saved.note })).rejects.toThrow(/เปลี่ยน.*โหลดใหม่/)
    expect(await repo.listEntries('2026-10', '2026-10')).toEqual([current])
  })

  it('saves payment and evidence atomically, preserving the selected check mode on later receipt edits', async () => {
    const { repo, entry } = await fixture()
    const saved = await repo.saveEntryReceipts(entry, images, 'sum', { amount: 87_500, paid: true, note: 'จ่ายสองครั้ง' })
    expect(saved).toMatchObject({ receipts: images, receiptRevision: 1, receiptMode: 'sum', paid: true, amount: 87_500, note: 'จ่ายสองครั้ง' })
    const repeated = await repo.saveEntryReceipts(saved, images)
    expect(repeated).toMatchObject({ receiptMode: 'sum', receiptRevision: 2, paid: true })
  })

  it('rejects a paid evidence mismatch without changing the stored bill or receipts', async () => {
    const { repo, entry } = await fixture()
    await expect(repo.saveEntryReceipts(entry, images, 'sum', { amount: 99_900, paid: true })).rejects.toThrow()
    expect(await repo.listEntries('2026-10', '2026-10')).toEqual([entry])
  })

  it('also checks evidence when a shortcut marks an existing entry paid through updateEntry', async () => {
    const { repo, entry } = await fixture()
    const saved = await repo.saveEntryReceipts(entry, images, 'sum')
    await expect(repo.updateEntry(saved.id, { amount: 99_900, paid: true })).rejects.toThrow(/ยอดหลักฐานไม่ตรง/)
    expect(await repo.listEntries('2026-10', '2026-10')).toEqual([saved])
    await repo.updateEntry(saved.id, { paid: true })
    expect((await repo.listEntries('2026-10', '2026-10'))[0].paid).toBe(true)
  })

  it('rejects a newly inserted paid bill with unmatched proof before persisting any part of a batch', async () => {
    const { repo, entry } = await fixture()
    const { id: _id, ...base } = entry
    await expect(repo.insertEntriesIfAbsent([
      { ...base, month: '2026-11', amount: 87_500, receipts: images, receiptMode: 'sum', paid: true },
      { ...base, month: '2026-12', amount: 99_900, receipts: images, receiptMode: 'sum', paid: true },
    ])).rejects.toThrow(/ยอดหลักฐานไม่ตรง/)
    expect(await repo.listEntries('2026-10', '2026-12')).toEqual([entry])
  })

  it('exempts a monthly income item from expense slip matching', async () => {
    const { repo } = await fixture()
    const income = await repo.saveItem({ name: 'เงินเดือน', kind: 'income', defaultAmount: 1_000_000, isEstimate: false, startMonth: '2026-10', endMonth: null, sort: 0, archived: false })
    await repo.insertEntriesIfAbsent([{ itemId: income.id, month: '2026-10', amount: income.defaultAmount, paid: false, note: null }])
    const entry = (await repo.listEntries('2026-10', '2026-10')).find((e) => e.itemId === income.id)!
    const saved = await repo.saveEntryReceipts(entry, images, 'sum', { paid: true })
    expect(saved).toMatchObject({ paid: true, amount: income.defaultAmount })
  })

  it('does not overwrite receipts when an older single-image client changes the legacy path', async () => {
    const { repo, entry } = await fixture()
    await repo.updateEntry(entry.id, { receiptPath: 'owner/new-legacy.jpg' })
    await expect(repo.saveEntryReceipts(entry, images)).rejects.toThrow(/เปลี่ยน.*โหลดใหม่/)
    const current = (await repo.listEntries('2026-10', '2026-10'))[0]
    const saved = await repo.saveEntryReceipts(current, images)
    await expect(repo.updateEntry(saved.id, { receiptPath: 'owner/wrong.jpg' })).rejects.toThrow(/หลักฐาน/)
    expect((await repo.listEntries('2026-10', '2026-10'))[0]).toEqual(saved)
  })

  it('leaves both stored and in-memory data intact when persisting new receipts exceeds quota', async () => {
    const backing = memoryKV()
    let reject = false
    const kv: KV = { getItem: backing.getItem, setItem(k, v) { if (reject) throw new Error('quota'); backing.setItem(k, v) } }
    const { repo, entry } = await fixture(kv)
    const before = backing.getItem('ledger-local-v1')
    reject = true
    await expect(repo.saveEntryReceipts(entry, images)).rejects.toThrow('quota')
    expect(backing.getItem('ledger-local-v1')).toBe(before)
    expect(await repo.listEntries('2026-10', '2026-10')).toEqual([entry])
  })

  it('validates paths, unique images, OCR satang and revisions before changing data', async () => {
    const { repo, entry } = await fixture()
    for (const receipts of [
      [{ path: '', ocrAmount: 1 }],
      [{ path: 'owner/a.jpg', ocrAmount: -1 }],
      [{ path: 'owner/a.jpg', ocrAmount: 1.5 }],
      [{ path: 'owner/a.jpg', ocrAmount: 1_000_000_000 }],
      [images[0], images[0]],
    ]) await expect(repo.saveEntryReceipts(entry, receipts)).rejects.toThrow()
    await expect(repo.saveEntryReceipts({ ...entry, receiptRevision: -1 }, images)).rejects.toThrow()
    expect(await repo.listEntries('2026-10', '2026-10')).toEqual([entry])
  })

  it('cleans all unique multi-image and legacy paths only after removing their bill', async () => {
    const { repo, slips, entry } = await fixture()
    for (const image of images) await slips.put(image.path, new Blob(['proof']))
    const saved = await repo.saveEntryReceipts(entry, images)
    const remove = vi.spyOn(slips, 'del').mockImplementation(async () => { expect(await repo.listEntries('2026-10', '2026-10')).toEqual([]) })
    expect(await repo.deleteEntries([saved.id])).toBeNull()
    expect(remove.mock.calls.map(([path]) => path).sort()).toEqual(images.map((r) => r.path).sort())
  })
})

function remoteFixture(options: { noRow?: boolean; error?: { code: string; message: string }; rows?: Record<string, unknown>[] } = {}) {
  const writes: Record<string, unknown>[] = []
  const filters: [string, unknown][] = []
  const remove = vi.fn().mockResolvedValue({ error: null })
  const base = { id: original.id, item_id: original.itemId, month: '2026-10-01', amount: '875.00', paid: false, note: original.note, receipt_path: original.receiptPath }
  let payload: Record<string, unknown> = {}
  const query = {
    update(row: Record<string, unknown>) { payload = row; writes.push(row); return query },
    select: () => query,
    eq(column: string, value: unknown) { filters.push([column, value]); return query },
    is(column: string, value: unknown) { filters.push([column, value]); return query },
    in: () => query,
    order: () => query,
    gte: () => query,
    lte: () => query,
    range: async () => ({ data: options.rows ?? [base], error: null, count: options.rows?.length ?? 1 }),
    maybeSingle: async () => ({ data: options.noRow ? null : { ...base, ...payload }, error: options.error ?? null }),
  }
  const sb = { from: () => ({ ...query, delete: () => ({ in: async () => ({ error: null }) }) }), storage: { from: () => ({ remove }) } }
  return { repo: new SupabaseRepo(sb as unknown as SupabaseClient), writes, filters, remove }
}

describe('Supabase multiple receipt adapter', () => {
  it('compares the expected revision, mirrors the first path and returns OCR amounts as satang', async () => {
    const { repo, writes, filters } = remoteFixture()
    const saved = await repo.saveEntryReceipts(original, images)
    expect(writes).toEqual([{ receipts: images, receipt_path: images[0].path, receipt_revision: 1, receipt_mode: null }])
    expect(filters).toEqual([['id', original.id], ['receipt_revision', 0], ['amount', '875.00'], ['paid', false], ['note', original.note]])
    expect(saved).toEqual({ ...original, receipts: images, receiptRevision: 1, receiptMode: null })
  })

  it('compares a null note using SQL IS NULL so unchanged empty notes can save', async () => {
    const { repo, filters } = remoteFixture()
    await repo.saveEntryReceipts({ ...original, note: null }, images)
    expect(filters).toContainEqual(['note', null])
  })

  it('sends the chosen check mode and payment with evidence in the same guarded update', async () => {
    const { repo, writes } = remoteFixture()
    const saved = await repo.saveEntryReceipts(original, images, 'sum', { amount: 87_500, paid: true, note: 'จ่ายแล้ว' })
    expect(writes).toEqual([{ receipts: images, receipt_path: images[0].path, receipt_revision: 1, receipt_mode: 'sum', amount: '875.00', paid: true, note: 'จ่ายแล้ว' }])
    expect(saved).toMatchObject({ receiptMode: 'sum', paid: true, amount: 87_500, note: 'จ่ายแล้ว' })
  })

  it('treats zero updated rows as a visible conflict or removed bill', async () => {
    const { repo } = remoteFixture({ noRow: true })
    await expect(repo.saveEntryReceipts(original, images)).rejects.toThrow(/เปลี่ยน.*โหลดใหม่/)
  })

  it.each(['PGRST204', '42703'])('reports an unapplied schema clearly for %s', async (code) => {
    const { repo } = remoteFixture({ error: { code, message: 'missing receipts column' } })
    await expect(repo.saveEntryReceipts(original, images)).rejects.toThrow(/อัปเดตฐานข้อมูล/)
  })

  it.each([
    ['receipt_payment_unreadable', 'ยังอ่านยอดหลักฐานไม่ได้'],
    ['receipt_payment_mode_required', 'เลือกวิธีตรวจยอดหลายสลิป'],
    ['receipt_payment_mismatch', 'ยอดหลักฐานไม่ตรงกับยอดบิล'],
    ['receipt_invalid_revision', 'โหลดใหม่'],
    ['receipt_first_path_mismatch', 'ข้อมูลรูปหลักฐานไม่ตรงกัน'],
    ['receipt_invalid_evidence', 'ข้อมูลหลักฐานไม่ถูกต้อง'],
    ['receipt_invalid_path', 'ข้อมูลรูปหลักฐานไม่ถูกต้อง'],
    ['receipt_invalid_amount', 'ยอดที่อ่านจากหลักฐานไม่ถูกต้อง'],
  ])('explains the database validation error %s in Thai', async (message, expected) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { repo } = remoteFixture({ error: { code: '23514', message } })
    await expect(repo.saveEntryReceipts(original, images)).rejects.toThrow(expected)
  })

  it('retains both new and legacy receipt representations when listing entries', async () => {
    const { repo } = remoteFixture({ rows: [
      { id: 'new', item_id: 'bill', month: '2026-10-01', amount: '875.00', paid: false, note: null, receipt_path: images[0].path, receipts: images, receipt_revision: 2 },
      { id: 'legacy', item_id: 'bill', month: '2026-11-01', amount: '999.00', paid: true, note: null, receipt_path: 'owner/legacy.jpg' },
    ] })
    const entries = await repo.listEntries('2026-10', '2026-11')
    expect(entries[0]).toMatchObject({ receipts: images, receiptRevision: 2, amount: 87_500 })
    expect(entries[1]).toMatchObject({ receiptPath: 'owner/legacy.jpg', amount: 99_900 })
    expect(entries[1].receipts).toBeUndefined()
  })

  it('deletes all distinct files in the new array and legacy reference', async () => {
    const { repo, remove } = remoteFixture({ rows: [
      { receipt_path: images[0].path, receipts: images },
      { receipt_path: 'owner/legacy.jpg', receipts: null },
    ] })
    await repo.deleteEntries(['new', 'legacy'])
    expect(remove.mock.calls.flatMap(([paths]) => paths).sort()).toEqual([...images.map((r) => r.path), 'owner/legacy.jpg'].sort())
  })

  it('rejects invalid receipt input without issuing a remote write', async () => {
    const { repo, writes } = remoteFixture()
    await expect(repo.saveEntryReceipts(original, [{ path: 'owner/a.jpg', ocrAmount: NaN }])).rejects.toThrow()
    expect(writes).toEqual([])
  })
})
