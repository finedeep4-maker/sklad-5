/*
# Гарантировать бакет cleaning-media и его политики

1. Проблема
- В приложении ошибка «Bucket not found» при отправке медиа уборки: в базе нет бакета cleaning-media
  (миграция 012 не применена к этому проекту Supabase).

2. Изменения
- Идемпотентно создаёт/обновляет бакет cleaning-media (private, 50 МБ, image/video).
- Добавляет колонку cleaning_events.media_paths, если её нет.
- Пересоздаёт политики storage.objects для cleaning-media в итоговом виде (как в broaden_storage_for_managers).

3. Безопасность
- Загрузка и чтение: админ или активный пользователь только в своей папке (uid/...).
- Удаление: только админ. Анонимного доступа нет.

4. Важно
- Миграция не создаёт RPC attach_cleaning_media; он должен существовать (миграции 012/013).
*/
alter table public.cleaning_events
  add column if not exists media_paths text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cleaning-media', 'cleaning-media', false, 52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "cleaning_media_insert" on storage.objects;
create policy "cleaning_media_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'cleaning-media'
  and (public.is_admin() or (public.is_active_user() and (storage.foldername(name))[1] = auth.uid()::text))
);

drop policy if exists "cleaning_media_read" on storage.objects;
create policy "cleaning_media_read" on storage.objects for select to authenticated
using (
  bucket_id = 'cleaning-media'
  and (public.is_admin() or (public.is_active_user() and (storage.foldername(name))[1] = auth.uid()::text))
);

drop policy if exists "cleaning_media_update" on storage.objects;
create policy "cleaning_media_update" on storage.objects for update to authenticated
using (
  bucket_id = 'cleaning-media'
  and (public.is_admin() or (public.is_active_user() and (storage.foldername(name))[1] = auth.uid()::text))
)
with check (
  bucket_id = 'cleaning-media'
  and (public.is_admin() or (public.is_active_user() and (storage.foldername(name))[1] = auth.uid()::text))
);

drop policy if exists "cleaning_media_delete" on storage.objects;
create policy "cleaning_media_delete" on storage.objects for delete to authenticated
using (bucket_id = 'cleaning-media' and public.is_admin());
