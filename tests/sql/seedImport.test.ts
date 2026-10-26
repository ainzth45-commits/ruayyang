// นำเข้า seed จริงด้วย SQL ที่จะใช้กับ Supabase แล้วตรวจคงเหลือกับชีต (ข้ามถ้าไม่มี private/seed.json)
import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { seedToSql } from '../../scripts/seedToSql'
import type { Seed } from '../../src/domain/plan'

const U = '33333333-3333-3333-3333-333333333333'
const seedPath = new URL('../../private/seed.json', import.meta.url)
const mig = (f: string) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')
const STUB = `
create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
insert into auth.users values ('${U}');`

describe.skipIf(!existsSync(seedPath))('seedToSql บน Postgres', () => {
  it('คงเหลือทุกเดือนตรงกับชีต และกันนำเข้าซ้ำ', async () => {
    const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as Seed & { expected_remaining: Record<string, string> }
    const db = new PGlite()
    await db.exec(STUB)
    await db.exec(mig('0001_init.sql'))
    await db.exec(mig('0003_category_unique.sql'))
    await db.exec(mig('0004_budget_savings.sql')) // import ต้องใช้ได้กับ schema ล่าสุด
    const sql = seedToSql(seed, U)
    await db.exec(sql)
    const r = await db.query<{ month: string; remaining: string }>(`
      select to_char(m.month, 'YYYY-MM') as month,
             (coalesce(sum(e.amount) filter (where i.kind = 'income'), 0)
              - coalesce(sum(e.amount) filter (where i.kind = 'expense'), 0))::text as remaining
      from months m
      left join month_entries e on e.user_id = m.user_id and e.month = m.month
      left join recurring_items i on i.id = e.item_id
      group by m.month order by m.month`)
    expect(r.rows).toHaveLength(seed.months.length)
    for (const row of r.rows) expect(Number(row.remaining), row.month).toBeCloseTo(Number(seed.expected_remaining[row.month]), 2)
    await expect(db.exec(sql)).rejects.toThrow(/มีข้อมูลอยู่แล้ว/)
  }, 30_000) // PGlite ช้าเมื่อรันพร้อมไฟล์อื่น
})
