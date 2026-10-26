// รัน migration จริงบน PGlite (Postgres ใน WASM) + stub ส่วนของ Supabase (auth, storage, roles)
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const mig = (f: string) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')

const SUPABASE_STUB = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
insert into auth.users values ('${A}'), ('${B}');
`

let db: PGlite

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false);`)
  await db.exec(user ? 'set role authenticated' : 'set role anon')
  try {
    return await db.query<Record<string, unknown>>(sql, params)
  } finally {
    await db.exec('reset role')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  await db.exec(mig('0001_init.sql'))
  await db.exec(mig('0002_storage.sql'))
  await db.exec(mig('0003_category_unique.sql'))
  await db.exec(mig('0004_budget_savings.sql'))
})

describe('RLS', () => {
  it('user sees only own rows; user_id defaults to auth.uid()', async () => {
    await as(A, `insert into categories (name) values ('อาหาร A')`)
    await as(B, `insert into categories (name) values ('อาหาร B')`)
    const a = await as(A, 'select name, user_id from categories')
    expect(a.rows).toEqual([{ name: 'อาหาร A', user_id: A }])
  })

  it('cannot insert a row for someone else', async () => {
    await expect(as(A, `insert into categories (user_id, name) values ('${B}', 'แอบใส่')`)).rejects.toThrow(/row-level security/)
  })

  it('cannot update/delete others (silently 0 rows)', async () => {
    const r = await as(A, `update categories set name = 'hacked' where name = 'อาหาร B'`)
    expect(r.affectedRows).toBe(0)
    const d = await as(A, `delete from categories where name = 'อาหาร B'`)
    expect(d.affectedRows).toBe(0)
    expect((await as(B, 'select name from categories')).rows).toEqual([{ name: 'อาหาร B' }])
  })

  it('anon sees nothing and cannot write', async () => {
    await expect(as(null, 'select * from categories')).rejects.toThrow(/permission denied/)
    await expect(as(null, `insert into months (month) values ('2026-10-01')`)).rejects.toThrow(/permission denied/)
  })

  it('month_entries cannot reference another user item (composite FK)', async () => {
    const itemB = (await as(B, `insert into recurring_items (name, kind, default_amount, start_month) values ('เงินเดือน', 'income', 20000, '2026-01-01') returning id`)).rows[0].id
    await expect(as(A, `insert into month_entries (item_id, month, amount) values ($1, '2026-10-01', 1)`, [itemB])).rejects.toThrow(/foreign key/)
  })

  it('transactions cannot use another user category', async () => {
    const catB = (await as(B, `select id from categories`)).rows[0].id
    await expect(as(A, `insert into transactions (date, amount, category_id) values ('2026-10-22', 50, $1)`, [catB])).rejects.toThrow(/foreign key/)
  })
})

describe('constraints', () => {
  it('rejects non-first-of-month, negative and zero amounts, bad hash', async () => {
    await expect(as(A, `insert into months (month) values ('2026-10-15')`)).rejects.toThrow(/check/)
    await expect(as(A, `insert into transactions (date, amount) values ('2026-10-22', 0)`)).rejects.toThrow(/check/)
    await expect(as(A, `insert into transactions (date, amount, slip_hash) values ('2026-10-22', 10, 'abc')`)).rejects.toThrow(/check/)
    await expect(as(A, `insert into categories (name) values ('   ')`)).rejects.toThrow(/check/)
  })

  it('duplicate slip hash per user rejected, other user allowed', async () => {
    const h = 'a'.repeat(64)
    await as(A, `insert into transactions (date, amount, slip_hash) values ('2026-10-22', 10, $1)`, [h])
    await expect(as(A, `insert into transactions (date, amount, slip_hash) values ('2026-10-22', 10, $1)`, [h])).rejects.toThrow(/duplicate key/)
    await as(B, `insert into transactions (date, amount, slip_hash) values ('2026-10-22', 10, $1)`, [h])
  })

  it('upsert ignore-duplicates on month_entries keeps original', async () => {
    const item = (await as(A, `insert into recurring_items (name, kind, default_amount, start_month) values ('ค่าเน็ต', 'expense', 456.78, '2026-01-01') returning id`)).rows[0].id
    await as(A, `insert into month_entries (item_id, month, amount) values ($1, '2026-10-01', 456.78)`, [item])
    await as(A, `insert into month_entries (item_id, month, amount) values ($1, '2026-10-01', 1) on conflict (user_id, item_id, month) do nothing`, [item])
    const r = await as(A, `select amount::text from month_entries where item_id = $1`, [item])
    expect(r.rows).toEqual([{ amount: '456.78' }])
  })

  it('deleting a category keeps the transaction (category_id → null)', async () => {
    const cat = (await as(A, `insert into categories (name) values ('ชั่วคราว') returning id`)).rows[0].id
    await as(A, `insert into transactions (date, amount, category_id) values ('2026-10-21', 99, $1)`, [cat])
    await as(A, `delete from categories where id = $1`, [cat])
    const r = await as(A, `select category_id, user_id from transactions where amount = 99`)
    expect(r.rows).toEqual([{ category_id: null, user_id: A }])
  })
})

describe('storage policies', () => {
  it('only own folder in slips bucket', async () => {
    await as(A, `insert into storage.objects (bucket_id, name) values ('slips', '${A}/2026-10/x.jpg')`)
    await expect(as(A, `insert into storage.objects (bucket_id, name) values ('slips', '${B}/2026-10/x.jpg')`)).rejects.toThrow(/row-level security/)
    await expect(as(A, `insert into storage.objects (bucket_id, name) values ('other', '${A}/x.jpg')`)).rejects.toThrow(/row-level security/)
    expect((await as(B, `select name from storage.objects`)).rows).toEqual([])
    expect((await as(A, `select name from storage.objects`)).rows).toHaveLength(1)
  })
})

describe('0004 budget / closing / savings', () => {
  it('months: new columns, budget must not be negative', async () => {
    await as(A, `insert into months (month, spend_budget, closed_at) values ('2026-11-01', 6000, now())`)
    await expect(as(A, `insert into months (month, spend_budget) values ('2026-12-01', -1)`)).rejects.toThrow(/check/)
    const r = await as(A, `select spend_budget::text from months where month = '2026-11-01'`)
    expect(r.rows).toEqual([{ spend_budget: '6000.00' }])
  })

  it('savings: own rows only, amount > 0, known kinds, one close per day', async () => {
    await as(A, `insert into savings (date, amount, kind) values ('2026-10-31', 3000, 'close')`)
    await expect(as(A, `insert into savings (date, amount, kind) values ('2026-10-31', 1, 'close')`)).rejects.toThrow(/duplicate key/)
    await as(A, `insert into savings (date, amount) values ('2026-10-31', 1)`) // deposit วันเดียวกันได้
    await as(B, `insert into savings (date, amount, kind) values ('2026-10-31', 5, 'close')`) // คนละ user ได้
    await expect(as(A, `insert into savings (date, amount) values ('2026-10-01', 0)`)).rejects.toThrow(/check/)
    await expect(as(A, `insert into savings (date, amount, kind) values ('2026-10-01', 1, 'withdraw')`)).rejects.toThrow(/check/)
    await expect(as(A, `insert into savings (user_id, date, amount) values ('${B}', '2026-10-01', 1)`)).rejects.toThrow(/row-level security/)
    expect((await as(B, 'select amount::text, kind from savings')).rows).toEqual([{ amount: '5.00', kind: 'close' }])
    expect((await as(A, `update savings set amount = 9 where user_id = '${B}'`)).affectedRows).toBe(0)
    await expect(as(null, 'select * from savings')).rejects.toThrow(/permission denied/)
  })

  it('user_settings: one row per user, own only, opening >= 0', async () => {
    await as(A, `insert into user_settings (savings_opening) values (25000)`)
    await expect(as(A, `insert into user_settings (savings_opening) values (1)`)).rejects.toThrow(/duplicate key/)
    await expect(as(A, `update user_settings set savings_opening = -1`)).rejects.toThrow(/check/)
    await as(A, `insert into user_settings (savings_opening) values (30000) on conflict (user_id) do update set savings_opening = excluded.savings_opening`)
    expect((await as(A, 'select savings_opening::text from user_settings')).rows).toEqual([{ savings_opening: '30000.00' }])
    expect((await as(B, 'select * from user_settings')).rows).toEqual([])
    await expect(as(null, 'select * from user_settings')).rejects.toThrow(/permission denied/)
  })
})
