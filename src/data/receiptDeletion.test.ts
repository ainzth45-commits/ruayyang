import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LocalRepo, memoryKV, memorySlipStore, type KV } from './localRepo'
import { SupabaseRepo } from './supabaseRepo'
import { stopItem } from '../domain/plan'

async function fixture(kv: KV = memoryKV()) {
  const slips = memorySlipStore()
  const repo = new LocalRepo(kv, slips)
  const item = await repo.saveItem({ name: 'บิล', kind: 'expense', defaultAmount: 10000, isEstimate: false, startMonth: '2026-10', endMonth: null, sort: 0, archived: false })
  await repo.insertEntriesIfAbsent(['2026-10', '2026-11'].map(month => ({ itemId: item.id, month, amount: 10000, paid: false, note: null })))
  const entries = await repo.listEntries('2026-10','2026-11')
  await slips.put('shared-proof.jpg', new Blob(['proof']))
  for (const e of entries) await repo.updateEntry(e.id, { receiptPath: 'shared-proof.jpg' })
  return { repo, slips, entries, item }
}

describe('monthly bill proof deletion', () => {
  it('commits row removal before deleting each distinct image once and never creates daily expenses', async () => {
    const { repo, slips, entries } = await fixture()
    const del = vi.spyOn(slips,'del').mockImplementation(async path => {
      expect(await repo.listEntries('2026-10','2026-11')).toHaveLength(0)
      expect(path).toBe('shared-proof.jpg')
    })
    expect(await repo.deleteEntries(entries.map(e=>e.id))).toBeNull()
    expect(del).toHaveBeenCalledTimes(1)
    expect(await repo.listTransactions('2026-10-01','2026-11-30')).toEqual([])
  })
  it('preserves row references and files when the local write fails', async () => {
    const store=memoryKV()
    let reject=false
    const kv: KV={ getItem: store.getItem, setItem(k,v) { if(reject) throw new Error('quota');store.setItem(k,v) } }
    const {repo,slips,entries}=await fixture(kv)
    const del=vi.spyOn(slips,'del')
    reject=true
    await expect(repo.deleteEntries(entries.map(e=>e.id))).rejects.toThrow('quota')
    expect(await repo.listEntries('2026-10','2026-11')).toHaveLength(2)
    expect(del).not.toHaveBeenCalled()
    expect(await slips.get('shared-proof.jpg')).not.toBeNull()
  })
  it('reports cleanup failure after successful deletion instead of pretending the bill was not removed', async () => {
    const {repo,slips,entries}=await fixture()
    vi.spyOn(slips,'del').mockRejectedValue(new Error('storage unavailable'))
    expect(await repo.deleteEntries(entries.map(e=>e.id))).toMatch(/ลบรายการแล้ว.*หลักฐาน/)
    expect(await repo.listEntries('2026-10','2026-11')).toHaveLength(0)
  })
  it('propagates cleanup warnings from stopping a recurring item', async () => {
    const {repo,slips,item}=await fixture()
    vi.spyOn(slips,'del').mockRejectedValue(new Error('storage unavailable'))
    expect(await stopItem(repo,item,'2026-10')).toMatch(/หลักฐาน/)
  })
  it('returns null for empty/no-proof deletion', async () => {
    const {repo,entries}=await fixture()
    for (const e of entries) await repo.updateEntry(e.id,{receiptPath:null})
    expect(await repo.deleteEntries([])).toBeNull()
    expect(await repo.deleteEntries(entries.map(e=>e.id))).toBeNull()
  })
})

function remoteFixture(deleteError: { message: string } | null = null, storageError: { message: string } | null = null) {
  const log:string[]=[]
  const remove=vi.fn(async (paths:string[])=>{log.push('storage');expect(paths).toEqual(['owner/proof.jpg']);return {error:storageError}})
  const select={ in:()=>select, order:()=>select, range:async()=>({data:[{receipt_path:'owner/proof.jpg'},{receipt_path:'owner/proof.jpg'}],error:null,count:2}) }
  const from=()=>({ select:()=>select, delete:()=>({in:async()=>{log.push('rows');return {error:deleteError}}}) })
  const repo=new SupabaseRepo({from,storage:{from:()=>({remove})}} as unknown as SupabaseClient)
  return {repo,remove,log}
}

describe('Supabase monthly proof deletion order',()=>{
  it('removes storage only after the database succeeds',async()=>{
    const {repo,log,remove}=remoteFixture()
    expect(await repo.deleteEntries(['1','2'])).toBeNull()
    expect(log).toEqual(['rows','storage'])
    expect(remove).toHaveBeenCalledTimes(1)
  })
  it('returns a cleanup warning without undoing a successful remote deletion',async()=>{
    const {repo,log}=remoteFixture(null,{message:'storage unavailable'})
    const errorLog=vi.spyOn(console,'error').mockImplementation(()=>{})
    try {
      expect(await repo.deleteEntries(['1','2'])).toMatch(/ลบรายการแล้ว.*หลักฐาน/)
      expect(log).toEqual(['rows','storage'])
    } finally { errorLog.mockRestore() }
  })
  it('does not remove proof when the database refuses deletion',async()=>{
    const {repo,remove}=remoteFixture({message:'write failed'})
    const errorLog=vi.spyOn(console,'error').mockImplementation(()=>{})
    try { await expect(repo.deleteEntries(['1'])).rejects.toThrow(/ลบรายการ/);expect(remove).not.toHaveBeenCalled() }
    finally { errorLog.mockRestore() }
  })
})
