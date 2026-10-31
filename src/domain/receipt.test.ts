import { describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../data/localRepo'
import { attachReceipt, detachReceipt, validateReceiptFile } from './receipt'

async function setup(withReceipt = false) {
  const slips = memorySlipStore()
  const repo = new LocalRepo(memoryKV(), slips)
  await repo.insertEntriesIfAbsent([{ itemId: 'bill', month: '2026-10', amount: 250_000, paid: true, note: null }])
  const [entry] = await repo.listEntries('2026-10', '2026-10')
  const image = new Blob(['receipt'], { type: 'image/jpeg' })
  if (withReceipt) {
    entry.receiptPath = await repo.uploadSlip(image, entry.month)
    await repo.updateEntry(entry.id, { receiptPath: entry.receiptPath })
  }
  return { repo, slips, entry, image }
}

describe('monthly bill receipts', () => {
  it('attaches proof to an already paid bill without changing payment or adding a daily transaction', async () => {
    const { repo, slips, entry, image } = await setup()
    const result = await attachReceipt(repo, entry, image)
    expect(result.warning).toBeNull()
    expect(result.receiptPath).toContain('local/2026-10/')
    expect(await slips.get(result.receiptPath!)).toBe(image)
    expect((await repo.listEntries('2026-10', '2026-10'))[0]).toEqual({ ...entry, receiptPath: result.receiptPath })
    expect(await repo.listTransactions('2000-01-01', '9999-12-31')).toEqual([])
  })

  it('replaces proof only after the new path is saved, then removes the old image', async () => {
    const { repo, slips, entry, image } = await setup(true)
    const result = await attachReceipt(repo, entry, image)
    expect(result.receiptPath).not.toBe(entry.receiptPath)
    expect(await slips.get(entry.receiptPath!)).toBeNull()
    expect(await slips.get(result.receiptPath!)).toBe(image)
  })

  it('rolls back the new upload when saving fails and retains the previous proof', async () => {
    const { repo, slips, entry, image } = await setup(true)
    const upload = vi.spyOn(repo, 'uploadSlip')
    vi.spyOn(repo, 'updateEntry').mockRejectedValueOnce(new Error('บันทึกบิลไม่สำเร็จ'))
    await expect(attachReceipt(repo, entry, image)).rejects.toThrow('บันทึกบิลไม่สำเร็จ')
    const path = await upload.mock.results[0].value
    expect(await slips.get(path)).toBeNull()
    expect(await slips.get(entry.receiptPath!)).toBe(image)
    expect((await repo.listEntries('2026-10', '2026-10'))[0].receiptPath).toBe(entry.receiptPath)
  })

  it('retains the old proof and bill if uploading is unavailable', async () => {
    const { repo, slips, entry, image } = await setup(true)
    vi.spyOn(repo, 'uploadSlip').mockRejectedValueOnce(new Error('อัปโหลดไม่ได้'))
    const update = vi.spyOn(repo, 'updateEntry')
    const remove = vi.spyOn(repo, 'deleteSlip')
    await expect(attachReceipt(repo, entry, image)).rejects.toThrow('อัปโหลดไม่ได้')
    expect(update).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(await slips.get(entry.receiptPath!)).toBe(image)
  })

  it('reports failed rollback cleanup instead of hiding the orphaned upload', async () => {
    const { repo, entry, image } = await setup()
    vi.spyOn(repo, 'updateEntry').mockRejectedValueOnce(new Error('บันทึกบิลไม่สำเร็จ'))
    vi.spyOn(repo, 'deleteSlip').mockRejectedValueOnce(new Error('storage offline'))
    await expect(attachReceipt(repo, entry, image)).rejects.toThrow('ล้างรูปที่อัปโหลดใหม่ไม่สำเร็จ')
  })

  it('returns the successfully saved path with a warning if old-image cleanup fails', async () => {
    const { repo, entry, image } = await setup(true)
    vi.spyOn(repo, 'deleteSlip').mockRejectedValueOnce(new Error('storage offline'))
    const result = await attachReceipt(repo, entry, image)
    expect(result.warning).toContain('ลบรูปเก่าไม่สำเร็จ')
    expect((await repo.listEntries('2026-10', '2026-10'))[0].receiptPath).toBe(result.receiptPath)
  })

  it('detaches proof without deleting or marking the bill unpaid', async () => {
    const { repo, slips, entry } = await setup(true)
    const result = await detachReceipt(repo, entry)
    expect(result).toEqual({ receiptPath: null, warning: null })
    expect(await slips.get(entry.receiptPath!)).toBeNull()
    expect((await repo.listEntries('2026-10', '2026-10'))[0]).toMatchObject({ paid: true, amount: entry.amount, receiptPath: null })
  })

  it('does not delete a referenced image if detaching the entry fails', async () => {
    const { repo, slips, entry, image } = await setup(true)
    vi.spyOn(repo, 'updateEntry').mockRejectedValueOnce(new Error('บันทึกไม่สำเร็จ'))
    await expect(detachReceipt(repo, entry)).rejects.toThrow('บันทึกไม่สำเร็จ')
    expect(await slips.get(entry.receiptPath!)).toBe(image)
  })

  it('reports detached proof cleanup failure and handles missing proof without writes', async () => {
    const { repo, entry } = await setup(true)
    vi.spyOn(repo, 'deleteSlip').mockRejectedValueOnce(new Error('storage offline'))
    expect((await detachReceipt(repo, entry)).warning).toContain('ลบไฟล์รูปไม่สำเร็จ')
    const update = vi.spyOn(repo, 'updateEntry')
    update.mockClear()
    expect(await detachReceipt(repo, { ...entry, receiptPath: null })).toEqual({ receiptPath: null, warning: null })
    expect(update).not.toHaveBeenCalled()
  })

  it('does not leave uploads behind when the bill no longer exists', async () => {
    const { repo, entry, image } = await setup()
    await repo.deleteEntries([entry.id])
    const remove = vi.spyOn(repo, 'deleteSlip')
    await expect(attachReceipt(repo, entry, image)).rejects.toThrow('ไม่พบ')
    expect(remove).toHaveBeenCalledOnce()
  })
})

describe('receipt file validation', () => {
  it('accepts image types and iPhone HEIC files with a missing MIME type', () => {
    expect(() => validateReceiptFile({ name: 'slip.png', type: 'image/png', size: 200 })).not.toThrow()
    expect(() => validateReceiptFile({ name: 'IMG_1.HEIC', type: '', size: 200 })).not.toThrow()
  })

  it('rejects empty, non-image, oversized original and compressed images before upload', async () => {
    expect(() => validateReceiptFile({ name: 'slip.png', type: 'image/png', size: 0 })).toThrow('ไฟล์ว่าง')
    expect(() => validateReceiptFile({ name: 'bill.pdf', type: 'application/pdf', size: 100 })).toThrow('รูปภาพ')
    expect(() => validateReceiptFile({ name: 'slip.png', type: 'image/png', size: 15 * 1024 * 1024 + 1 })).toThrow('15 MB')
    const { repo, entry } = await setup()
    const upload = vi.spyOn(repo, 'uploadSlip')
    await expect(attachReceipt(repo, entry, new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/jpeg' }))).rejects.toThrow('2 MB')
    await expect(attachReceipt(repo, entry, new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow('JPEG')
    expect(upload).not.toHaveBeenCalled()
  })
})
