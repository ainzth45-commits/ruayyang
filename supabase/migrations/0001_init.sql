-- Ledger: ตารางหลัก + RLS (ทุกแถวเป็นของ auth.uid() เท่านั้น)
-- เงิน numeric(12,2) · เดือน = date วันที่ 1 · วันที่รายการ = date ตามเวลาไทย

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  icon text not null default 'more' check (length(icon) <= 40),
  sort integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('income', 'expense')),
  default_amount numeric(12, 2) not null check (default_amount >= 0),
  is_estimate boolean not null default false,
  start_month date not null check (extract(day from start_month) = 1),
  end_month date check (extract(day from end_month) = 1),
  sort integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.months (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  actual_balance numeric(12, 2),
  created_at timestamptz not null default now(),
  primary key (user_id, month)
);

create table public.month_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null,
  month date not null check (extract(day from month) = 1),
  amount numeric(12, 2) not null check (amount >= 0),
  paid boolean not null default false,
  note text check (length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (user_id, item_id, month),
  -- composite FK: อ้างได้เฉพาะรายการของตัวเอง
  foreign key (user_id, item_id) references public.recurring_items (user_id, id) on delete cascade
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  category_id uuid,
  note text check (length(note) <= 200),
  slip_path text check (length(slip_path) <= 200),
  slip_hash text check (slip_hash ~ '^[0-9a-f]{64}$'),
  ocr_amount numeric(12, 2),
  created_at timestamptz not null default now(),
  unique (user_id, slip_hash),
  foreign key (user_id, category_id) references public.categories (user_id, id) on delete set null (category_id)
);

create index month_entries_user_month_idx on public.month_entries (user_id, month);
create index month_entries_item_idx on public.month_entries (user_id, item_id);
create index transactions_user_date_idx on public.transactions (user_id, date desc);
create index transactions_category_idx on public.transactions (user_id, category_id);

-- RLS
alter table public.categories enable row level security;
alter table public.recurring_items enable row level security;
alter table public.months enable row level security;
alter table public.month_entries enable row level security;
alter table public.transactions enable row level security;

create policy own_rows on public.categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.recurring_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.months for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.month_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.transactions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- anon ไม่ต้องแตะตารางเลย
revoke all on public.categories, public.recurring_items, public.months, public.month_entries, public.transactions from anon;
grant select, insert, update, delete on public.categories, public.recurring_items, public.months, public.month_entries, public.transactions to authenticated;
