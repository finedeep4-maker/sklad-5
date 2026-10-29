/*
# Broaden storage upload/read policies for managers

## Problem
The QR module is accessible to admin, manager, and supervisor roles
(see qr-app.tsx canUseQr check). However, the storage INSERT and SELECT
policies on the `incident-photos` and `cleaning-media` buckets only
allowed `is_supervisor()` (plus admin). Managers could not upload
photos/videos for cleaning events or incidents, and could not read
their own uploaded media. This caused "Медиа не отправлено" errors
and broken images for managers using the QR app.

## Changes
- incident_photos_sv_insert: is_supervisor() -> is_active_user() (folder = uid)
- incident_photos_read_active: is_supervisor() -> is_active_user() (folder = uid)
- cleaning_media_insert: is_supervisor() -> is_active_user() (folder = uid)
- cleaning_media_read: is_supervisor() -> is_active_user() (folder = uid)
- cleaning_media_update: is_supervisor() -> is_active_user() (folder = uid)

## Security
The folder-prefix check (storage.foldername(name))[1] = auth.uid()::text
ensures a user can only upload to and read from their own folder.
Admins retain full access via is_admin(). No cross-user access is granted.
*/

-- incident-photos: INSERT — any active user, own folder only
DROP POLICY IF EXISTS "incident_photos_sv_insert" ON storage.objects;
CREATE POLICY "incident_photos_sv_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'incident-photos'
  AND is_active_user()
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- incident-photos: SELECT — admin or active user reading own folder
DROP POLICY IF EXISTS "incident_photos_read_active" ON storage.objects;
CREATE POLICY "incident_photos_read_active"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'incident-photos'
  AND (
    is_admin()
    OR (is_active_user() AND (storage.foldername(name))[1] = auth.uid()::text)
  )
);

-- cleaning-media: INSERT — any active user, own folder only
DROP POLICY IF EXISTS "cleaning_media_insert" ON storage.objects;
CREATE POLICY "cleaning_media_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'cleaning-media'
  AND (
    is_admin()
    OR (is_active_user() AND (storage.foldername(name))[1] = auth.uid()::text)
  )
);

-- cleaning-media: SELECT — admin or active user reading own folder
DROP POLICY IF EXISTS "cleaning_media_read" ON storage.objects;
CREATE POLICY "cleaning_media_read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'cleaning-media'
  AND (
    is_admin()
    OR (is_active_user() AND (storage.foldername(name))[1] = auth.uid()::text)
  )
);

-- cleaning-media: UPDATE — admin or active user on own folder
DROP POLICY IF EXISTS "cleaning_media_update" ON storage.objects;
CREATE POLICY "cleaning_media_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'cleaning-media'
  AND (
    is_admin()
    OR (is_active_user() AND (storage.foldername(name))[1] = auth.uid()::text)
  )
)
WITH CHECK (
  bucket_id = 'cleaning-media'
  AND (
    is_admin()
    OR (is_active_user() AND (storage.foldername(name))[1] = auth.uid()::text)
  )
);
