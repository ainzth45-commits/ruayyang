import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const first = `${A}/2026-10/first.jpg`
const second = `${A}/2026-10/second.jpg`
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url)
let db: PGlite
let item: string
let legacy: Record<string, unknown>
let sequence = 0

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user ?? ''}',false); set role ${user ? 'authenticated' : 'anon'};`)
  try { return await db.query<Record<string, unknown>>(sql, params) }
  finally { await db.exec('reset role') }
}

async function entry() {
  const index = sequence++
  const month = `${2027 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-01`
  return String((await as(A, 'insert into month_entries(item_id,month,amount,paid) values($1,$2,875,false) returning id', [item, month])).rows[0].id)
}

async function save(id: string, receipts: unknown, path: string | null = first, revision = 1) {
  return as(A, 'update month_entries set receipts=$1::jsonb,receipt_path=$2,receipt_revision=$3 where id=$4 returning receipts,receipt_path,receipt_revision', [JSON.stringify(receipts), path, revision, id])
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to anon,authenticated;
    insert into auth.users values ('${A}'),('${B}');
  `)
  for (const name of ['0001_init.sql', '0003_category_unique.sql', '0004_budget_savings.sql', '20261031060000_cycle_receipts.sql']) await db.exec(readFileSync(migration(name), 'utf8'))
  item = String((await as(A, "insert into recurring_items(name,kind,default_amount,start_month) values('ค่าไฟ','expense',875,'2026-01-01') returning id")).rows[0].id)
  legacy = (await as(A, "insert into month_entries(item_id,month,amount,paid,note,receipt_path) values($1,'2026-10-01',875,true,'เดิม',$2) returning id,user_id,item_id,month::text,amount::text,paid,note,receipt_path", [item, first])).rows[0]
  const url = migration('20261031110000_multi_receipts.sql')
  if (existsSync(url)) await db.exec(readFileSync(url, 'utf8'))
})
afterAll(async () => { await db?.close() })

describe('multiple monthly receipt schema', () => {
  it('adds nullable evidence and revision without rewriting any legacy financial values or proof', async () => {
    expect((await as(A, 'select id,user_id,item_id,month::text,amount::text,paid,note,receipt_path from month_entries where id=$1', [legacy.id])).rows[0]).toEqual(legacy)
    expect((await as(A, 'select receipts,receipt_revision from month_entries where id=$1', [legacy.id])).rows[0]).toEqual({ receipts: null, receipt_revision: 0 })
  })

  it('stores all image amounts and rejects stale revision updates without losing another image', async () => {
    const id = await entry()
    const receipts = [{ path: first, ocrAmount: 45_000 }, { path: second, ocrAmount: 42_500 }]
    expect((await save(id, receipts)).rows[0]).toEqual({ receipts, receipt_path: first, receipt_revision: 1 })
    expect((await as(A, 'update month_entries set receipts=$1::jsonb,receipt_path=$2,receipt_revision=1 where id=$3 and receipt_revision=0 returning id', [JSON.stringify([]), null, id])).rows).toEqual([])
    expect((await as(A, 'select receipts,paid,amount::text from month_entries where id=$1', [id])).rows[0]).toEqual({ receipts, paid: false, amount: '875.00' })
  })

  it('accepts unreadable, zero and maximum OCR amounts and allows detaching every image', async () => {
    const id = await entry()
    const receipts = [{ path: first, ocrAmount: null }, { path: second, ocrAmount: 0 }, { path: `${A}/max.jpg`, ocrAmount: 999_999_999 }]
    expect((await save(id, receipts)).rows[0].receipts).toEqual(receipts)
    expect((await save(id, [], null, 2)).rows[0]).toEqual({ receipts: [], receipt_path: null, receipt_revision: 2 })
  })

  it('rejects malformed evidence, dirty amounts, foreign or duplicate paths and unrelated JSON fields', async () => {
    const id = await entry()
    const invalid = [
      null, {}, [null], [{ path: first }], [{ ocrAmount: 1 }],
      [{ path: first, ocrAmount: '87500' }], [{ path: first, ocrAmount: true }],
      [{ path: first, ocrAmount: -1 }], [{ path: first, ocrAmount: 0.5 }], [{ path: first, ocrAmount: 1_000_000_000 }],
      [{ path: '', ocrAmount: 1 }], [{ path: `${B}/other.jpg`, ocrAmount: 1 }],
      [{ path: `${A}/${'x'.repeat(200)}`, ocrAmount: 1 }],
      [{ path: first, ocrAmount: 1 }, { path: first, ocrAmount: 2 }],
      [{ path: first, ocrAmount: 1, text: 'do not store raw OCR' }],
    ]
    for (const receipts of invalid) await expect(save(id, receipts)).rejects.toThrow()
    expect((await as(A, 'select receipts,receipt_path,receipt_revision from month_entries where id=$1', [id])).rows[0]).toEqual({ receipts: null, receipt_path: null, receipt_revision: 0 })
  })

  it('requires the legacy path to mirror the first image and disallows silently replacing only that pointer', async () => {
    const id = await entry()
    const receipts = [{ path: first, ocrAmount: 87_500 }, { path: second, ocrAmount: null }]
    await expect(save(id, receipts, second)).rejects.toThrow(/receipt/i)
    await save(id, receipts)
    await expect(as(A, 'update month_entries set receipt_path=$1 where id=$2', [second, id])).rejects.toThrow(/receipt/i)
    await expect(save(id, [], first, 2)).rejects.toThrow(/receipt/i)
  })

  it('increments legacy pointer revisions automatically, permits OCR re-reads, and rejects revision jumps or reversals', async () => {
    const id = await entry()
    expect((await as(A, 'update month_entries set receipt_path=$1 where id=$2 returning receipt_revision', [first, id])).rows[0].receipt_revision).toBe(1)
    expect((await as(A, 'update month_entries set receipt_path=$1 where id=$2 returning receipt_revision', [first, id])).rows[0].receipt_revision).toBe(1)
    await expect(as(A, 'update month_entries set receipt_revision=3 where id=$1', [id])).rejects.toThrow(/revision/i)
    await expect(save(id, [{ path: second, ocrAmount: null }], second, 8)).rejects.toThrow(/revision/i)
    await save(id, [{ path: second, ocrAmount: null }], second, 2)
    await save(id, [{ path: second, ocrAmount: null }], second, 3)
    await expect(as(A, 'update month_entries set receipt_revision=1 where id=$1', [id])).rejects.toThrow(/revision/i)
    expect((await as(A, "update month_entries set note='ordinary edit' where id=$1 returning receipt_revision", [id])).rows[0].receipt_revision).toBe(3)
  })

  it('keeps owner RLS and does not expose any privileged helper to anon or another owner', async () => {
    const id = await entry()
    await save(id, [{ path: first, ocrAmount: 87_500 }])
    expect((await as(B, 'select * from month_entries where id=$1', [id])).rows).toEqual([])
    expect((await as(B, 'update month_entries set receipts=$1::jsonb,receipt_path=null,receipt_revision=2 where id=$2 returning id', [JSON.stringify([]), id])).rows).toEqual([])
    await expect(as(null, 'select receipts from month_entries')).rejects.toThrow(/permission denied/)
    const meta = await db.query<{ prosecdef: boolean }>("select prosecdef from pg_proc where proname='validate_month_entry_receipts'")
    expect(meta.rows).toEqual([{ prosecdef: false }])
    await expect(as(null, 'select validate_month_entry_receipts()')).rejects.toThrow(/permission denied/)
  })

  it('requires all attached OCR amounts before allowing a new expense payment', async () => {
    const id = await entry()
    await save(id, [{ path: first, ocrAmount: null }])
    await expect(as(A, 'update month_entries set paid=true where id=$1', [id])).rejects.toThrow(/receipt_payment_unreadable/)
    expect((await as(A, 'select paid,amount::text from month_entries where id=$1', [id])).rows[0]).toEqual({ paid: false, amount: '875.00' })
    await save(id, [{ path: first, ocrAmount: 87_500 }], first, 2)
    expect((await as(A, 'update month_entries set paid=true where id=$1 returning paid', [id])).rows[0].paid).toBe(true)
  })

  it('requires an explicit multi-image mode and matches sum or each according to that choice', async () => {
    const id = await entry()
    const split = [{ path: first, ocrAmount: 45_000 }, { path: second, ocrAmount: 42_500 }]
    await save(id, split)
    await expect(as(A, 'update month_entries set paid=true where id=$1', [id])).rejects.toThrow(/receipt_payment_mode_required/)
    await expect(as(A, "update month_entries set paid=true,receipt_mode='each' where id=$1", [id])).rejects.toThrow(/receipt_payment_mismatch/)
    expect((await as(A, "update month_entries set paid=true,receipt_mode='sum' where id=$1 returning paid,receipt_revision", [id])).rows[0]).toEqual({ paid: true, receipt_revision: 2 })
    const eachId = await entry()
    await save(eachId, [{ path: first, ocrAmount: 87_500 }, { path: second, ocrAmount: 87_500 }])
    await expect(as(A, "update month_entries set paid=true,receipt_mode='sum' where id=$1", [eachId])).rejects.toThrow(/receipt_payment_mismatch/)
    expect((await as(A, "update month_entries set paid=true,receipt_mode='each' where id=$1 returning paid", [eachId])).rows[0].paid).toBe(true)
  })

  it('checks changed evidence on a paid bill atomically without rewriting old financial data', async () => {
    const id = await entry()
    const proof = [{ path: first, ocrAmount: 87_500 }]
    await save(id, proof)
    await as(A, 'update month_entries set paid=true where id=$1', [id])
    await expect(save(id, [...proof, { path: second, ocrAmount: 100 }], first, 2)).rejects.toThrow(/receipt_payment_mode_required/)
    await expect(as(A, "update month_entries set receipts=$1::jsonb,receipt_mode='sum',receipt_revision=2,note='wrong proof' where id=$2", [JSON.stringify([...proof, { path: second, ocrAmount: 100 }]), id])).rejects.toThrow(/receipt_payment_mismatch/)
    await expect(save(id, [{ path: first, ocrAmount: null }], first, 2)).rejects.toThrow(/receipt_payment_unreadable/)
    expect((await as(A, 'select paid,amount::text,note,receipts,receipt_mode,receipt_revision from month_entries where id=$1', [id])).rows[0]).toEqual({ paid: true, amount: '875.00', note: null, receipts: proof, receipt_mode: null, receipt_revision: 1 })
    // A deliberate correction can save the amount and matching proof in the same statement.
    expect((await as(A, 'update month_entries set amount=900,receipts=$1::jsonb,receipt_revision=2 where id=$2 returning amount::text,paid', [JSON.stringify([{ path: first, ocrAmount: 90_000 }]), id])).rows[0]).toEqual({ amount: '900.00', paid: true })
  })

  it('preserves old paid legacy rows for viewing and notes while requiring validation for payment changes', async () => {
    expect((await as(A, "update month_entries set note='legacy note' where id=$1 returning paid,receipt_revision", [legacy.id])).rows[0]).toEqual({ paid: true, receipt_revision: 0 })
    await expect(as(A, 'update month_entries set amount=900 where id=$1', [legacy.id])).rejects.toThrow(/receipt_payment_unreadable/)
    expect((await as(A, 'select paid,amount::text,receipt_path from month_entries where id=$1', [legacy.id])).rows[0]).toEqual({ paid: true, amount: '875.00', receipt_path: first })
  })

  it('does not require proof on unattached expenses or apply expense checks to income', async () => {
    const id = await entry()
    expect((await as(A, 'update month_entries set paid=true where id=$1 returning paid', [id])).rows[0].paid).toBe(true)
    const income = (await as(A, "insert into recurring_items(name,kind,default_amount,start_month) values('เงินเดือน','income',875,'2026-01-01') returning id")).rows[0].id
    expect((await as(A, "insert into month_entries(item_id,month,amount,paid,receipt_path,receipts) values($1,'2026-10-01',875,true,$2,$3::jsonb) returning paid", [income, first, JSON.stringify([{ path: first, ocrAmount: null }])])).rows[0].paid).toBe(true)
    await expect(as(A, "insert into month_entries(item_id,month,amount,paid,receipt_path,receipts) values($1,'2030-01-01',875,true,$2,$3::jsonb)", [item, first, JSON.stringify([{ path: first, ocrAmount: 100 }])])).rejects.toThrow(/receipt_payment_mismatch/)
  })
})
