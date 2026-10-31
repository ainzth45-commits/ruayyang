// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../../data/localRepo'
import type { Auth } from '../../data/repo'
import type { Transaction } from '../../domain/types'
import { AppProvider } from '../store'
import { TxEditSheet } from './TxEditSheet'

const auth: Auth = {
  currentUser: async () => null,
  signIn: async () => ({ id: 'local', email: 'test@example.invalid' }),
  signOut: async () => {}, onChange: () => () => {},
}
beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:daily-slip'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function setup(withSlip: boolean, prepare?: (repo: LocalRepo) => void) {
  const repo = new LocalRepo(memoryKV(), memorySlipStore())
  const slipPath = withSlip ? await repo.uploadSlip(new Blob(['jpeg'], { type: 'image/jpeg' }), '2026-10') : null
  const tx: Transaction = { id: 'daily-tx', date: '2026-10-31', amount: 10_000, categoryId: null, note: null, slipPath, slipHash: null, ocrAmount: null, createdAt: '2026-10-31T02:00:00Z' }
  const lookup = vi.spyOn(repo, 'slipUrl')
  const update = vi.spyOn(repo, 'updateTransaction')
  const remove = vi.spyOn(repo, 'deleteTransaction')
  prepare?.(repo)
  const tree = (value: Transaction) => createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(TxEditSheet, { tx: value, categories: [], onClose: vi.fn() }) })
  const view = render(tree(tx))
  return { repo, tx, lookup, update, remove, view, tree }
}

describe('daily expense proof is immediately visible', () => {
  it('loads the slip automatically without a show button or data writes', async () => {
    const { lookup, tx, update, remove } = await setup(true)
    const image = await screen.findByAltText('สลิป')
    expect(image.getAttribute('src')).toBe('blob:daily-slip')
    expect(lookup).toHaveBeenCalledWith(tx.slipPath)
    expect(screen.queryByRole('button', { name: 'ดูรูปสลิป' })).toBeNull()
    expect(update).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
  it('does not request or display proof when there is no attached slip', async () => {
    const { lookup } = await setup(false)
    expect(screen.queryByAltText('สลิป')).toBeNull()
    expect(screen.queryByText('กำลังโหลดสลิป…')).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })
  it('shows a failed lookup visibly and retries automatically displaying its result', async () => {
    const { lookup } = await setup(true, (repo) => vi.mocked(repo.slipUrl).mockRejectedValueOnce(new Error('storage unavailable')))
    expect((await screen.findByRole('alert')).textContent).toContain('เปิดรูปสลิปไม่ได้')
    fireEvent.click(screen.getByRole('button', { name: 'โหลดสลิปอีกครั้ง' }))
    expect(await screen.findByAltText('สลิป')).toBeTruthy()
    expect(lookup).toHaveBeenCalledTimes(2)
  })
  it('reports an image decode error rather than leaving a broken hidden preview', async () => {
    await setup(true)
    fireEvent.error(await screen.findByAltText('สลิป'))
    expect(screen.getByRole('alert').textContent).toContain('เปิดรูปสลิปไม่ได้')
    expect(screen.queryByAltText('สลิป')).toBeNull()
    expect(screen.getByRole('button', { name: 'โหลดสลิปอีกครั้ง' })).toBeTruthy()
  })
  it('revokes an automatically created local preview on unmount', async () => {
    const { view } = await setup(true)
    await screen.findByAltText('สลิป')
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:daily-slip')
  })
  it('ignores an old pending lookup when the transaction has changed', async () => {
    let finish!: (url: string) => void
    const { view, tree, tx } = await setup(true, (repo) => vi.mocked(repo.slipUrl).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })))
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    view.rerender(tree({ ...tx, id: 'another-tx', slipPath: null }))
    finish('blob:stale-slip')
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stale-slip'))
    expect(screen.queryByAltText('สลิป')).toBeNull()
  })
})
