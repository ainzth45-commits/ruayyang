// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../data/localRepo'
import { AppProvider } from './store'
import { TxForm } from './components/TxForm'

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-31T03:00:00Z')) })
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('daily expense confirms cash cycle while keeping calendar date', () => {
  it('lets an earlier same-day expense use the old cycle without changing the date', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await repo.setActualBalance('2026-09', 900_000)
    await repo.setMonthClosed('2026-09', '2026-09-30T02:00:00Z')
    await repo.setActualBalance('2026-10', 800_000)
    await repo.setMonthClosed('2026-10', '2026-10-31T02:19:00Z')
    const submit = vi.fn()
    const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }
    render(createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(TxForm, {
      categories: [{ id: 'food', name: 'อาหาร', icon: 'utensils', sort: 0, archived: false }],
      initial: { amount: 10_000, date: '2026-10-31', categoryId: 'food', note: null }, busy: false, submitLabel: 'บันทึก', onSubmit: submit,
    }) }))
    const cycle = await screen.findByRole('combobox', { name: 'หักจากเงินรอบ' })
    expect((cycle as HTMLSelectElement).value).toBe('2026-10')
    fireEvent.change(cycle, { target: { value: '2026-09' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-31', cycleMonth: '2026-09', amount: 10_000 }))
  })
  it('can correct an existing old-cycle entry to the newly opened same-day cycle', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await repo.setActualBalance('2026-10', 800_000)
    await repo.setMonthClosed('2026-10', '2026-10-31T02:19:00Z')
    const submit = vi.fn()
    const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }
    render(createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(TxForm, {
      categories: [{ id: 'food', name: 'อาหาร', icon: 'utensils', sort: 0, archived: false }],
      initial: { amount: 10_000, date: '2026-10-31', categoryId: 'food', note: null, cycleMonth: '2026-09', createdAt: '2026-10-31T01:00:00Z' },
      busy: false, submitLabel: 'บันทึก', onSubmit: submit,
    }) }))
    const cycle = await screen.findByRole('combobox', { name: 'หักจากเงินรอบ' })
    expect((cycle as HTMLSelectElement).value).toBe('2026-09')
    expect(screen.getByRole('option', { name: 'ยอดปิด ต.ค. 2026' })).toBeTruthy()
    fireEvent.change(cycle, { target: { value: '2026-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ cycleMonth: '2026-10', date: '2026-10-31' }))
  })

})
