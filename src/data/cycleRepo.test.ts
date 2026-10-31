import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalRepo, memoryKV, memorySlipStore } from './localRepo'
import type { KV } from './localRepo'
import { SupabaseRepo } from './supabaseRepo'
import type { SupabaseClient } from '@supabase/supabase-js'
import { activeCycle, transactionCycle } from '../domain/cycle'

const tx = (date: string) => ({ date, amount: 10000, categoryId: null, note: null, slipPath: null, slipHash: null, ocrAmount: null })
const open = '2026-10-31T02:19:40Z'
afterEach(() => vi.useRealTimers())

describe('cash-cycle repository writes', () => {
  it('assigns the opened cycle immediately and preserves it while editing notes', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-31T04:00:00Z'))
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await repo.closeMonthAtomic('2026-10', 800000, 0, open)
    const t = await repo.addTransaction(tx('2026-10-31'))
    expect(t.cycleMonth).toBe('2026-10')
    await repo.updateTransaction(t.id, { note: 'ข้าว' })
    expect((await repo.listTransactions(t.date, t.date))[0].cycleMonth).toBe('2026-10')
    await repo.updateTransaction(t.id, { date: '2026-10-30' })
    expect((await repo.listTransactions('2026-10-30', '2026-10-30'))[0].cycleMonth).toBe('2026-09')
  })

  it('honors an explicit same-day earlier cycle and assigns savings without a duplicate transaction', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-31T04:00:00Z'))
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await repo.closeMonthAtomic('2026-10', 800000, 0, open)
    expect((await repo.addTransaction({ ...tx('2026-10-31'), cycleMonth: '2026-09' })).cycleMonth).toBe('2026-09')
    const saving = await repo.addSaving({ date: '2026-10-31', amount: 100, kind: 'deposit', note: null })
    expect(saving.cycleMonth).toBe('2026-10')
    await repo.updateSaving(saving.id, { date: '2026-10-30' })
    expect((await repo.listSavings('2026-10-30', '2026-10-30'))[0].cycleMonth).toBe('2026-09')
    expect(await repo.listTransactions('2026-10-01', '2026-10-31')).toHaveLength(1)
  })

  it('re-close updates one set-aside and keeps the original opening instant', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await repo.closeMonthAtomic('2026-10', 800000, 10000, open)
    await repo.closeMonthAtomic('2026-10', 888800, 20000, '2026-11-01T02:00:00Z')
    expect((await repo.listMonths('2026-10', '2026-10'))[0]).toMatchObject({ actualBalance: 888800, closedAt: open })
    expect(await repo.listSavings('2026-10-01', '2026-10-31')).toMatchObject([{ amount: 20000, kind: 'close' }])
  })

  it('an existing unclosed empty month gets a real opening timestamp on its first close', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await repo.insertMonthsIfAbsent(['2026-10'])
    await repo.closeMonthAtomic('2026-10', 800000, 0, open)
    expect((await repo.listMonths('2026-10', '2026-10'))[0]).toMatchObject({ actualBalance: 800000, closedAt: open })
  })

  it.each([0, 500000])('editing an imported balance %s preserves its implicit opening and historical transaction cycle', async (balance) => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    await repo.setActualBalance('2026-08', 100000)
    await repo.setActualBalance('2026-09', balance)
    const historical = { date: '2026-10-10', createdAt: '2026-10-10T03:00:00Z' }
    const before = await repo.listMonths('2026-08', '2026-09')
    expect(transactionCycle(historical, before)).toBe('2026-09')
    await repo.closeMonthAtomic('2026-09', 600000, 0, open)
    const after = await repo.listMonths('2026-08', '2026-09')
    expect(after.find((r) => r.month === '2026-09')).toMatchObject({ actualBalance: 600000, closedAt: null })
    expect(activeCycle(after, historical.date, historical.createdAt)?.month).toBe('2026-09')
    expect(transactionCycle(historical, after)).toBe('2026-09')
  })

  it('rolls back both in-memory balance and savings when local persistence fails', async () => {
    const backing = memoryKV()
    let fail = false
    const kv: KV = { getItem: (k) => backing.getItem(k), setItem: (k, v) => { if (fail) throw new Error('quota'); backing.setItem(k, v) } }
    const repo = new LocalRepo(kv, memorySlipStore())
    await repo.closeMonthAtomic('2026-10', 10000, 1000, open)
    const before = backing.getItem('ledger-local-v1')
    fail = true
    await expect(repo.closeMonthAtomic('2026-10', 20000, 2000, open)).rejects.toThrow('quota')
    expect(backing.getItem('ledger-local-v1')).toBe(before)
    expect((await repo.listMonths('2026-10', '2026-10'))[0].actualBalance).toBe(10000)
    expect((await repo.listSavings('2026-10-01', '2026-10-31'))[0].amount).toBe(1000)
  })

  it('rejects invalid or excessive set-aside without writing a month', async () => {
    const repo = new LocalRepo(memoryKV(), memorySlipStore())
    for (const [actual, save] of [[100, 101], [-1, 1], [1.5, 0], [100, -1]]) {
      await expect(repo.closeMonthAtomic('2026-10', actual, save, open)).rejects.toThrow()
    }
    expect(await repo.listMonths('2026-10', '2026-10')).toEqual([])
  })
})

describe('Supabase cycle adapter', () => {
  it('round-trips the explicit cycle and stores a bill receipt independently of transactions', async () => {
    const writes: { table: string; payload: Record<string, unknown> }[] = []
    const from = (table: string) => {
      let payload: Record<string, unknown> = {}
      const q = {
        insert: (row: Record<string, unknown>) => { payload = row; writes.push({ table, payload }); return q },
        update: (row: Record<string, unknown>) => { payload = row; writes.push({ table, payload }); return q },
        select: () => q,
        single: async () => ({ data: { ...payload, id: 'new', created_at: open }, error: null }),
        eq: async () => ({ error: null, count: 1 }),
      }
      return q
    }
    const repo = new SupabaseRepo({ from } as unknown as SupabaseClient)
    const t = await repo.addTransaction({ ...tx('2026-10-31'), cycleMonth: '2026-10' })
    expect(t).toMatchObject({ date: '2026-10-31', amount: 10000, cycleMonth: '2026-10' })
    expect(writes[0].payload.cycle_month).toBe('2026-10-01')
    const saving = await repo.addSaving({ date: '2026-10-31', amount: 5000, kind: 'deposit', note: null, cycleMonth: '2026-09' })
    expect(saving.cycleMonth).toBe('2026-09')
    await repo.updateEntry('bill', { receiptPath: 'owner/2026-10/receipt.jpg' })
    expect(writes[2]).toEqual({ table: 'month_entries', payload: { receipt_path: 'owner/2026-10/receipt.jpg' } })
    expect(writes.filter((w) => w.table === 'transactions')).toHaveLength(1)
  })

  it('uses one closing RPC and clearly reports an unapplied migration', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const repo = new SupabaseRepo({ rpc } as unknown as SupabaseClient)
    await repo.closeMonthAtomic('2026-10', 800000, 10000, open)
    expect(rpc).toHaveBeenCalledWith('close_month_ledger', { p_month: '2026-10-01', p_actual: '8000.00', p_save: '100.00', p_closed_at: open })
    rpc.mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'Could not find function' } })
    await expect(repo.closeMonthAtomic('2026-10', 800000, 0, open)).rejects.toThrow(/อัปเดตฐานข้อมูล/)
  })

  it('continues pagination when the server caps responses below the requested page size', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: String(i), date: '2026-10-31', amount: '1.00', category_id: null, note: null, slip_path: null, slip_hash: null, ocr_amount: null, created_at: open, cycle_month: '2026-10-01' }))
    const ranges: number[] = []
    const from = () => {
      const q = { select: () => q, gte: () => q, lte: () => q, order: () => q, range: (start: number) => { ranges.push(start); return Promise.resolve({ data: rows.slice(start, start + 2), error: null, count: rows.length }) } }
      return q
    }
    const repo = new SupabaseRepo({ from } as unknown as SupabaseClient)
    const result = await repo.listTransactions('2026-10-01', '2026-10-31')
    expect(result).toHaveLength(3)
    expect(result[0].cycleMonth).toBe('2026-10')
    expect(ranges).toEqual([0, 2])
  })
})
