-- Nullable evidence preserves the existing single-image ledger until each bill is updated.
-- OCR values are integer satang; raw recognized text is intentionally not persisted.
alter table public.month_entries
  add column receipts jsonb,
  add column receipt_mode text check (receipt_mode is null or receipt_mode in ('sum', 'each')),
  add column receipt_revision integer not null default 0 check (receipt_revision >= 0);

create function public.validate_month_entry_receipts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proof jsonb;
  proof_path text;
  proof_amount numeric;
  paths text[] := array[]::text[];
  proof_count integer := 0;
  total_amount numeric := 0;
  all_known boolean := true;
  each_matches boolean := true;
  changed boolean;
  check_payment boolean := false;
  item_kind text;
begin
  if new.receipts is not null then
    if jsonb_typeof(new.receipts) <> 'array' then
      raise exception 'receipt_invalid_evidence' using errcode = '23514';
    end if;
    for proof in select value from jsonb_array_elements(new.receipts) loop
      if jsonb_typeof(proof) <> 'object' then
        raise exception 'receipt_invalid_evidence' using errcode = '23514';
      end if;
      if not (proof ? 'path' and proof ? 'ocrAmount')
        or (select count(*) from jsonb_object_keys(proof)) <> 2
        or jsonb_typeof(proof -> 'path') <> 'string' then
        raise exception 'receipt_invalid_evidence' using errcode = '23514';
      end if;
      proof_path := proof ->> 'path';
      if length(proof_path) not between 1 and 200
        or split_part(proof_path, '/', 1) <> new.user_id::text
        or proof_path not like new.user_id::text || '/%'
        or proof_path = any(paths) then
        raise exception 'receipt_invalid_path' using errcode = '23514';
      end if;
      paths := array_append(paths, proof_path);
      proof_count := proof_count + 1;
      if jsonb_typeof(proof -> 'ocrAmount') = 'null' then
        all_known := false;
      elsif jsonb_typeof(proof -> 'ocrAmount') = 'number' then
        proof_amount := (proof ->> 'ocrAmount')::numeric;
        if proof_amount < 0 or proof_amount > 999999999 or proof_amount <> trunc(proof_amount) then
          raise exception 'receipt_invalid_amount' using errcode = '23514';
        end if;
        total_amount := total_amount + proof_amount;
        each_matches := each_matches and proof_amount = new.amount * 100;
      else
        raise exception 'receipt_invalid_amount' using errcode = '23514';
      end if;
    end loop;
    if new.receipt_path is distinct from (new.receipts -> 0 ->> 'path') then
      raise exception 'receipt_first_path_mismatch' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.receipt_revision <> 0 then
      raise exception 'receipt_invalid_revision' using errcode = '23514';
    end if;
    check_payment := new.paid;
  else
    changed := new.receipts is distinct from old.receipts
      or new.receipt_path is distinct from old.receipt_path
      or new.receipt_mode is distinct from old.receipt_mode;
    if changed then
      if new.receipt_revision = old.receipt_revision then
        -- Keep legacy receipt_path-only writers compatible while invalidating stale snapshots.
        new.receipt_revision := old.receipt_revision + 1;
      elsif new.receipt_revision <> old.receipt_revision + 1 then
        raise exception 'receipt_invalid_revision' using errcode = '23514';
      end if;
    elsif new.receipt_revision <> old.receipt_revision
      and new.receipt_revision <> old.receipt_revision + 1 then
      -- A successful OCR re-read may deliberately save identical evidence with one new revision.
      raise exception 'receipt_invalid_revision' using errcode = '23514';
    end if;
    -- Already-paid legacy rows remain readable/editable without rewriting their history.
    -- Any new payment, amount correction, or changed evidence must pass validation together.
    check_payment := new.paid and (not old.paid or new.amount is distinct from old.amount or changed);
  end if;

  if check_payment and (new.receipt_path is not null or proof_count > 0) then
    select kind into item_kind from public.recurring_items
      where id = new.item_id and user_id = new.user_id;
    if item_kind = 'expense' then
      if new.receipts is null or not all_known then
        raise exception 'receipt_payment_unreadable' using errcode = '23514';
      end if;
      if proof_count > 1 and new.receipt_mode is null then
        raise exception 'receipt_payment_mode_required' using errcode = '23514';
      end if;
      if (new.receipt_mode = 'each' and not each_matches)
        or (coalesce(new.receipt_mode, 'sum') = 'sum' and total_amount <> new.amount * 100) then
        raise exception 'receipt_payment_mismatch' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.validate_month_entry_receipts() from public, anon, authenticated;
create trigger validate_month_entry_receipts
  before insert or update on public.month_entries
  for each row execute function public.validate_month_entry_receipts();
