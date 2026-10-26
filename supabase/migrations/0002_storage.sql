-- รูปสลิป: bucket private, path = {user_id}/{yyyy-mm}/{uuid}.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slips', 'slips', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy slips_own_select on storage.objects for select to authenticated
  using (bucket_id = 'slips' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy slips_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'slips' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy slips_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'slips' and (storage.foldername(name))[1] = (select auth.uid())::text);
