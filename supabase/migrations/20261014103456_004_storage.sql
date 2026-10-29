insert into storage.buckets (id, name, public) values
  ('receipts', 'receipts', false),
  ('incident-photos', 'incident-photos', false)
on conflict (id) do nothing;
create policy receipts_admin on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and public.is_admin())
  with check (bucket_id = 'receipts' and public.is_admin());
create policy incident_photos_admin on storage.objects for all to authenticated
  using (bucket_id = 'incident-photos' and public.is_admin())
  with check (bucket_id = 'incident-photos' and public.is_admin());
create policy incident_photos_sv_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'incident-photos' and public.is_supervisor()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy incident_photos_sv_read_own on storage.objects for select to authenticated
  using (bucket_id = 'incident-photos' and public.is_supervisor()
         and (storage.foldername(name))[1] = auth.uid()::text);