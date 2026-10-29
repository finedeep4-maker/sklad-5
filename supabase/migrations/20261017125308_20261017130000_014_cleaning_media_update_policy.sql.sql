-- 014 — Add UPDATE policy for cleaning-media storage bucket
-- Allows admin and supervisor (own folder) to overwrite files via upsert:true

DROP POLICY IF EXISTS "cleaning_media_update" ON storage.objects;

CREATE POLICY "cleaning_media_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'cleaning-media'
  AND (
    is_admin()
    OR (is_supervisor() AND (storage.foldername(name))[1] = auth.uid()::text)
  )
)
WITH CHECK (
  bucket_id = 'cleaning-media'
  AND (
    is_admin()
    OR (is_supervisor() AND (storage.foldername(name))[1] = auth.uid()::text)
  )
);

-- Verification:
-- SELECT policyname, cmd, roles, qual
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'cleaning_media%'
-- ORDER BY policyname;
-- Expected: cleaning_media_delete, cleaning_media_insert, cleaning_media_read, cleaning_media_update