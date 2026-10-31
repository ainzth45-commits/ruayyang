// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../data/localRepo'
import { summarizeMonth } from '../domain/calc'
import { AppProvider } from './store'
import { SavingForm, type SavingValues } from './components/SavingSheets'

vi.mock('./sound', () => ({ play: vi.fn() }))
const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-31T03:00:00Z')) })
afterEach(() => { cleanup(); vi.useRealTimers() })

async function setup(initial?: SavingValues & { createdAt?: string }, onSubmit = vi.fn(), showCycle = true) {
  const repo = new LocalRepo(memoryKV(), memorySlipStore())
  await repo.setActualBalance('2026-09', 900_000)
  await repo.setMonthClosed('2026-09', '2026-09-30T02:00:00Z')
  await repo.setActualBalance('2026-10', 800_000)
  await repo.setMonthClosed('2026-10', '2026-10-31T02:19:00Z')
  const props = { initial: initial ?? { amount: 10_000, date: '2026-10-31', note: null }, busy: false, submitLabel: 'เก็บเงิน', onSubmit, showCycle }
  const mount = () => render(createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(SavingForm, props) }))
  return { repo, mount, onSubmit }
}

describe('savings form confirms the cash cycle', () => {
  it('records a pre-close same-day deposit in the old cycle without deducting the new snapshot twice', async () => {
    const { repo, mount, onSubmit } = await setup()
    mount()
    const cycle = await screen.findByRole('combobox', { name: 'หักจากเงินรอบ' })
    expect((cycle as HTMLSelectElement).value).toBe('2026-10')
    fireEvent.change(cycle, { target: { value: '2026-09' } })
    fireEvent.click(screen.getByRole('button', { name: 'เก็บเงิน' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 10_000, date: '2026-10-31', cycleMonth: '2026-09' }))
    await repo.addSaving({ ...onSubmit.mock.calls[0][0], kind: 'deposit' })
    const records = await repo.listMonths('2026-09', '2026-10')
    const savings = await repo.listSavings('2026-10-01', '2026-10-31')
    expect(summarizeMonth('2026-10', [], [], [], records.find((r) => r.month === '2026-10')!, savings, records).left).toBe(800_000)
  })

  it('preserves an existing old-cycle deposit and offers the newly opened cycle as an alternate', async () => {
    const initial = { amount: 10_000, date: '2026-10-31', note: null, cycleMonth: '2026-09', createdAt: '2026-10-31T01:00:00Z' }
    const { mount, onSubmit } = await setup(initial)
    mount()
    const cycle = await screen.findByRole('combobox', { name: 'หักจากเงินรอบ' })
    expect((cycle as HTMLSelectElement).value).toBe('2026-09')
    fireEvent.click(screen.getByRole('button', { name: 'เก็บเงิน' }))
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ cycleMonth: '2026-09' }))
    expect(screen.getByRole('option', { name: 'ยอดปิด ต.ค. 2026' })).toBeTruthy()
    fireEvent.change(cycle, { target: { value: '2026-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'เก็บเงิน' }))
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ cycleMonth: '2026-10', date: '2026-10-31' }))
  })

  it('keeps imported deposits in their original cycle on an unchanged-date edit', async () => {
    const { mount, onSubmit } = await setup({ amount: 10_000, date: '2026-10-31', note: null, createdAt: '2026-10-31T01:00:00Z' })
    mount()
    const cycle = await screen.findByRole('combobox', { name: 'หักจากเงินรอบ' })
    expect((cycle as HTMLSelectElement).value).toBe('2026-09')
    fireEvent.click(screen.getByRole('button', { name: 'เก็บเงิน' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ cycleMonth: '2026-09' }))
  })

  it('blocks submit while lookup is pending and offers retry after an error', async () => {
    const { repo, mount, onSubmit } = await setup()
    let rejectLookup: (error: Error) => void = () => {}
    const lookup = vi.spyOn(repo, 'listMonths').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLookup = reject }))
    mount()
    const save = screen.getByRole('button', { name: 'เก็บเงิน' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.submit(save.closest('form')!)
    expect(onSubmit).not.toHaveBeenCalled()
    rejectLookup(new Error('โหลดรอบเงินไม่สำเร็จ'))
    fireEvent.click(await screen.findByRole('button', { name: 'โหลดรอบเงินอีกครั้ง' }))
    await screen.findByRole('combobox', { name: 'หักจากเงินรอบ' })
    await waitFor(() => expect(save.disabled).toBe(false))
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('does not expose or submit date/cycle changes for close savings', async () => {
    const { repo, mount, onSubmit } = await setup({ amount: 10_000, date: '2026-10-31', note: null, cycleMonth: '2026-10' }, vi.fn(), false)
    const lookup = vi.spyOn(repo, 'listMonths')
    mount()
    expect(screen.queryByRole('combobox', { name: 'หักจากเงินรอบ' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^วันที่ / })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'เก็บเงิน' }))
    expect(onSubmit).toHaveBeenCalledWith({ amount: 10_000, date: '2026-10-31', note: null })
    expect(lookup).not.toHaveBeenCalled()
  })
})
