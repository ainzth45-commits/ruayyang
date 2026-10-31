// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../../data/localRepo'
import { AppProvider } from '../store'
import { Settings } from './Settings'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function setup() {
  const repo = new LocalRepo(memoryKV(), memorySlipStore())
  const item = await repo.saveItem({ name: 'ค่าไฟทดสอบ', kind: 'expense', defaultAmount: 99_900, isEstimate: true, startMonth: '2026-10', endMonth: null, sort: 0, archived: false })
  await repo.insertEntriesIfAbsent([
    { itemId: item.id, month: '2026-10', amount: 10_000, paid: true, note: null },
    { itemId: item.id, month: '2026-11', amount: 25_000, paid: false, note: null },
  ])
  const update = vi.spyOn(repo, 'updateEntry')
  const saveItem = vi.spyOn(repo, 'saveItem')
  const create = vi.spyOn(repo, 'insertEntriesIfAbsent')
  const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }
  render(createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(Settings) }))
  return { repo, item, update, saveItem, create }
}

describe('monthly recurring amounts live in settings', () => {
  it('shows recorded months and edits only the chosen month while retaining unsaved template fields', async () => {
    const { repo, item, update, saveItem, create } = await setup()
    fireEvent.click(await screen.findByRole('button', { name: /ค่าไฟทดสอบ/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อรายการ' }), { target: { value: 'ค่าไฟแก้ค้างไว้' } })
    fireEvent.click(screen.getByRole('button', { name: 'ยอดรายการนี้แต่ละเดือน' }))
    const history = await screen.findByRole('region', { name: 'ยอดรายการนี้แต่ละเดือน' })
    expect(within(history).getByText('100.00')).toBeTruthy()
    expect(within(history).getByText('250.00')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
    expect(saveItem).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    fireEvent.click(within(history).getByRole('button', { name: /พ.ย. 2026/ }))
    const editor = screen.getByRole('dialog', { name: 'ค่าไฟทดสอบ' })
    expect((within(editor).getByRole('textbox', { name: 'ยอด' }) as HTMLInputElement).value).toBe('250.00')
    fireEvent.change(within(editor).getByRole('textbox', { name: 'ยอด' }), { target: { value: '275' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'บันทึก' }))
    const updatedHistory = await screen.findByRole('region', { name: 'ยอดรายการนี้แต่ละเดือน' })
    expect(await within(updatedHistory).findByText('275.00')).toBeTruthy()
    const entries = await repo.listEntries('2026-10', '2026-11')
    expect(entries.find((e) => e.month === '2026-10')).toMatchObject({ amount: 10_000, paid: true })
    const november = entries.find((e) => e.month === '2026-11')!
    expect(november).toMatchObject({ amount: 27_500, paid: false })
    expect(update).toHaveBeenCalledWith(november.id, expect.objectContaining({ amount: 27_500 }))
    expect((await repo.listItems()).find((i) => i.id === item.id)).toMatchObject({ name: 'ค่าไฟทดสอบ', defaultAmount: 99_900 })
    expect(saveItem).not.toHaveBeenCalled()
    // Reopening another month resets the editor amount, then returning retains draft settings.
    fireEvent.click(within(updatedHistory).getByRole('button', { name: /ต.ค. 2026/ }))
    expect((screen.getByRole('textbox', { name: 'ยอด' }) as HTMLInputElement).value).toBe('100.00')
    fireEvent.keyDown(window, { key: 'Escape' })
    await screen.findByRole('region', { name: 'ยอดรายการนี้แต่ละเดือน' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'ชื่อรายการ' }) as HTMLInputElement).value).toBe('ค่าไฟแก้ค้างไว้'))
  })

  it('does not offer recorded month history for a new unsaved recurring item', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายการประจำ' }))
    expect(screen.getByRole('dialog', { name: 'เพิ่มรายการประจำ' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'ยอดรายการนี้แต่ละเดือน' })).toBeNull()
  })
})
