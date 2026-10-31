// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from '../../data/localRepo'
import type { Auth } from '../../data/repo'
import { AppProvider } from '../store'
import { ItemMonthlySheet } from './ItemMonthlySheet'

const auth: Auth = {
  currentUser: async () => null,
  signIn: async () => ({ id: 'local', email: 'test@example.invalid' }),
  signOut: async () => {},
  onChange: () => () => {},
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function setup(options: { empty?: boolean; failFirst?: boolean; startMonth?: string } = {}) {
  const repo = new LocalRepo(memoryKV(), memorySlipStore())
  const item = await repo.saveItem({ name: 'ค่าไฟทดสอบ', kind: 'expense', defaultAmount: 999_999, isEstimate: true, startMonth: options.startMonth ?? '2026-09', endMonth: '2026-12', sort: 0, archived: false })
  const other = await repo.saveItem({ name: 'บิลอื่น', kind: 'expense', defaultAmount: 99_999, isEstimate: false, startMonth: '2026-09', endMonth: null, sort: 1, archived: false })
  if (!options.empty) await repo.insertEntriesIfAbsent([
    { itemId: item.id, month: '2026-11', amount: 155_000, paid: false, note: null },
    { itemId: item.id, month: '2026-10', amount: 100_000, paid: true, note: null },
    { itemId: item.id, month: '2026-12', amount: 0, paid: false, note: null },
    { itemId: item.id, month: '2027-01', amount: 90_000, paid: true, note: null },
  ])
  await repo.insertEntriesIfAbsent([{ itemId: other.id, month: '2026-10', amount: 99_999, paid: false, note: null }])
  const list = vi.spyOn(repo, 'listEntries')
  if (options.failFirst) list.mockRejectedValueOnce(new Error('เชื่อมต่อไม่ได้'))
  const update = vi.spyOn(repo, 'updateEntry')
  const create = vi.spyOn(repo, 'insertEntriesIfAbsent')
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const tree = createElement(AppProvider, { repo, auth, user: { id: 'local', email: 'test@example.invalid' }, children: createElement(ItemMonthlySheet, { item, currentMonth: '2026-10', onSelect, onClose }) })
  const view = render(tree)
  return { repo, item, list, update, create, onSelect, onClose, view }
}

describe('same recurring bill across months', () => {
  it('keeps actual varying monthly amounts and statuses, excludes other bills and selects the actual entry', async () => {
    const { repo, item, list, update, create, onSelect } = await setup()
    const region = await screen.findByRole('region', { name: 'ยอดรายการนี้แต่ละเดือน' })
    const rows = within(region).getAllByRole('button')
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('ต.ค. 2026'), expect.stringContaining('พ.ย. 2026'), expect.stringContaining('ธ.ค. 2026'), expect.stringContaining('ม.ค. 2027'),
    ])
    expect(within(rows[0]).getByText('1,000.00')).toBeTruthy()
    expect(within(rows[0]).getByText('จ่ายแล้ว')).toBeTruthy()
    expect(within(rows[0]).getByText('เดือนที่กำลังดู')).toBeTruthy()
    expect(within(rows[1]).getByText('1,550.00')).toBeTruthy()
    expect(within(rows[1]).getByText('ยอดประมาณ')).toBeTruthy()
    expect(within(rows[2]).getByText('0.00')).toBeTruthy()
    // A stopped item may retain an already-paid entry after endMonth as history.
    expect(within(rows[3]).getByText('900.00')).toBeTruthy()
    expect(within(rows[3]).getByText('จ่ายแล้ว')).toBeTruthy()
    expect(screen.queryByText('999.99')).toBeNull()
    expect(screen.queryByText('9,999.99')).toBeNull()
    expect(list).toHaveBeenCalledWith('2000-01', '9999-12')
    const before = await repo.listEntries('2026-09', '9999-12')
    fireEvent.click(rows[1])
    const selected = before.find((entry) => entry.itemId === item.id && entry.month === '2026-11')
    expect(onSelect).toHaveBeenCalledWith(selected)
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(await repo.listEntries('2026-09', '9999-12')).toEqual(before)
  })

  it('retains recorded months before a subsequently moved template start month', async () => {
    await setup({ startMonth: '2026-11' })
    const region = await screen.findByRole('region', { name: 'ยอดรายการนี้แต่ละเดือน' })
    expect(within(region).getByText('ต.ค. 2026')).toBeTruthy()
    expect(within(region).getByText('1,000.00')).toBeTruthy()
  })

  it('offers retry after a load failure and then shows the bill months', async () => {
    const { list } = await setup({ failFirst: true })
    const retry = await screen.findByRole('button', { name: 'ลองโหลดอีกครั้ง' })
    expect(screen.getByText('โหลดประวัติรายการนี้ไม่สำเร็จ')).toBeTruthy()
    fireEvent.click(retry)
    expect(await screen.findByRole('region', { name: 'ยอดรายการนี้แต่ละเดือน' })).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('shows an empty state when only other bill entries exist and creates no monthly plan', async () => {
    const { update, create } = await setup({ empty: true })
    expect(await screen.findByText('ยังไม่มีแผนรายเดือนของรายการนี้')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'ยอดรายการนี้แต่ละเดือน' })).toBeNull()
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
