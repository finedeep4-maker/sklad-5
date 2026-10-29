/*
# 012 — Cleaning media: media_paths column, cleaning-media bucket, attach RPC, view + delete update

## Overview
Adds a media_paths text[] column to cleaning_events for storing photo/video file paths.
Creates a private storage bucket "cleaning-media" with 50 MB file size limit and image/video MIME types.
Adds storage policies for INSERT (admin or supervisor with uid prefix), SELECT (active user),
  and DELETE (admin only).
Adds an admin/supervisor RPC attach_cleaning_media to append paths to a cleaning event's media_paths
  with validation (max 6 paths, uid prefix, idempotent).
Updates sv_cleaning_events view to include media_paths at the end.
Updates delete_cleaning_event RPC to return the deleted row's media_paths.

## 1. Schema change
- cleaning_events.media_paths text[] NOT NULL DEFAULT '{}' — stores storage paths for
  photos/videos attached to a cleaning event

## 2. Storage bucket
- Bucket "cleaning-media" (private), file_size_limit 50 MB (52428800 bytes)
- allowed_mime_types: image/jpeg, image/png, image/webp, video/mp4, video/quicktime, video/webm

## 3. Storage policies (storage.objects, bucket_id = 'cleaning-media')
- cleaning_media_insert: INSERT for is_admin() OR (is_supervisor() AND path starts with auth.uid()::text || '/')
- cleaning_media_read: SELECT for is_active_user()
- cleaning_media_delete: DELETE for is_admin() only

## 4. RPC: attach_cleaning_media(p_client_op_id uuid, p_paths text[]) returns void
- SECURITY DEFINER, search_path = public
- Finds cleaning_events by client_op_id (raises if not found)
- Access: is_admin() OR (is_supervisor() AND created_by = auth.uid()), else errcode 42501
- Validates: total media_paths after append ≤ 6
- Each path must start with created_by::text || '/'
- Appends idempotently (no duplicates)

## 5. View update
- sv_cleaning_events: same 13 columns from 011 in same order, media_paths appended at end (position 14)

## 6. delete_cleaning_event update
- Now returns v_row.media_paths instead of empty array
- Otherwise identical to 011 (admin check, reason validation, audit_log, physical delete, no stock_moves)

## 7. Function privileges
- REVOKE ALL on attach_cleaning_media FROM public, anon, authenticated
- GRANT EXECUTE to authenticated
- delete_cleaning_event grants preserved (already granted in 011)
*/

-- ============================================================
-- 1. Add media_paths column
-- ============================================================
ALTER TABLE cleaning_events
  ADD COLUMN IF NOT EXISTS media_paths text[] NOT NULL DEFAULT '{}';

-- ============================================================
-- 2. Create cleaning-media bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cleaning-media',
  'cleaning-media',
  false,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 3. Storage policies for cleaning-media bucket
-- ============================================================
DROP POLICY IF EXISTS "cleaning_media_insert" ON storage.objects;
CREATE POLICY "cleaning_media_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'cleaning-media'
  AND (
    is_admin()
    OR (is_supervisor() AND (storage.foldername(name))[1] = auth.uid()::text)
  )
);

DROP POLICY IF EXISTS "cleaning_media_read" ON storage.objects;
CREATE POLICY "cleaning_media_read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'cleaning-media'
  AND is_active_user()
);

DROP POLICY IF EXISTS "cleaning_media_delete" ON storage.objects;
CREATE POLICY "cleaning_media_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'cleaning-media'
  AND is_admin()
);

-- ============================================================
-- 4. RPC: attach_cleaning_media
-- ============================================================
CREATE OR REPLACE FUNCTION public.attach_cleaning_media(p_client_op_id uuid, p_paths text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    cleaning_events;
  v_new    text[];
  v_path   text;
  v_prefix text;
  v_combined text[];
BEGIN
  SELECT * INTO v_row FROM cleaning_events WHERE client_op_id = p_client_op_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cleaning event not found by client_op_id: %', p_client_op_id USING errcode = 'P0002';
  END IF;

  IF NOT is_admin() AND NOT (is_supervisor() AND v_row.created_by = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied' USING errcode = '42501';
  END IF;

  v_prefix := v_row.created_by::text || '/';

  FOREACH v_path IN ARRAY p_paths LOOP
    IF v_path IS NULL OR position(v_prefix in v_path) <> 1 THEN
      RAISE EXCEPTION 'path must start with %: %', v_prefix, v_path USING errcode = '23514';
    END IF;
  END LOOP;

  -- idempotent: only paths not already in media_paths
  SELECT array_agg(p) INTO v_new
  FROM unnest(p_paths) AS p
  WHERE NOT (p = ANY(v_row.media_paths));

  IF v_new IS NOT NULL THEN
    v_combined := v_row.media_paths || v_new;
    IF array_length(v_combined, 1) > 6 THEN
      RAISE EXCEPTION 'media_paths cannot exceed 6 entries' USING errcode = '23514';
    END IF;
    UPDATE cleaning_events SET media_paths = v_combined WHERE id = v_row.id;
  END IF;
END;
$$;

-- ============================================================
-- 5. Function privileges for attach_cleaning_media
-- ============================================================
REVOKE ALL ON FUNCTION public.attach_cleaning_media(uuid, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_cleaning_media(uuid, text[]) TO authenticated;

-- ============================================================
-- 6. Update sv_cleaning_events view (add media_paths at end)
-- ============================================================
CREATE OR REPLACE VIEW public.sv_cleaning_events AS
SELECT
  e.id,
  e.apartment_id,
  e.cleaned_at,
  e.status,
  e.note,
  (
    SELECT string_agg(s.full_name, ', ' ORDER BY s.full_name)
    FROM cleaning_event_staff es
    JOIN staff s ON s.id = es.staff_id
    WHERE es.event_id = e.id
  ) AS staff_names,
  e.revision,
  ls.full_name AS lead_staff_name,
  p.full_name  AS author_name,
  e.reversed_at,
  rb.full_name AS reversed_by_name,
  e.reverse_reason,
  (
    SELECT concat_ws(' ',
      p.full_name,
      ls.full_name,
      (
        SELECT string_agg(s2.full_name, ', ' ORDER BY s2.full_name)
        FROM cleaning_event_staff es2
        JOIN staff s2 ON s2.id = es2.staff_id
        WHERE es2.event_id = e.id
      ),
      e.note,
      (
        SELECT string_agg(i.name, ', ' ORDER BY i.name)
        FROM cleaning_event_lines cel
        JOIN items i ON i.id = cel.item_id
        WHERE cel.event_id = e.id AND cel.revision = e.revision
      )
    )
  ) AS search_text,
  e.media_paths
FROM cleaning_events e
LEFT JOIN staff ls    ON ls.id = e.lead_staff_id
LEFT JOIN profiles p  ON p.id = e.created_by
LEFT JOIN profiles rb ON rb.id = e.reversed_by
WHERE is_active_user();

-- ============================================================
-- 7. Update delete_cleaning_event to return media_paths
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_cleaning_event(p_event uuid, p_reason text)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row cleaning_events;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Access denied' USING errcode = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason is required' USING errcode = '23514';
  END IF;
  IF length(p_reason) > 500 THEN
    RAISE EXCEPTION 'reason must be at most 500 characters' USING errcode = '23514';
  END IF;

  SELECT * INTO v_row FROM cleaning_events WHERE id = p_event;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cleaning event not found: %', p_event USING errcode = 'P0002';
  END IF;

  INSERT INTO audit_log (user_id, action, table_name, row_id, old_data, new_data)
  VALUES (
    auth.uid(),
    'delete_cleaning_event',
    'cleaning_events',
    p_event::text,
    to_jsonb(v_row),
    jsonb_build_object('reason', p_reason)
  );

  DELETE FROM cleaning_events WHERE id = p_event;

  RETURN v_row.media_paths;
END;
$$;

-- Preserve grants on delete_cleaning_event (re-apply to be safe)
REVOKE ALL ON FUNCTION public.delete_cleaning_event(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_cleaning_event(uuid, text) TO authenticated;

-- ============================================================
-- 8. Verification queries (run manually to confirm)
--
-- -- Column exists
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='cleaning_events' AND column_name='media_paths';
--
-- -- Bucket
-- SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'cleaning-media';
--
-- -- Storage policies
-- SELECT policyname, cmd, roles, qual
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'cleaning_media%'
-- ORDER BY policyname;
--
-- -- Function privileges
-- SELECT has_function_privilege('authenticated', 'attach_cleaning_media(uuid,text[])', 'EXECUTE');
-- SELECT has_function_privilege('authenticated', 'delete_cleaning_event(uuid,text)', 'EXECUTE');
--
-- -- View columns
-- SELECT column_name, ordinal_position FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='sv_cleaning_events' ORDER BY ordinal_position;
-- ============================================================
