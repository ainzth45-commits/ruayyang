// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../../data/localRepo'
import type { Auth } from '../../data/repo'
import { AppProvider } from '../store'
import { ReceiptAttachment } from './ReceiptAttachment'
import { compressImage } from '../../ocr/image'

vi.mock('../../ocr/image', () => ({ compressImage: vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' })) }))
vi.mock('../sound', () => ({ play: vi.fn() }))

const auth: Auth = {
  currentUser: async () => null,
  signIn: async () => ({ id: 'u', email: 'user@example.test' }),
  signOut: async () => {},
  onChange: () => () => {},
}

async function setup(withReceipt = false) {
  const repo = new LocalRepo(memoryKV(), memorySlipStore())
  await repo.insertEntriesIfAbsent([{ itemId: 'bill', month: '2026-10', amount: 100_000, paid: true, note: null }])
  const [entry] = await repo.listEntries('2026-10', '2026-10')
  if (withReceipt) {
    entry.receiptPath = await repo.uploadSlip(new Blob(['old'], { type: 'image/jpeg' }), entry.month)
    await repo.updateEntry(entry.id, { receiptPath: entry.receiptPath })
  }
  const view = render(createElement(AppProvider, { repo, auth, user: { id: 'u', email: 'user@example.test' }, children: createElement(ReceiptAttachment, { entry }) }))
  return { repo, entry, view }
}

function choose(file = new File(['image'], 'slip.png', { type: 'image/png' })) {
  fireEvent.change(screen.getByLabelText('เลือกรูปหลักฐานการชำระ'), { target: { files: [file] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test-proof'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ReceiptAttachment', () => {
  it('keeps the latest saved path when parent entry props remain unchanged', async () => {
    const { repo } = await setup()
    choose()
    await waitFor(() => expect(screen.getByRole('button', { name: 'เปลี่ยนรูปหลักฐาน' })).toBeTruthy())
    const first = (await repo.listEntries('2026-10', '2026-10'))[0].receiptPath
    const remove = vi.spyOn(repo, 'deleteSlip')
    choose()
    await waitFor(() => expect(remove).toHaveBeenCalledWith(first))
    const latest = (await repo.listEntries('2026-10', '2026-10'))[0].receiptPath
    expect(latest).not.toBe(first)
    fireEvent.click(screen.getByRole('button', { name: 'ถอดหลักฐาน' }))
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันถอดหลักฐาน' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(latest))
    expect((await repo.listEntries('2026-10', '2026-10'))[0]).toMatchObject({ paid: true, receiptPath: null })
    expect(await repo.listTransactions('2000-01-01', '9999-12-31')).toEqual([])
  })

  it('rejects invalid originals visibly before compression or upload', async () => {
    const { repo } = await setup()
    const upload = vi.spyOn(repo, 'uploadSlip')
    choose(new File(['pdf'], 'bill.pdf', { type: 'application/pdf' }))
    expect(screen.getByRole('alert').textContent).toContain('รูปภาพ')
    expect(compressImage).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('keeps old proof available and shows save errors inline', async () => {
    const { repo } = await setup(true)
    vi.spyOn(repo, 'updateEntry').mockRejectedValueOnce(new Error('บันทึกหลักฐานไม่สำเร็จ'))
    choose()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('บันทึกหลักฐานไม่สำเร็จ'))
    expect(screen.getByRole('button', { name: 'ดูหลักฐาน' })).toBeTruthy()
  })

  it('prevents a second upload while image compression is pending and reports decode failure', async () => {
    const { repo } = await setup()
    let rejectDecode: (error: Error) => void = () => {}
    vi.mocked(compressImage).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDecode = reject }))
    const upload = vi.spyOn(repo, 'uploadSlip')
    choose()
    choose()
    expect(compressImage).toHaveBeenCalledOnce()
    rejectDecode(new Error('เปิดรูปนี้ไม่ได้'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('เปิดรูปนี้ไม่ได้'))
    expect(upload).not.toHaveBeenCalled()
  })

  it('revokes local proof previews when closing and on unmount', async () => {
    const { view } = await setup(true)
    fireEvent.click(screen.getByRole('button', { name: 'ดูหลักฐาน' }))
    await waitFor(() => expect(screen.getByAltText('หลักฐานการชำระบิล')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนหลักฐาน' }))
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-proof'))
    fireEvent.click(screen.getByRole('button', { name: 'ดูหลักฐาน' }))
    await waitFor(() => expect(screen.getByAltText('หลักฐานการชำระบิล')).toBeTruthy())
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
