import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
let db: PGlite
let item: string
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url)
const opening = '2026-10-31T02:19:40.000Z'

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;
    insert into auth.users values ('${A}'),('${B}');
  `)
  for (const name of ['0001_init.sql', '0002_storage.sql', '0003_category_unique.sql', '0004_budget_savings.sql', '20261031060000_cycle_receipts.sql']) {
    const url = migration(name)
    if (existsSync(url)) await db.exec(readFileSync(url, 'utf8'))
  }
  item = String((await as(A, "insert into recurring_items(name,kind,default_amount,start_month) values('ค่าไฟ','expense',100,'2026-01-01') returning id")).rows[0].id)
  await as(A, "insert into month_entries(item_id,month,amount,paid) values($1,'2026-10-01',100,true)", [item])
})
afterAll(async () => { await db?.close() })

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user ?? ''}',false); set role ${user ? 'authenticated' : 'anon'};`)
  try { return await db.query<Record<string, unknown>>(sql, params) }
  finally { await db.exec('reset role') }
}

describe('cycle and receipt schema', () => {
  it('stores own receipt on a paid bill without adding daily spending; rejects another user path', async () => {
    await as(A, 'update month_entries set receipt_path=$1 where item_id=$2', [`${A}/2026-10/receipt.jpg`, item])
    expect((await as(A, 'select receipt_path,paid from month_entries where item_id=$1', [item])).rows[0]).toEqual({ receipt_path: `${A}/2026-10/receipt.jpg`, paid: true })
    await expect(as(A, 'update month_entries set receipt_path=$1 where item_id=$2', [`${B}/2026-10/receipt.jpg`, item])).rejects.toThrow(/check/)
    await expect(as(A, 'update month_entries set receipt_path=$1 where item_id=$2', [`${A}/${'x'.repeat(200)}`, item])).rejects.toThrow(/check/)
    expect((await as(A, 'select count(*)::int as count from transactions')).rows[0].count).toBe(0)
    expect((await as(B, 'select receipt_path from month_entries')).rows).toEqual([])
  })

  it('stores a separate first-of-month cycle with the original calendar date', async () => {
    await as(A, "insert into transactions(date,amount,cycle_month) values('2026-10-31',100,'2026-10-01')")
    const row = (await as(A, 'select date::text,cycle_month::text from transactions')).rows[0]
    expect(row).toEqual({ date: '2026-10-31', cycle_month: '2026-10-01' })
    await expect(as(A, "insert into savings(date,amount,kind,cycle_month) values('2026-10-31',10,'deposit','2026-10-02')")).rejects.toThrow(/check/)
  })

  it('closes atomically with one saving and preserves opening timestamp when edited', async () => {
    await as(A, "insert into months(month) values('2026-10-01')")
    await as(A, 'select close_month_ledger($1,$2,$3,$4)', ['2026-10-01', 7777.07, 100, opening])
    await as(A, 'select close_month_ledger($1,$2,$3,$4)', ['2026-10-01', 8888, 200, '2026-11-01T02:00:00Z'])
    const month = (await as(A, "select actual_balance,closed_at from months where month='2026-10-01'")).rows[0]
    expect(Number(month.actual_balance)).toBe(8888)
    expect(new Date(String(month.closed_at)).toISOString()).toBe(opening)
    const savings = (await as(A, "select amount,date::text,kind from savings where kind='close'")).rows
    expect(savings).toHaveLength(1)
    expect(Number(savings[0].amount)).toBe(200)
    expect(savings[0].date).toBe('2026-10-31')
    expect((await as(B, "select * from months where month='2026-10-01'")).rows).toEqual([])
    await as(A, 'select close_month_ledger($1,$2,$3,$4)', ['2026-10-01', 8888, 0, opening])
    expect((await as(A, "select * from savings where kind='close'")).rows).toEqual([])
  })

  it('a downstream saving write failure rolls back the balance and closing instant', async () => {
    await db.exec(`create function reject_test_saving() returns trigger language plpgsql as $$ begin if new.amount=999 then raise exception 'simulated save failure'; end if; return new; end $$;
      create trigger reject_test_saving before insert or update on savings for each row execute function reject_test_saving();`)
    await expect(as(A, 'select close_month_ledger($1,$2,$3,$4)', ['2026-11-01', 2000, 999, '2026-11-30T02:00:00Z'])).rejects.toThrow(/simulated save failure/)
    expect((await as(A, "select * from months where month='2026-11-01'")).rows).toEqual([])
  })

  it('editing an imported actual-only record preserves the implicit opening marker, including zero balance', async () => {
    await as(A, "insert into months(month,actual_balance) values('2026-09-01',0)")
    await as(A, 'select close_month_ledger($1,$2,$3,$4)', ['2026-09-01', 6000, 0, opening])
    const month = (await as(A, "select actual_balance,closed_at from months where month='2026-09-01'")).rows[0]
    expect(Number(month.actual_balance)).toBe(6000)
    expect(month.closed_at).toBeNull()
  })

  it('rejects anon, negative/excessive set-aside, fractional cents and invalid month without creating rows', async () => {
    await expect(as(null, 'select close_month_ledger($1,$2,$3,$4)', ['2026-12-01', 100, 0, opening])).rejects.toThrow(/permission denied/)
    for (const values of [['2026-12-01',100,101], ['2026-12-01',-1,1], ['2026-12-01',1.001,0], ['2026-12-02',100,0], ['infinity',100,0]]) {
      await expect(as(A, 'select close_month_ledger($1,$2,$3,$4)', [...values,opening])).rejects.toThrow()
    }
    await expect(as(A, 'select close_month_ledger($1,$2,$3,$4)', ['2026-12-01',100,0,'infinity'])).rejects.toThrow()
    expect((await as(A, "select * from months where month='2026-12-01'")).rows).toEqual([])
  })
})
