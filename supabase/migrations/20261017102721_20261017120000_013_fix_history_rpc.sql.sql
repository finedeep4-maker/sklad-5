/*
# 013 — Fix delete_incident array_coalesce bug + attach_cleaning_media NULL-safety

## 1. delete_incident(p_id uuid, p_reason text) returns text[]
- 011 used array_coalesce() which does not exist in PostgreSQL → runtime error on every call.
- Replace with: COALESCE(v_row.photo_paths, '{}'::text[]) || COALESCE(v_attach, '{}'::text[])
- Everything else identical to 011: admin check, reason validation, audit_log, physical delete, returns text[].
- Privileges: REVOKE ALL FROM public, anon, authenticated; GRANT EXECUTE TO authenticated.

## 2. attach_cleaning_media(p_client_op_id uuid, p_paths text[]) returns void
- 012 FOREACH loops over p_paths; if p_paths is NULL the function raises "FOREACH over a null array".
- Add early RETURN when p_paths IS NULL or array_length = 0.
- Everything else identical to 012. Privileges same.

## 3. Verification (commented at end)
- pg_get_functiondef for delete_incident must NOT contain 'array_coalesce'.
- has_function_privilege for delete_incident, delete_cleaning_event, attach_cleaning_media.
*/

-- ============================================================
-- 1. Replace delete_incident — fix array_coalesce bug
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

  v_paths := COALESCE(v_row.photo_paths, '{}'::text[]) || COALESCE(v_attach, '{}'::text[]);

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
-- 2. Replace attach_cleaning_media — NULL/empty p_paths safety
-- ============================================================
CREATE OR REPLACE FUNCTION public.attach_cleaning_media(p_client_op_id uuid, p_paths text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      cleaning_events;
  v_new      text[];
  v_path     text;
  v_prefix   text;
  v_combined text[];
BEGIN
  IF p_paths IS NULL OR array_length(p_paths, 1) IS NULL THEN
    RETURN;
  END IF;

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
-- 3. Function privileges
-- ============================================================
REVOKE ALL ON FUNCTION public.delete_incident(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_incident(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.attach_cleaning_media(uuid, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_cleaning_media(uuid, text[]) TO authenticated;

-- ============================================================
-- 4. Verification queries (run manually to confirm)
--
-- -- delete_incident no longer contains array_coalesce
-- SELECT pg_get_functiondef('public.delete_incident(uuid, text)'::regprocedure) NOT LIKE '%array_coalesce%' AS fixed;
--
-- -- Function privileges (all should return true)
-- SELECT has_function_privilege('authenticated', 'delete_incident(uuid,text)', 'EXECUTE');
-- SELECT has_function_privilege('authenticated', 'delete_cleaning_event(uuid,text)', 'EXECUTE');
-- SELECT has_function_privilege('authenticated', 'attach_cleaning_media(uuid,text[])', 'EXECUTE');
-- ============================================================
