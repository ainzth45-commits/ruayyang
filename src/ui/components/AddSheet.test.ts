// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { LocalRepo, memoryKV, memorySlipStore } from '../../data/localRepo'
import { AppProvider } from '../store'
import { AddSheet } from './AddSheet'
import { TxEditSheet } from './TxEditSheet'

vi.mock('../../ocr/ocr', () => ({
  warmUpOcr: vi.fn(),
  readSlipAmount: vi.fn(() => new Promise(() => {})),
}))
vi.mock('../../ocr/image', () => ({
  sha256Hex: vi.fn(async () => 'slip-hash'),
  compressImage: vi.fn(async (file: File) => file),
}))

const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }

function open(repo: LocalRepo, onClose = vi.fn()) {
  render(createElement(AppProvider, {
    repo, auth, user: { id: 'local', email: 'test@example.invalid' },
    children: createElement(AddSheet, { onClose }),
  }))
  return onClose
}

const pinnedSave = () => document.querySelector<HTMLButtonElement>('.sheet-footer button[type=submit]')

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('+ sheet keeps save pinned below the scrolling form', () => {
  it('renders save outside the scroll area so it can never cover a field', async () => {
    open(new LocalRepo(memoryKV(), memorySlipStore()))
    await screen.findByLabelText('จำนวนเงิน')
    await waitFor(() => expect(pinnedSave()).not.toBeNull())
    expect(document.querySelector('.sheet-body button[type=submit]')).toBeNull()
    expect(document.querySelector('.sheet-body')?.contains(pinnedSave())).toBe(false)
    expect(document.querySelectorAll('button[type=submit]')).toHaveLength(1)
  })

  it('still submits the form from the pinned button', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    const category = await repo.saveCategory({ name: 'อาหาร', icon: 'utensils', sort: 0, archived: false })
    const onClose = open(repo)
    fireEvent.change(await screen.findByLabelText('จำนวนเงิน'), { target: { value: '125.50' } })
    fireEvent.click(await screen.findByRole('button', { name: 'อาหาร' }))
    await waitFor(() => expect(pinnedSave()?.disabled).toBe(false))
    fireEvent.click(pinnedSave()!)
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    const saved = await repo.listTransactions('2000-01-01', '2999-12-31')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ amount: 12_550, categoryId: category.id })
  })

  it('keeps save disabled until the form is valid', async () => {
    open(new LocalRepo(memoryKV(), memorySlipStore()))
    await screen.findByLabelText('จำนวนเงิน')
    await waitFor(() => expect(pinnedSave()).not.toBeNull())
    expect(pinnedSave()!.disabled).toBe(true)
  })

  it('shows no save button while the slip is still being read', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:slip', revokeObjectURL: () => {} }))
    open(new LocalRepo(memoryKV(), memorySlipStore()))
    await screen.findByLabelText('จำนวนเงิน')
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!
    fireEvent.change(input, { target: { files: [new File(['x'], 'slip.png', { type: 'image/png' })] } })
    await screen.findByText('กำลังอ่านยอด')
    expect(document.querySelector('.sheet-footer')?.childElementCount).toBe(0)
    expect(document.querySelectorAll('button[type=submit]')).toHaveLength(0)
  })

  it('leaves the edit sheet save button in the normal form flow', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    const category = await repo.saveCategory({ name: 'อาหาร', icon: 'utensils', sort: 0, archived: false })
    const tx = await repo.addTransaction({ amount: 10_000, date: '2026-10-31', categoryId: category.id, note: null, slipPath: null, slipHash: null, ocrAmount: null })
    render(createElement(AppProvider, {
      repo, auth, user: { id: 'local', email: 'test@example.invalid' },
      children: createElement(TxEditSheet, { tx, categories: [category], onClose: vi.fn() }),
    }))
    const save = await screen.findByRole('button', { name: 'บันทึกการแก้ไข' })
    expect(save.closest('.sheet-body form')).not.toBeNull()
    expect(document.querySelector('.sheet-footer')).toBeNull()
  })

  it('reserves the iPhone home-indicator area under the pinned button', () => {
    const css = readFileSync('src/ui/styles/app.css', 'utf8')
    expect(css).toMatch(/\.sheet-footer\s*\{[^}]*flex:\s*none/)
    expect(css).toMatch(/\.sheet-footer\s*\{[^}]*padding:[^;}]*var\(--safe-b\)/)
    expect(css).not.toMatch(/\.sheet-footer[^}]*position:\s*sticky/)
  })

  it('gives the form the space back on a landscape phone while the keyboard is open', () => {
    const css = readFileSync('src/ui/styles/app.css', 'utf8')
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 540px\)\s*\{\s*html\.kb-open \.sheet-footer\s*\{\s*display:\s*none/)
  })
})
