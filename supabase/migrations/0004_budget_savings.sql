-- รอบ 2: งบใช้จ่ายรายเดือน + ปิดเดือน + เงินเก็บ (เพิ่มอย่างเดียว ไม่แตะข้อมูลเดิม)
alter table public.months
  add column spend_budget numeric(12, 2) check (spend_budget >= 0),
  add column closed_at timestamptz;

create table public.savings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  note text check (length(note) <= 200),
  kind text not null default 'deposit' check (kind in ('deposit', 'close')),
  created_at timestamptz not null default now()
);
create index savings_user_date_idx on public.savings (user_id, date desc);
-- แยกเก็บตอนปิดเดือนได้เดือนละ 1 รายการ (ลงวันสุดท้ายของเดือนเสมอ)
create unique index savings_one_close_idx on public.savings (user_id, date) where kind = 'close';

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  savings_opening numeric(12, 2) not null default 0 check (savings_opening >= 0),
  updated_at timestamptz not null default now()
);

alter table public.savings enable row level security;
alter table public.user_settings enable row level security;
create policy own_rows on public.savings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.savings, public.user_settings from anon;
grant select, insert, update, delete on public.savings, public.user_settings to authenticated;
