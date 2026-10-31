// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../../data/localRepo'
import type { Auth } from '../../data/repo'
import { addMonths, bangkokToday, monthOf } from '../../domain/month'
import { AppProvider } from '../store'
import { Daily } from './Daily'

afterEach(cleanup)

async function openCalendar() {
  const repo = new LocalRepo(memoryKV(), memorySlipStore())
  const today = bangkokToday()
  const month = monthOf(today)
  const previous = addMonths(month, -1)
  await repo.insertMonthsIfAbsent([previous, month])
  const item = async (name: string, kind: 'income' | 'expense') => repo.saveItem({
    name, kind, defaultAmount: 0, isEstimate: false, startMonth: previous, endMonth: null, sort: 0, archived: false,
  })
  const salary = await item('เงินเดือนทดสอบ', 'income')
  const rent = await item('ค่าเช่าทดสอบ', 'expense')
  const water = await item('ค่าน้ำทดสอบ', 'expense')
  await repo.insertEntriesIfAbsent([
    { itemId: salary.id, month, amount: 3_600_000, paid: false, note: null },
    { itemId: rent.id, month, amount: 100_000, paid: true, note: null },
    { itemId: water.id, month, amount: 20_000, paid: false, note: null },
    { itemId: rent.id, month: previous, amount: 50_000, paid: true, note: null },
  ])
  await repo.addTransaction({ date: today, amount: 10_000, categoryId: null, note: 'ข้าวเที่ยงทดสอบ', slipPath: null, slipHash: null, ocrAmount: null })
  const auth: Auth = {
    currentUser: async () => null,
    signIn: async () => ({ id: 'test', email: 'test@example.test' }),
    signOut: async () => {},
    onChange: () => () => {},
  }
  render(createElement(AppProvider, { repo, auth, user: { id: 'test', email: 'test@example.test' }, children: createElement(Daily) }))
  await screen.findByText('ข้าวเที่ยงทดสอบ')
  return repo
}

describe('ปฏิทินแยกรายวันและจ่ายประจำ', () => {
  it('keeps fixed bills out of the daily calendar and daily total', async () => {
    await openCalendar()
    expect(screen.getByRole('heading', { name: 'ปฏิทิน', level: 1 })).toBeTruthy()
    const summary = screen.getByRole('region', { name: 'สรุปใช้จ่ายรายวัน' })
    expect(within(summary).getAllByText('100.00').length).toBe(2)
    expect(screen.queryByText('ค่าเช่าทดสอบ')).toBeNull()
    expect(screen.queryByText('เงินเดือนทดสอบ')).toBeNull()
  })

  it('shows only fixed expense entries in fixed mode, with paid and unpaid totals', async () => {
    const repo = await openCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'จ่ายประจำ' }))
    const summary = await screen.findByRole('region', { name: 'สรุปจ่ายประจำ' })
    expect(within(summary).getByText('1,200.00')).toBeTruthy()
    expect(within(summary).getByText('1,000.00')).toBeTruthy()
    expect(within(summary).getByText('200.00')).toBeTruthy()
    expect(screen.getByText('ค่าเช่าทดสอบ')).toBeTruthy()
    expect(screen.getByText('ค่าน้ำทดสอบ')).toBeTruthy()
    expect(screen.queryByText('เงินเดือนทดสอบ')).toBeNull()
    expect(screen.queryByText('ข้าวเที่ยงทดสอบ')).toBeNull()
    expect(screen.queryByRole('grid', { name: 'ปฏิทินรายจ่าย' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^ค่าเช่าทดสอบ/ }))
    const detail = screen.getByRole('dialog')
    expect(within(detail).getByRole('region', { name: 'หลักฐานการชำระ' })).toBeTruthy()
    expect(within(detail).getByRole('button', { name: 'แนบหลักฐาน' })).toBeTruthy()
    expect((await repo.listTransactions('2000-01-01', '9999-12-31'))).toHaveLength(1)
  })

  it('keeps bills in their own calendar month and restores daily mode separately', async () => {
    await openCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'จ่ายประจำ' }))
    await screen.findByRole('region', { name: 'สรุปจ่ายประจำ' })
    fireEvent.click(screen.getByRole('button', { name: 'เดือนก่อน' }))
    await waitFor(() => {
      const summary = screen.getByRole('region', { name: 'สรุปจ่ายประจำ' })
      expect(within(summary).getAllByText('500.00')).toHaveLength(2)
    })
    expect(screen.queryByText('ค่าน้ำทดสอบ')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ใช้จ่ายรายวัน' }))
    expect(screen.getByRole('grid', { name: 'ปฏิทินรายจ่าย' })).toBeTruthy()
    expect(screen.queryByText('ค่าเช่าทดสอบ')).toBeNull()
  })
})
