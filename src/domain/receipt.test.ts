import { describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../data/localRepo'
import { discardReceiptUploads, saveReceiptChanges, uploadReceipt, validateReceiptFile } from './receipt'

async function setup() {
  const slips = memorySlipStore()
  const repo = new LocalRepo(memoryKV(), slips)
  await repo.insertEntriesIfAbsent([{ itemId: 'bill', month: '2026-10', amount: 87_500, paid: false, note: null }])
  const [entry] = await repo.listEntries('2026-10', '2026-10')
  const image = new Blob(['receipt'], { type: 'image/jpeg' })
  return { repo, slips, entry, image }
}

describe('staged monthly bill receipts', () => {
  it('uploads one proof without changing money, paid or daily transactions before Save', async () => {
    const { repo, entry, image } = await setup()
    const proof = await uploadReceipt(repo, entry.month, image, 87_500)
    expect(proof).toMatchObject({ ocrAmount: 87_500 })
    expect((await repo.listEntries(entry.month, entry.month))[0]).toEqual(entry)
    expect(await repo.listTransactions('2000-01-01', '9999-12-31')).toEqual([])
    const { saved, warning } = await saveReceiptChanges(repo, entry, [proof], null, { paid: true, amount: 87_500 })
    expect(saved).toMatchObject({ paid: true, receipts: [proof], amount: 87_500 })
    expect(warning).toBeNull()
  })
  it('rejects a paid mismatch atomically and keeps uploaded drafts for retry', async () => {
    const { repo, entry, image, slips } = await setup()
    const proof = await uploadReceipt(repo, entry.month, image, 80_000)
    await expect(saveReceiptChanges(repo, entry, [proof], null, { paid: true })).rejects.toThrow('ยอด')
    expect((await repo.listEntries(entry.month, entry.month))[0]).toEqual(entry)
    expect(await slips.get(proof.path)).toBe(image)
    const { saved } = await saveReceiptChanges(repo, entry, [proof], null, { paid: true, amount: 80_000 })
    expect(saved.amount).toBe(80_000)
  })
  it('only deletes replaced images after the updated bill saves', async () => {
    const { repo, entry, image, slips } = await setup()
    const old = await uploadReceipt(repo, entry.month, image, 87_500)
    const { saved: base } = await saveReceiptChanges(repo, entry, [old], null, {})
    const next = await uploadReceipt(repo, entry.month, image, 87_500)
    const remove = vi.spyOn(repo, 'deleteSlip')
    vi.spyOn(repo, 'saveEntryReceipts').mockRejectedValueOnce(new Error('quota'))
    await expect(saveReceiptChanges(repo, base, [next], null, {})).rejects.toThrow('quota')
    expect(remove).not.toHaveBeenCalled()
    await saveReceiptChanges(repo, base, [next], null, {})
    expect(await slips.get(old.path)).toBeNull()
    expect(await slips.get(next.path)).toBe(image)
  })
  it('reports cleanup failure after a successful save', async () => {
    const { repo, entry, image } = await setup()
    const old = await uploadReceipt(repo, entry.month, image, null)
    const { saved } = await saveReceiptChanges(repo, entry, [old], null, {})
    vi.spyOn(repo, 'deleteSlip').mockRejectedValue(new Error('offline'))
    const result = await saveReceiptChanges(repo, saved, [], null, {})
    expect(result.saved.receipts).toEqual([])
    expect(result.warning).toContain('ลบ')
  })
  it('discard cleanup rechecks stored references so a save with a lost response does not delete a saved image', async () => {
    const { repo, entry, image, slips } = await setup()
    const savedProof = await uploadReceipt(repo, entry.month, image, null)
    const unused = await uploadReceipt(repo, entry.month, image, null)
    await saveReceiptChanges(repo, entry, [savedProof], null, {})
    expect(await discardReceiptUploads(repo, entry, [savedProof.path, unused.path])).toBeNull()
    expect(await slips.get(savedProof.path)).toBe(image)
    expect(await slips.get(unused.path)).toBeNull()
  })
  it('does not risk deleting drafts when stored references cannot be checked', async () => {
    const { repo, entry } = await setup()
    vi.spyOn(repo, 'listEntries').mockRejectedValue(new Error('offline'))
    const remove = vi.spyOn(repo, 'deleteSlip')
    expect(await discardReceiptUploads(repo, entry, ['unknown'])).toContain('ตรวจสอบ')
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('receipt file validation', () => {
  it('accepts image types and iPhone HEIC with missing MIME', () => {
    expect(() => validateReceiptFile({ name: 'slip.png', type: 'image/png', size: 200 })).not.toThrow()
    expect(() => validateReceiptFile({ name: 'IMG_1.HEIC', type: '', size: 200 })).not.toThrow()
  })
  it('rejects empty, non-image and oversized files before upload', async () => {
    expect(() => validateReceiptFile({ name: 'slip.png', type: 'image/png', size: 0 })).toThrow('ไฟล์ว่าง')
    expect(() => validateReceiptFile({ name: 'bill.pdf', type: 'application/pdf', size: 100 })).toThrow('รูปภาพ')
    expect(() => validateReceiptFile({ name: 'slip.png', type: 'image/png', size: 15 * 1024 * 1024 + 1 })).toThrow('15 MB')
    const { repo, entry } = await setup()
    const upload = vi.spyOn(repo, 'uploadSlip')
    await expect(uploadReceipt(repo, entry.month, new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/jpeg' }), null)).rejects.toThrow('2 MB')
    await expect(uploadReceipt(repo, entry.month, new Blob(['x'], { type: 'text/plain' }), null)).rejects.toThrow('JPEG')
    expect(upload).not.toHaveBeenCalled()
  })
})
