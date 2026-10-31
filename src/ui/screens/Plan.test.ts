// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../../data/localRepo'
import { summarizeMonth } from '../../domain/calc'
import type { MonthData } from '../monthData'
import { loadMonth } from '../monthData'
import { AppProvider } from '../store'
import { Plan } from './Plan'

vi.mock('../monthData', () => ({ loadMonth: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
function monthData(month: string): MonthData {
  const items = [{ id: 'bill', name: `ค่าไฟ ${month}`, kind: 'expense' as const, defaultAmount: 10_000, isEstimate: false, startMonth: '2026-01', endMonth: null, sort: 0, archived: false }]
  const entries = [{ id: `entry-${month}`, itemId: 'bill', month, amount: 10_000, paid: false, note: null }]
  return { month, items, entries, txs: [], categories: [], records: [], record: null, budget: null, savings: [], savingsTotal: 0, summary: summarizeMonth(month, items, entries, [], null), spending: null }
}
describe('monthly plan on a slow connection', () => {
  it('hides previous-month bills and their edit sheet immediately when selecting a new month', async () => {
    let finish!: (data: MonthData) => void
    const pending = new Promise<MonthData>((resolve) => { finish = resolve })
    vi.mocked(loadMonth).mockResolvedValueOnce(monthData('2026-10')).mockReturnValueOnce(pending)
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }
    const tree = (month: string) => createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(Plan, { month, onMonth: vi.fn() }) })
    const view = render(tree('2026-10'))
    fireEvent.click(await screen.findByRole('button', { name: /ค่าไฟ 2026-10/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    view.rerender(tree('2026-11'))
    expect(screen.queryByRole('button', { name: /ค่าไฟ 2026-10/ })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('กำลังโหลด')
    await act(async () => finish(monthData('2026-11')))
    expect(await screen.findByRole('button', { name: /ค่าไฟ 2026-11/ })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('edits only the viewed month without a cross-month item history button', async () => {
    const october = monthData('2026-10')
    vi.mocked(loadMonth).mockResolvedValue(october)
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    const update = vi.spyOn(repo, 'updateEntry').mockResolvedValue()
    const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }
    render(createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(Plan, { month: '2026-10', onMonth: vi.fn() }) }))
    fireEvent.click(await screen.findByRole('button', { name: /ค่าไฟ 2026-10/ }))
    expect(screen.queryByRole('button', { name: 'ยอดรายการนี้แต่ละเดือน' })).toBeNull()
    expect((screen.getByRole('textbox', { name: 'ยอด' }) as HTMLInputElement).value).toBe('100.00')
    fireEvent.change(screen.getByRole('textbox', { name: 'ยอด' }), { target: { value: '125' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(update).toHaveBeenCalledWith('entry-2026-10', expect.objectContaining({ amount: 12_500 }))
  })
})
