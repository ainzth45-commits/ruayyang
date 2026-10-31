// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../../data/localRepo'
import { AppProvider } from '../store'
import { CloseMonthSheet } from './CloseMonthSheet'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('opens the complete bill editor from closing so proof can be attached and checked before payment', async () => {
  const repo = new LocalRepo(memoryKV(), memorySlipStore())
  const item = await repo.saveItem({ name: 'ค่าไฟปิดยอด', kind: 'expense', defaultAmount: 87_500, isEstimate: false, startMonth: '2026-10', endMonth: null, sort: 0, archived: false })
  await repo.insertEntriesIfAbsent([{ itemId: item.id, month: '2026-10', amount: 87_500, paid: false, note: null }])
  const auth = { currentUser: async () => null, signIn: vi.fn(), signOut: vi.fn(), onChange: () => () => {} }
  render(createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(CloseMonthSheet, { month: '2026-10', onClose: vi.fn() }) }))
  fireEvent.click(await screen.findByRole('button', { name: 'ตรวจบิลและแนบหลักฐาน ค่าไฟปิดยอด' }))
  expect(screen.getByRole('dialog', { name: 'ค่าไฟปิดยอด' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'แนบหลักฐาน' })).toBeTruthy()
  expect((screen.getByRole('textbox', { name: 'ยอด' }) as HTMLInputElement).value).toBe('875.00')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(await screen.findByRole('dialog', { name: 'ปิดยอด ต.ค. 2026' })).toBeTruthy()
})
