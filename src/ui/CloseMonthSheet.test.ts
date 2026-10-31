// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../data/localRepo'
import { AppProvider } from './store'
import { CloseMonthSheet } from './components/CloseMonthSheet'

afterEach(cleanup)
describe('closing a cash cycle', () => {
  it('requires unpaid bills to be confirmed before accepting an opening snapshot', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    const item = await repo.saveItem({ name: 'ค่าไฟ', kind: 'expense', defaultAmount: 10_000, isEstimate: true, startMonth: '2026-10', endMonth: null, archived: false, sort: 0 })
    await repo.insertMonthsIfAbsent(['2026-10'])
    await repo.insertEntriesIfAbsent([{ itemId: item.id, month: '2026-10', amount: 10_000, paid: false, note: null }])
    const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }
    render(createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(CloseMonthSheet, { month: '2026-10', onClose: vi.fn() }) }))
    const next = await screen.findByRole('button', { name: /ถัดไป/ })
    expect((next as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(next)
    expect(screen.queryByLabelText('คงเหลือจริง')).toBeNull()
  })
  it('explains snapshot editing instead of inviting the current balance as a replacement', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await repo.setActualBalance('2026-10', 800_000)
    await repo.setMonthClosed('2026-10', '2026-10-31T02:19:00Z')
    const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }
    render(createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(CloseMonthSheet, { month: '2026-10', onClose: vi.fn() }) }))
    fireEvent.click(await screen.findByRole('button', { name: /ถัดไป/ }))
    expect(screen.getByText(/ยอดตั้งต้น ณ เวลาเปิดรอบเดิม/)).toBeTruthy()
  })

})
