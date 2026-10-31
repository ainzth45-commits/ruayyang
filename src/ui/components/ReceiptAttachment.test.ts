// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../../data/localRepo'
import { AppProvider } from '../store'
import { EntrySheet } from './EntrySheet'
import { compressImage } from '../../ocr/image'
import { readSlipAmount } from '../../ocr/ocr'

vi.mock('../../ocr/image', () => ({ compressImage: vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' })) }))
vi.mock('../../ocr/ocr', () => ({ readSlipAmount: vi.fn(async () => ({ amount: 87_500, date: null, text: '' })) }))
vi.mock('../sound', () => ({ play: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(compressImage).mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }))
  vi.mocked(readSlipAmount).mockResolvedValue({ amount: 87_500, date: null, text: '' })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:proof'), revokeObjectURL: vi.fn() }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['old'], { type: 'image/jpeg' }) })))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function setup(withReceipt = false) {
  const repo = new LocalRepo(memoryKV(), memorySlipStore())
  const item = await repo.saveItem({ name: 'บิลทดสอบ', kind: 'expense', defaultAmount: 87_500, isEstimate: false, startMonth: '2026-10', endMonth: null, sort: 0, archived: false })
  await repo.insertEntriesIfAbsent([{ itemId: item.id, month: '2026-10', amount: 87_500, paid: false, note: null }])
  let [entry] = await repo.listEntries('2026-10', '2026-10')
  if (withReceipt) {
    await repo.updateEntry(entry.id, { receiptPath: await repo.uploadSlip(new Blob(['old'], { type: 'image/jpeg' }), entry.month) })
    ;[entry] = await repo.listEntries(entry.month, entry.month)
  }
  const update = vi.spyOn(repo, 'updateEntry')
  const saveProof = vi.spyOn(repo, 'saveEntryReceipts')
  const onClose = vi.fn()
  const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }
  const view = render(createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(EntrySheet, { entry, item, onClose }) }))
  return { repo, entry, update, saveProof, onClose, view }
}
function choose(file = new File(['image'], 'slip.jpg', { type: 'image/jpeg' })) {
  fireEvent.change(screen.getByLabelText('เลือกรูปหลักฐานการชำระ'), { target: { files: [file] } })
}
async function attached(count = 1) {
  await waitFor(() => expect(screen.getAllByAltText(/หลักฐานการชำระบิล/)).toHaveLength(1))
  if (count > 1) await waitFor(() => expect(screen.getAllByRole('button', { name: /เลือกรูปหลักฐานที่/ })).toHaveLength(count))
  await waitFor(() => expect(screen.queryByText(/กำลังอ่านยอด/)).toBeNull())
}

describe('monthly proof and payment flow', () => {
  it('shows existing proof immediately and offers another single-image attachment', async () => {
    const { update, saveProof } = await setup(true)
    await attached()
    expect(screen.getByRole('button', { name: 'แนบหลักฐานเพิ่ม' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'ดูหลักฐาน' })).toBeNull()
    expect((screen.getByLabelText('เลือกรูปหลักฐานการชำระ') as HTMLInputElement).multiple).toBe(false)
    expect(update).not.toHaveBeenCalled()
    expect(saveProof).not.toHaveBeenCalled()
  })
  it('appends two proofs individually, reads OCR and saves split payment atomically', async () => {
    vi.mocked(readSlipAmount).mockResolvedValueOnce({ amount: 45_000, date: null, text: '' }).mockResolvedValueOnce({ amount: 42_500, date: null, text: '' })
    const { repo, entry, saveProof, onClose } = await setup()
    choose(); await attached()
    expect(screen.getByRole('button', { name: 'แนบหลักฐานเพิ่ม' })).toBeTruthy()
    choose(new File(['second'], 'second.jpg', { type: 'image/jpeg' })); await attached(2)
    expect(screen.getByAltText('หลักฐานการชำระบิล 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'เลือกรูปหลักฐานที่ 1' }))
    expect(await screen.findByAltText('หลักฐานการชำระบิล 1')).toBeTruthy()
    expect(readSlipAmount).toHaveBeenCalledTimes(2)
    expect((await repo.listEntries(entry.month, entry.month))[0]).toEqual(entry)
    fireEvent.click(screen.getByRole('switch', { name: 'จ่ายแล้ว' }))
    expect((screen.getByRole('button', { name: 'บันทึก' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /แบ่งจ่าย/ }))
    expect(screen.getByText('ยอดหลักฐานตรงกับยอดบิล')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(saveProof).toHaveBeenCalledTimes(1)
    expect((await repo.listEntries(entry.month, entry.month))[0]).toMatchObject({ amount: 87_500, paid: true, receiptMode: 'sum', receipts: [{ ocrAmount: 45_000 }, { ocrAmount: 42_500 }] })
  })
  it('blocks paid mismatch until the user explicitly accepts changing the bill amount', async () => {
    vi.mocked(readSlipAmount).mockResolvedValue({ amount: 90_000, date: null, text: '' })
    const { repo, entry, onClose } = await setup()
    choose(); await attached()
    fireEvent.click(screen.getByRole('switch', { name: 'จ่ายแล้ว' }))
    expect(screen.getByText(/ยอดหลักฐานไม่ตรงกับยอดบิล/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'บันทึก' }) as HTMLButtonElement).disabled).toBe(true)
    expect((await repo.listEntries(entry.month, entry.month))[0].amount).toBe(87_500)
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนยอดบิลเป็น 900.00 บาท' }))
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect((await repo.listEntries(entry.month, entry.month))[0]).toMatchObject({ amount: 90_000, paid: true })
  })
  it('does not mark an unreadable slip paid and allows OCR retry', async () => {
    vi.mocked(readSlipAmount).mockResolvedValueOnce({ amount: null, date: null, text: '' })
    await setup(); choose(); await attached()
    fireEvent.click(screen.getByRole('switch', { name: 'จ่ายแล้ว' }))
    expect(screen.getByText(/ยังอ่านยอดหลักฐานไม่ได้/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'บันทึก' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'อ่านยอดรูปที่ 1 ใหม่' }))
    await screen.findByText('ยอดหลักฐานตรงกับยอดบิล')
    expect((screen.getByRole('button', { name: 'บันทึก' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('supports multiple proofs of the same payment without adding their amounts', async () => {
    const { repo, entry, onClose } = await setup()
    choose(); await attached(); choose(); await attached(2)
    fireEvent.click(screen.getByRole('radio', { name: /หลักฐานยอดเดียวกัน/ }))
    fireEvent.click(screen.getByRole('switch', { name: 'จ่ายแล้ว' }))
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect((await repo.listEntries(entry.month, entry.month))[0]).toMatchObject({ amount: 87_500, paid: true, receiptMode: 'each' })
  })
  it('keeps the original evidence while replacing/removing only the selected draft until Save', async () => {
    const { repo, entry } = await setup(true)
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนรูปที่ 1' })); choose(); await attached()
    expect((await repo.listEntries(entry.month, entry.month))[0].receiptPath).toBe(entry.receiptPath)
    fireEvent.click(screen.getByRole('button', { name: 'ถอดรูปที่ 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันถอดรูปที่ 1' }))
    expect(screen.queryByAltText(/หลักฐานการชำระบิล/)).toBeNull()
    expect((await repo.listEntries(entry.month, entry.month))[0].receiptPath).toBe(entry.receiptPath)
  })
  it('rejects invalid files before compression, OCR and upload', async () => {
    const { repo } = await setup()
    const upload = vi.spyOn(repo, 'uploadSlip')
    choose(new File(['pdf'], 'bill.pdf', { type: 'application/pdf' }))
    expect(screen.getByRole('alert').textContent).toContain('รูปภาพ')
    expect(compressImage).not.toHaveBeenCalled(); expect(readSlipAmount).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled()
  })
  it('shows upload failure and prevents a second upload while the first image is processing', async () => {
    const { repo } = await setup()
    vi.spyOn(repo, 'uploadSlip').mockRejectedValueOnce(new Error('อัปโหลดไม่ได้'))
    let finish!: (blob: Blob) => void
    vi.mocked(compressImage).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    choose(); choose()
    expect(compressImage).toHaveBeenCalledTimes(1)
    finish(new Blob(['jpeg'], { type: 'image/jpeg' }))
    expect((await screen.findByRole('alert')).textContent).toContain('อัปโหลดไม่ได้')
  })
  it('retains the draft and shows a payment save error for retry without claiming success', async () => {
    const { repo, onClose } = await setup()
    choose(); await attached()
    vi.spyOn(repo, 'saveEntryReceipts').mockRejectedValueOnce(new Error('บันทึกบิลไม่สำเร็จ'))
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await screen.findByText('บันทึกบิลไม่สำเร็จ')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByAltText(/หลักฐานการชำระบิล/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
  it('revokes previews and removes only unsaved uploaded drafts when closed', async () => {
    const { repo, entry, view } = await setup()
    choose(); await attached()
    const remove = vi.spyOn(repo, 'deleteSlip')
    view.unmount()
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:proof')
    expect((await repo.listEntries(entry.month, entry.month))[0]).toEqual(entry)
  })
  it('keeps a saved proof when the sheet unmounts during an outstanding save', async () => {
    const { repo, entry, view } = await setup()
    choose(); await attached()
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const realSave = repo.saveEntryReceipts.bind(repo)
    vi.mocked(repo.saveEntryReceipts).mockImplementationOnce(async (...args) => { await pending; return realSave(...args) })
    const remove = vi.spyOn(repo, 'deleteSlip')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    view.unmount()
    expect(remove).not.toHaveBeenCalled()
    await act(async () => { finish(); await pending })
    await waitFor(async () => expect((await repo.listEntries(entry.month, entry.month))[0].receipts).toHaveLength(1))
    expect(remove).not.toHaveBeenCalled()
  })
  it('keeps a cleanup warning visible after an otherwise successful payment save', async () => {
    const { repo } = await setup(true)
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนรูปที่ 1' })); choose(); await attached()
    vi.spyOn(repo, 'deleteSlip').mockRejectedValueOnce(new Error('storage offline'))
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(await screen.findByText('บันทึกบิลแล้ว แต่ลบรูปหลักฐานเก่าบางรูปไม่สำเร็จ')).toBeTruthy()
  })
  it('shows a failed preview and lets the user retry without hiding proof errors', async () => {
    await setup(true); await attached()
    fireEvent.error(screen.getByAltText('หลักฐานการชำระบิล 1'))
    expect(screen.getByRole('button', { name: 'โหลดหลักฐานอีกครั้ง' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'โหลดหลักฐานอีกครั้ง' }))
    expect(await screen.findByAltText('หลักฐานการชำระบิล 1')).toBeTruthy()
  })
})
