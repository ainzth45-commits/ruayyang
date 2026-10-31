-- Keep payment evidence on the monthly bill, and cash-cycle ownership separate from calendar date.
alter table public.month_entries
  add column receipt_path text
    check (receipt_path is null or (
      length(receipt_path) between 1 and 200
      and split_part(receipt_path, '/', 1) = user_id::text
      and receipt_path like user_id::text || '/%'
    ));

alter table public.transactions
  add column cycle_month date check (cycle_month is null or (isfinite(cycle_month) and extract(day from cycle_month) = 1));
alter table public.savings
  add column cycle_month date check (cycle_month is null or (isfinite(cycle_month) and extract(day from cycle_month) = 1));

-- One function invocation is one transaction. The month upsert locks concurrent closes
-- for the same owner/month before touching its one set-aside saving.
create function public.close_month_ledger(
  p_month date,
  p_actual numeric,
  p_save numeric,
  p_closed_at timestamptz
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  closing_date date;
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_month is null or not isfinite(p_month) or extract(day from p_month) <> 1 or p_closed_at is null or not isfinite(p_closed_at) then
    raise exception 'Invalid month or closing timestamp' using errcode = '22023';
  end if;
  if p_actual is null or p_save is null
    or p_actual::text in ('NaN', 'Infinity', '-Infinity')
    or p_save::text in ('NaN', 'Infinity', '-Infinity')
    or abs(p_actual) > 9999999.99 or p_save < 0
    or p_actual <> trunc(p_actual, 2) or p_save <> trunc(p_save, 2)
    or p_save > greatest(p_actual, 0) then
    raise exception 'Invalid balance or set-aside amount' using errcode = '22023';
  end if;

  insert into public.months(user_id, month, actual_balance, closed_at)
    values (owner_id, p_month, p_actual, p_closed_at)
  on conflict (user_id, month) do update
    set actual_balance = excluded.actual_balance,
        closed_at = case
          when public.months.actual_balance is not null then public.months.closed_at
          else coalesce(public.months.closed_at, excluded.closed_at)
        end;

  closing_date := (p_month + interval '1 month' - interval '1 day')::date;
  if p_save = 0 then
    delete from public.savings
      where user_id = owner_id and date = closing_date and kind = 'close';
  else
    insert into public.savings(user_id, date, amount, note, kind, cycle_month)
      values (owner_id, closing_date, p_save, 'แยกเก็บตอนปิดเดือน', 'close', p_month)
    on conflict (user_id, date) where kind = 'close' do update
      set amount = excluded.amount, cycle_month = excluded.cycle_month;
  end if;
end;
$$;

revoke all on function public.close_month_ledger(date, numeric, numeric, timestamptz) from public, anon;
grant execute on function public.close_month_ledger(date, numeric, numeric, timestamptz) to authenticated;
