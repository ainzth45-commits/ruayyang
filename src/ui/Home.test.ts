// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../data/localRepo'
import { AppProvider } from './store'
import { Home } from './screens/Home'

const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-31T03:00:00Z')) })
afterEach(() => { cleanup(); vi.useRealTimers() })
async function showHome(closed: boolean) {
  const repo = new LocalRepo(memoryKV(), memorySlipStore())
  await repo.insertMonthsIfAbsent(['2026-10'])
  if (closed) {
    await repo.setActualBalance('2026-10', 800_000)
    await repo.setMonthClosed('2026-10', '2026-10-31T02:19:00Z')
    await repo.addTransaction({ date: '2026-10-31', amount: 10_000, categoryId: null, note: 'ข้าวเที่ยง', slipPath: null, slipHash: null, ocrAmount: null, cycleMonth: '2026-10' })
  }
  const onOpenPlan = vi.fn()
  render(createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'local@test.invalid' }, children: createElement(Home, { onOpenPlan }) }))
  return onOpenPlan
}
describe('Home money-first flow', () => {
  it('shows actual opened cash after same-day spending as the primary balance', async () => {
    await showHome(true)
    expect(await screen.findByRole('heading', { name: 'เงินพร้อมใช้' })).toBeTruthy()
    expect(await screen.findByText('7,900.00')).toBeTruthy()
    expect(screen.getByText(/เริ่มรอบ/)).toBeTruthy()
    expect(screen.getByText('ข้าวเที่ยง')).toBeTruthy()
  })
  it('asks to open a cycle instead of showing an invented zero balance', async () => {
    const open = await showHome(false)
    const button = await screen.findByRole('button', { name: /ไปแผนเดือนเพื่อปิดยอด/ })
    fireEvent.click(button)
    expect(open).toHaveBeenCalled()
  })
})
