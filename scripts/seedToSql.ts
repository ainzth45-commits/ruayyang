// private/seed.json → SQL สำหรับนำเข้า Supabase ครั้งเดียว (รันเป็น postgres ผ่าน SQL editor/MCP)
// ใช้:  node scripts/seedToSql.ts private/seed.json <user-uuid> > private/import.sql
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Seed } from '../src/domain/plan'

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const month = (m: string) => q(`${m}-01`)
const money = (v: string) => {
  if (!/^-?\d+(\.\d{1,2})?$/.test(v)) throw new Error(`จำนวนเงินไม่ถูกต้อง: ${v}`)
  return v
}

export function seedToSql(seed: Seed, userId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('user id ต้องเป็น uuid')
  const uid = q(userId)
  const items: string[] = []
  const entries: string[] = []
  for (const it of seed.items) {
    const id = randomUUID()
    items.push(
      `(${q(id)}, ${uid}, ${q(it.name)}, ${q(it.kind)}, ${money(it.default_amount)}, ${it.is_estimate}, ${month(it.start_month)}, ${it.end_month ? month(it.end_month) : 'null'}, ${it.sort})`,
    )
    for (const [m, amount] of Object.entries(it.entries)) {
      entries.push(`(${uid}, ${q(id)}, ${month(m)}, ${money(amount)}, ${m <= seed.paid_until})`)
    }
  }
  const months = seed.months.map((m) => `(${uid}, ${month(m.month)}, ${m.actual_balance === null ? 'null' : money(m.actual_balance)})`)
  return [
    'begin;',
    `do $$ begin if exists (select 1 from public.recurring_items where user_id = ${uid}) then raise exception 'มีข้อมูลอยู่แล้ว ไม่นำเข้าซ้ำ'; end if; end $$;`,
    `insert into public.recurring_items (id, user_id, name, kind, default_amount, is_estimate, start_month, end_month, sort) values\n${items.join(',\n')};`,
    `insert into public.month_entries (user_id, item_id, month, amount, paid) values\n${entries.join(',\n')};`,
    `insert into public.months (user_id, month, actual_balance) values\n${months.join(',\n')};`,
    'commit;',
    '',
  ].join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, userId] = process.argv.slice(2)
  if (!file || !userId) {
    console.error('ใช้: node scripts/seedToSql.ts private/seed.json <user-uuid>')
    process.exit(1)
  }
  process.stdout.write(seedToSql(JSON.parse(readFileSync(file, 'utf8')) as Seed, userId))
}
