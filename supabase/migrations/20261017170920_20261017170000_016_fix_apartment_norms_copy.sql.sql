/*
# 016 — Fix apartment_norms_copy and apartment_norms_materialize

Same signatures as 015. SECURITY DEFINER, SET search_path = public, is_admin() check,
REVOKE ALL FROM public/anon/authenticated, GRANT EXECUTE TO authenticated.

materialize: accumulate ROW_COUNT across norm types (v_total += ROW_COUNT).
copy: src = effective source set (overrides UNION template rows not overridden).
  replace: (a) DELETE overrides not in src → (b) UPSERT src → (c) INSERT qty=0 for absent template items.
  merge: only (b).
Return jsonb: targets, upserted, zeroed, deleted (accumulated).

Partial unique index: norm_rules_apt ON (norm_type, apartment_id, item_id) WHERE apt_type IS NULL.
*/

-- ============================================================
-- 1. apartment_norms_materialize (fixed: accumulate counter)
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
  v_total     int := 0;
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
    v_total := v_total + v_count;
  END LOOP;

  RETURN jsonb_build_object('materialized', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.apartment_norms_materialize(int, norm_type[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartment_norms_materialize(int, norm_type[]) TO authenticated;

-- ============================================================
-- 2. apartment_norms_reset (unchanged, re-created for completeness)
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
-- 3. apartment_norms_copy (fixed replace + merge modes)
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
  v_upserted  int := 0;
  v_zeroed    int := 0;
  v_deleted   int := 0;
  v_count     int;
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
  IF array_length(p_norm_types, 1) IS NULL THEN
    RAISE EXCEPTION 'no norm types specified' USING errcode = '23514';
  END IF;

  SELECT type INTO v_from_type FROM apartments WHERE id = p_from;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source apartment not found: %', p_from USING errcode = 'P0002';
  END IF;

  -- Build source effective set once
  DROP TABLE IF EXISTS pg_temp.src_effective;
  CREATE TEMP TABLE src_effective (
    norm_type norm_type,
    item_id   int,
    qty       numeric(14,3),
    note      text
  ) ON COMMIT DROP;

  INSERT INTO src_effective (norm_type, item_id, qty, note)
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
    );

  FOREACH v_target IN ARRAY p_to LOOP
    IF v_target = p_from THEN CONTINUE; END IF;

    SELECT type INTO v_tgt_type FROM apartments WHERE id = v_target;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'target apartment not found: %', v_target USING errcode = 'P0002';
    END IF;

    IF p_replace THEN
      -- (a) Delete target overrides not in source effective set
      DELETE FROM norm_rules tgt
      WHERE tgt.apartment_id = v_target
        AND tgt.norm_type = ANY(p_norm_types)
        AND NOT EXISTS (
          SELECT 1 FROM src_effective src
          WHERE src.norm_type = tgt.norm_type
            AND src.item_id = tgt.item_id
        );

      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_deleted := v_deleted + v_count;

      -- (b) Upsert source effective rows into target overrides
      INSERT INTO norm_rules (norm_type, apartment_id, apt_type, item_id, qty, note)
      SELECT src.norm_type, v_target, NULL, src.item_id, src.qty, src.note
      FROM src_effective src
      ON CONFLICT (norm_type, apartment_id, item_id) WHERE apt_type IS NULL
      DO UPDATE SET qty = EXCLUDED.qty, note = EXCLUDED.note;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_upserted := v_upserted + v_count;

      -- (c) Insert qty=0 for target template items absent in source and not already overridden
      INSERT INTO norm_rules (norm_type, apartment_id, apt_type, item_id, qty, note)
      SELECT tt.norm_type, v_target, NULL, tt.item_id, 0, NULL
      FROM norm_rules tt
      WHERE tt.apt_type = v_tgt_type
        AND tt.apartment_id IS NULL
        AND tt.norm_type = ANY(p_norm_types)
        AND NOT EXISTS (
          SELECT 1 FROM src_effective src
          WHERE src.norm_type = tt.norm_type
            AND src.item_id = tt.item_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM norm_rules o2
          WHERE o2.apartment_id = v_target
            AND o2.norm_type = tt.norm_type
            AND o2.item_id = tt.item_id
        )
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_zeroed := v_zeroed + v_count;

    ELSE
      -- Merge mode: only upsert
      INSERT INTO norm_rules (norm_type, apartment_id, apt_type, item_id, qty, note)
      SELECT src.norm_type, v_target, NULL, src.item_id, src.qty, src.note
      FROM src_effective src
      ON CONFLICT (norm_type, apartment_id, item_id) WHERE apt_type IS NULL
      DO UPDATE SET qty = EXCLUDED.qty, note = EXCLUDED.note;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_upserted := v_upserted + v_count;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'targets', array_length(p_to, 1),
    'upserted', v_upserted,
    'zeroed', v_zeroed,
    'deleted', v_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apartment_norms_copy(int, int[], norm_type[], boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartment_norms_copy(int, int[], norm_type[], boolean) TO authenticated;
