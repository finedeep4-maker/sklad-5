/*
# 015 — Apartment norms management tools

Admin-only RPCs for per-apartment norm overrides:
  - apartment_norms_materialize: copy template rows into overrides (make independent)
  - apartment_norms_reset:       delete overrides (revert to template)
  - apartment_norms_copy:        copy effective norms between apartments

All functions: SECURITY DEFINER, admin-only, REVOKE FROM public/anon/authenticated, GRANT TO authenticated.
Returns jsonb with counts.
*/

-- ============================================================
-- 1. apartment_norms_materialize
-- ============================================================
CREATE OR REPLACE FUNCTION public.apartment_norms_materialize(
  p_apartment   int,
  p_norm_types  norm_type[] DEFAULT array['asset_standing','turnover_replenish','cleaning_consumption']::norm_type[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_apt_type  apt_type;
  v_count     int := 0;
  v_nt        norm_type;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Access denied' USING errcode = '42501';
  END IF;

  SELECT type INTO v_apt_type FROM apartments WHERE id = p_apartment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apartment not found: %', p_apartment USING errcode = 'P0002';
  END IF;

  FOREACH v_nt IN ARRAY p_norm_types LOOP
    INSERT INTO norm_rules (norm_type, apartment_id, apt_type, item_id, qty, note)
    SELECT v_nt, p_apartment, NULL, t.item_id, t.qty, t.note
    FROM norm_rules t
    WHERE t.apt_type = v_apt_type
      AND t.apartment_id IS NULL
      AND t.norm_type = v_nt
      AND NOT EXISTS (
        SELECT 1 FROM norm_rules o
        WHERE o.apartment_id = p_apartment
          AND o.norm_type = v_nt
          AND o.item_id = t.item_id
      )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
  END LOOP;

  RETURN jsonb_build_object('materialized', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.apartment_norms_materialize(int, norm_type[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartment_norms_materialize(int, norm_type[]) TO authenticated;

-- ============================================================
-- 2. apartment_norms_reset
-- ============================================================
CREATE OR REPLACE FUNCTION public.apartment_norms_reset(
  p_apartment   int,
  p_norm_types  norm_type[] DEFAULT array['asset_standing','turnover_replenish','cleaning_consumption']::norm_type[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Access denied' USING errcode = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM apartments WHERE id = p_apartment) THEN
    RAISE EXCEPTION 'apartment not found: %', p_apartment USING errcode = 'P0002';
  END IF;

  DELETE FROM norm_rules
  WHERE apartment_id = p_apartment
    AND norm_type = ANY(p_norm_types);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('reset', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.apartment_norms_reset(int, norm_type[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartment_norms_reset(int, norm_type[]) TO authenticated;

-- ============================================================
-- 3. apartment_norms_copy
-- ============================================================
CREATE OR REPLACE FUNCTION public.apartment_norms_copy(
  p_from        int,
  p_to          int[],
  p_norm_types  norm_type[] DEFAULT array['asset_standing','turnover_replenish','cleaning_consumption']::norm_type[],
  p_replace     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_type apt_type;
  v_target    int;
  v_tgt_type  apt_type;
  v_copied    int := 0;
  v_deleted   int := 0;
  v_inserted  int := 0;
  v_count     int;
  v_result    jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Access denied' USING errcode = '42501';
  END IF;

  IF array_length(p_to, 1) IS NULL THEN
    RAISE EXCEPTION 'no target apartments specified' USING errcode = '23514';
  END IF;
  IF array_length(p_to, 1) > 200 THEN
    RAISE EXCEPTION 'too many targets (max 200)' USING errcode = '23514';
  END IF;

  SELECT type INTO v_from_type FROM apartments WHERE id = p_from;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source apartment not found: %', p_from USING errcode = 'P0002';
  END IF;

  FOREACH v_target IN ARRAY p_to LOOP
    IF v_target = p_from THEN CONTINUE; END IF;

    SELECT type INTO v_tgt_type FROM apartments WHERE id = v_target;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'target apartment not found: %', v_target USING errcode = 'P0002';
    END IF;

    -- Source effective norms: overrides + template rows not overridden
    -- (computed directly, not via the view which filters by is_active_user)
    IF p_replace THEN
      -- Replace mode:
      -- 1. Upsert all source effective items into target overrides
      -- 2. For target template items absent in source, insert override with qty=0
      -- 3. Delete target overrides not in source effective set

      -- 1+2: upsert source items; insert qty=0 for template-only items
      INSERT INTO norm_rules (norm_type, apartment_id, apt_type, item_id, qty, note)
      SELECT src.norm_type, v_target, NULL, src.item_id, src.qty, src.note
      FROM (
        -- source overrides
        SELECT norm_type, item_id, qty, note
        FROM norm_rules
        WHERE apartment_id = p_from
          AND norm_type = ANY(p_norm_types)
        UNION ALL
        -- source template rows not overridden
        SELECT t.norm_type, t.item_id, t.qty, t.note
        FROM norm_rules t
        WHERE t.apt_type = v_from_type
          AND t.apartment_id IS NULL
          AND t.norm_type = ANY(p_norm_types)
          AND NOT EXISTS (
            SELECT 1 FROM norm_rules o
            WHERE o.apartment_id = p_from
              AND o.norm_type = t.norm_type
              AND o.item_id = t.item_id
          )
      ) src
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_inserted := v_inserted + v_count;

      -- For source items that are template-only (no override), update existing target overrides to match
      -- (upsert via separate update for existing overrides)
      UPDATE norm_rules tgt
      SET qty = src.qty, note = src.note
      FROM (
        SELECT t.norm_type, t.item_id, t.qty, t.note
        FROM norm_rules t
        WHERE t.apt_type = v_from_type
          AND t.apartment_id IS NULL
          AND t.norm_type = ANY(p_norm_types)
          AND NOT EXISTS (
            SELECT 1 FROM norm_rules o
            WHERE o.apartment_id = p_from
              AND o.norm_type = t.norm_type
              AND o.item_id = t.item_id
          )
      ) src
      WHERE tgt.apartment_id = v_target
        AND tgt.norm_type = src.norm_type
        AND tgt.item_id = src.item_id;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_copied := v_copied + v_count;

      -- 2b: insert qty=0 overrides for target template items absent in source
      INSERT INTO norm_rules (norm_type, apartment_id, apt_type, item_id, qty, note)
      SELECT tt.norm_type, v_target, NULL, tt.item_id, 0, NULL
      FROM norm_rules tt
      WHERE tt.apt_type = v_tgt_type
        AND tt.apartment_id IS NULL
        AND tt.norm_type = ANY(p_norm_types)
        AND NOT EXISTS (
          SELECT 1 FROM (
            -- source effective set
            SELECT norm_type, item_id FROM norm_rules WHERE apartment_id = p_from AND norm_type = ANY(p_norm_types)
            UNION ALL
            SELECT t.norm_type, t.item_id
            FROM norm_rules t
            WHERE t.apt_type = v_from_type
              AND t.apartment_id IS NULL
              AND t.norm_type = ANY(p_norm_types)
              AND NOT EXISTS (
                SELECT 1 FROM norm_rules o
                WHERE o.apartment_id = p_from
                  AND o.norm_type = t.norm_type
                  AND o.item_id = t.item_id
              )
          ) src
          WHERE src.norm_type = tt.norm_type AND src.item_id = tt.item_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM norm_rules o2
          WHERE o2.apartment_id = v_target
            AND o2.norm_type = tt.norm_type
            AND o2.item_id = tt.item_id
        )
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_inserted := v_inserted + v_count;

      -- 3: delete target overrides not in source effective set
      DELETE FROM norm_rules tgt
      WHERE tgt.apartment_id = v_target
        AND tgt.norm_type = ANY(p_norm_types)
        AND NOT EXISTS (
          SELECT 1 FROM (
            SELECT norm_type, item_id FROM norm_rules WHERE apartment_id = p_from AND norm_type = ANY(p_norm_types)
            UNION ALL
            SELECT t.norm_type, t.item_id
            FROM norm_rules t
            WHERE t.apt_type = v_from_type
              AND t.apartment_id IS NULL
              AND t.norm_type = ANY(p_norm_types)
              AND NOT EXISTS (
                SELECT 1 FROM norm_rules o
                WHERE o.apartment_id = p_from
                  AND o.norm_type = t.norm_type
                  AND o.item_id = t.item_id
              )
          ) src
          WHERE src.norm_type = tgt.norm_type AND src.item_id = tgt.item_id
        );

      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_deleted := v_deleted + v_count;

    ELSE
      -- Merge mode: upsert source effective items into target overrides, keep others
      INSERT INTO norm_rules (norm_type, apartment_id, apt_type, item_id, qty, note)
      SELECT src.norm_type, v_target, NULL, src.item_id, src.qty, src.note
      FROM (
        SELECT norm_type, item_id, qty, note
        FROM norm_rules
        WHERE apartment_id = p_from
          AND norm_type = ANY(p_norm_types)
        UNION ALL
        SELECT t.norm_type, t.item_id, t.qty, t.note
        FROM norm_rules t
        WHERE t.apt_type = v_from_type
          AND t.apartment_id IS NULL
          AND t.norm_type = ANY(p_norm_types)
          AND NOT EXISTS (
            SELECT 1 FROM norm_rules o
            WHERE o.apartment_id = p_from
              AND o.norm_type = t.norm_type
              AND o.item_id = t.item_id
          )
      ) src
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_inserted := v_inserted + v_count;

      -- Update existing target overrides with source values
      UPDATE norm_rules tgt
      SET qty = src.qty, note = src.note
      FROM (
        SELECT norm_type, item_id, qty, note
        FROM norm_rules
        WHERE apartment_id = p_from
          AND norm_type = ANY(p_norm_types)
        UNION ALL
        SELECT t.norm_type, t.item_id, t.qty, t.note
        FROM norm_rules t
        WHERE t.apt_type = v_from_type
          AND t.apartment_id IS NULL
          AND t.norm_type = ANY(p_norm_types)
          AND NOT EXISTS (
            SELECT 1 FROM norm_rules o
            WHERE o.apartment_id = p_from
              AND o.norm_type = t.norm_type
              AND o.item_id = t.item_id
          )
      ) src
      WHERE tgt.apartment_id = v_target
        AND tgt.norm_type = src.norm_type
        AND tgt.item_id = src.item_id;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_copied := v_copied + v_count;
    END IF;
  END LOOP;

  v_result := jsonb_build_object('targets', array_length(p_to, 1), 'copied', v_copied, 'inserted', v_inserted, 'deleted', v_deleted);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.apartment_norms_copy(int, int[], norm_type[], boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartment_norms_copy(int, int[], norm_type[], boolean) TO authenticated;

-- ============================================================
-- 4. Verification queries (run manually to confirm)
--
-- -- Functions exist
-- SELECT proname FROM pg_proc WHERE proname IN ('apartment_norms_materialize','apartment_norms_reset','apartment_norms_copy');
--
-- -- Privileges (all should return true)
-- SELECT has_function_privilege('authenticated','apartment_norms_materialize(int,norm_type[])','EXECUTE');
-- SELECT has_function_privilege('authenticated','apartment_norms_reset(int,norm_type[])','EXECUTE');
-- SELECT has_function_privilege('authenticated','apartment_norms_copy(int,int[],norm_type[],boolean)','EXECUTE');
--
-- -- Sample effective norms for one apartment
-- SELECT * FROM effective_norms WHERE apartment_id = 1 ORDER BY norm_type, item_id;
-- ============================================================
