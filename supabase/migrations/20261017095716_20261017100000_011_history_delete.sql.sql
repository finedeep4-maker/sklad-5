/*
# 011 — History views expansion + admin delete RPCs + storage policy consolidation

## Overview
Expands sv_cleaning_events view with revision/audit/reverse columns and search_text.
Adds two new views (sv_cleaning_event_lines, sv_apartment_incidents).
Adds two admin-only SECURITY DEFINER RPCs for hard-deleting cleaning events and incidents
  with audit logging and file path return.
Consolidates incident-photos storage SELECT policies into a single is_active_user() policy.

## 1. Views
### sv_cleaning_events (replaced)
- Original 6 columns preserved in order: id, apartment_id, cleaned_at, status, note, staff_names
- New columns appended: revision, lead_staff_name, author_name, reversed_at,
  reversed_by_name, reverse_reason, search_text
- search_text = concat_ws(' ', author_name, lead_staff_name, staff_names, note,
  item names from current revision lines)
- Filter: is_active_user() preserved

### sv_cleaning_event_lines (new)
- Columns: event_id, item_id, item_name, norm_type, qty, base_unit
- Only lines where revision = parent event's revision
- Filter: is_active_user() on the parent event
- No unit_cost, no from_loc

### sv_apartment_incidents (new)
- Columns: id, apartment_id, created_at, kind, status, qty, item_name, free_text,
  comment, photo_paths, author_name, resolved_at, resolved_by_name, resolution_note,
  search_text
- search_text = concat_ws(' ', item_name, free_text, comment, resolution_note, author_name)
- No writeoff_move_id
- Filter: is_active_user()

## 2. Security
- GRANT SELECT on sv_cleaning_event_lines and sv_apartment_incidents to authenticated
- Storage: drop incident_photos_sv_read_own and incident_photos_notes_read SELECT policies,
  replace with single incident_photos_read_active (SELECT where is_active_user())
- incident_photos_admin (FOR ALL) left untouched
- incident_photos_sv_insert left untouched

## 3. RPCs (SECURITY DEFINER, search_path = public)
### delete_cleaning_event(p_event uuid, p_reason text) returns text[]
- Admin-only (is_admin() check, errcode 42501)
- p_reason required (non-empty, ≤500 chars)
- Writes audit_log before deleting (action='delete_cleaning_event', old_data=to_jsonb(row),
  new_data=jsonb_build_object('reason', p_reason))
- Physically deletes the cleaning_event row (cascade removes staff + lines)
- Does NOT touch stock_moves (journal is append-only)
- Returns text[] of media_paths (empty array — media_paths column not yet present)

### delete_incident(p_id uuid, p_reason text) returns text[]
- Admin-only (is_admin() check, errcode 42501)
- p_reason required (non-empty, ≤500 chars)
- Writes audit_log before deleting (action='delete_incident', old_data=to_jsonb(row),
  new_data=jsonb_build_object('reason', p_reason))
- Physically deletes the incident row (cascade removes attachments)
- Does NOT touch stock_moves (journal is append-only)
- Returns text[] combining incident.photo_paths and attachments.storage_path for the incident

## 4. Function privileges
- REVOKE ALL on both functions FROM public, anon, authenticated
- GRANT EXECUTE on both functions TO authenticated

## 5. Notes
- stock_moves are never modified — the journal is append-only by owner's decision
- cleaning_events.media_paths does not exist yet (will be added in migration 012);
  delete_cleaning_event returns an empty array until then
- All views use existing columns only — no schema changes to base tables
*/

-- ============================================================
-- 1. Replace sv_cleaning_events view
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
  ) AS search_text
FROM cleaning_events e
LEFT JOIN staff ls    ON ls.id = e.lead_staff_id
LEFT JOIN profiles p  ON p.id = e.created_by
LEFT JOIN profiles rb ON rb.id = e.reversed_by
WHERE is_active_user();

-- ============================================================
-- 2. New view: sv_cleaning_event_lines
-- ============================================================
CREATE OR REPLACE VIEW public.sv_cleaning_event_lines AS
SELECT
  cel.event_id,
  cel.item_id,
  i.name        AS item_name,
  cel.norm_type,
  cel.qty,
  i.base_unit
FROM cleaning_event_lines cel
JOIN cleaning_events e ON e.id = cel.event_id
LEFT JOIN items i ON i.id = cel.item_id
WHERE cel.revision = e.revision
  AND is_active_user();

-- ============================================================
-- 3. New view: sv_apartment_incidents
-- ============================================================
CREATE OR REPLACE VIEW public.sv_apartment_incidents AS
SELECT
  inc.id,
  inc.apartment_id,
  inc.created_at,
  inc.kind,
  inc.status,
  inc.qty,
  i.name     AS item_name,
  inc.free_text,
  inc.comment,
  inc.photo_paths,
  p.full_name AS author_name,
  inc.resolved_at,
  rp.full_name AS resolved_by_name,
  inc.resolution_note,
  concat_ws(' ',
    i.name,
    inc.free_text,
    inc.comment,
    inc.resolution_note,
    p.full_name
  ) AS search_text
FROM incidents inc
LEFT JOIN items i    ON i.id = inc.item_id
LEFT JOIN profiles p ON p.id = inc.created_by
LEFT JOIN profiles rp ON rp.id = inc.resolved_by
WHERE is_active_user();

-- ============================================================
-- 4. Grants on new views
-- ============================================================
GRANT SELECT ON public.sv_cleaning_event_lines TO authenticated;
GRANT SELECT ON public.sv_apartment_incidents TO authenticated;

-- ============================================================
-- 5. Storage policies: consolidate incident-photos SELECT
-- ============================================================
DROP POLICY IF EXISTS "incident_photos_sv_read_own" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_notes_read"  ON storage.objects;

CREATE POLICY "incident_photos_read_active"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'incident-photos'
  AND is_active_user()
);

-- incident_photos_admin (FOR ALL) and incident_photos_sv_insert are left untouched

-- ============================================================
-- 6. RPC: delete_cleaning_event
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_cleaning_event(p_event uuid, p_reason text)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row  cleaning_events;
  v_paths text[] := ARRAY[]::text[];
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

  -- media_paths column not yet present; return empty array (migration 012 will add it)
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

  RETURN v_paths;
END;
$$;

-- ============================================================
-- 7. RPC: delete_incident
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_incident(p_id uuid, p_reason text)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    incidents;
  v_paths  text[];
  v_attach text[];
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

  SELECT * INTO v_row FROM incidents WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident not found: %', p_id USING errcode = 'P0002';
  END IF;

  SELECT array_agg(storage_path) INTO v_attach
  FROM attachments
  WHERE incident_id = p_id;

  v_paths := array_coalesce(v_row.photo_paths, ARRAY[]::text[]) || COALESCE(v_attach, ARRAY[]::text[]);

  INSERT INTO audit_log (user_id, action, table_name, row_id, old_data, new_data)
  VALUES (
    auth.uid(),
    'delete_incident',
    'incidents',
    p_id::text,
    to_jsonb(v_row),
    jsonb_build_object('reason', p_reason)
  );

  DELETE FROM incidents WHERE id = p_id;

  RETURN v_paths;
END;
$$;

-- ============================================================
-- 8. Function privileges
-- ============================================================
REVOKE ALL ON FUNCTION public.delete_cleaning_event(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_incident(uuid, text)      FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.delete_cleaning_event(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_incident(uuid, text)      TO authenticated;

-- ============================================================
-- 9. Verification queries (run manually to confirm)
--
-- -- Function privileges
-- SELECT has_function_privilege('authenticated', 'delete_cleaning_event(uuid,text)', 'EXECUTE');
-- SELECT has_function_privilege('authenticated', 'delete_incident(uuid,text)', 'EXECUTE');
--
-- -- New views return rows
-- SELECT count(*) FROM sv_cleaning_events;
-- SELECT count(*) FROM sv_cleaning_event_lines;
-- SELECT count(*) FROM sv_apartment_incidents;
--
-- -- Storage policies for incident-photos
-- SELECT policyname, cmd, roles, qual
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'incident_photos%'
-- ORDER BY policyname;
-- ============================================================
