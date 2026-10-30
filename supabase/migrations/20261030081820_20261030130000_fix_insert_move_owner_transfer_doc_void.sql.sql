/*
# Fix _insert_move: allow warehouse for owner_transfer and doc_void

## Problem
The `transfer_company_owner` function moves assets between the company warehouse
and `owner_stock(X)`. The `void_document` function reverses those moves with
`source_type = 'doc_void'`. Both source types need the warehouse exception
in `_insert_move`'s owner-asset movement rules.

## Fix
Allow warehouse as a from/to location for owner assets when
`p_src in ('owner_transfer', 'doc_void')`. This is safe because:
- `owner_transfer` is only used by the admin-only `transfer_company_owner` function
- `doc_void` only reverses moves that were previously valid (void_document checks
  the document is posted before reversing)

## Security
- Function remains SECURITY DEFINER, search_path = public
- REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated
- No new tables or columns
*/

CREATE OR REPLACE FUNCTION _insert_move(
  p_item integer,
  p_from integer,
  p_to integer,
  p_qty numeric,
  p_cost numeric,
  p_src text,
  p_src_id text,
  p_apt integer,
  p_staff integer,
  p_doc uuid,
  p_note text,
  p_moved timestamp with time zone,
  p_reverses bigint
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
declare
  v bigint;
  v_cost numeric := p_cost;
  v_from_type loc_type; v_to_type loc_type;
  v_owner_from int; v_owner_to int; v_owner int;
  v_item_kind item_kind;
  v_warehouse_ok boolean;
begin
  select type into v_from_type from locations where id = p_from;
  select type into v_to_type   from locations where id = p_to;
  select c.kind into v_item_kind
  from items i join categories c on c.id = i.category_id
  where i.id = p_item;

  v_owner_from := _loc_owner(p_from, p_item);
  v_owner_to   := _loc_owner(p_to,   p_item);

  -- warehouse is allowed as from/to for owner assets when reversing or doing owner transfers
  v_warehouse_ok := p_src in ('owner_transfer', 'doc_void');

  -- owner movement rules apply only to assets
  if v_item_kind = 'asset' then
    if v_owner_from is not null or v_owner_to is not null then
      -- determine the "home" apartment of this asset
      if v_owner_from is not null and v_owner_to is not null and v_owner_from <> v_owner_to then
        raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
      end if;
      v_owner := coalesce(v_owner_from, v_owner_to);

      -- allowed destinations for an owner asset: source, owner_stock(X), apartment X, sink
      -- EXCEPTION: warehouse is also allowed for owner_transfer and doc_void
      if v_to_type not in ('source','sink')
      and not (v_to_type = 'owner_stock' and _loc_owner_stock(v_owner) = p_to)
      and not (v_to_type = 'apartment' and p_to = _loc_apartment(v_owner))
      and not (v_warehouse_ok and v_to_type = 'warehouse') then
        raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
      end if;
      if v_from_type not in ('source','sink')
      and not (v_from_type = 'owner_stock' and _loc_owner_stock(v_owner) = p_from)
      and not (v_from_type = 'apartment' and p_from = _loc_apartment(v_owner))
      and not (v_warehouse_ok and v_from_type = 'warehouse') then
        raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
      end if;
    end if;
  else
    -- consumables: never into owner_stock
    if v_to_type = 'owner_stock' then
      raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
    end if;
  end if;

  v_owner := coalesce(v_owner_from, v_owner_to);

  -- cost for writeoffs without explicit price
  if v_cost is null and p_reverses is null and v_to_type = 'sink' then
    if v_owner is not null then
      v_cost := owner_avg_cost(p_item, v_owner);
    else
      v_cost := avg_cost(p_item);
    end if;
  end if;

  insert into stock_moves(item_id, from_loc, to_loc, qty, unit_cost, source_type, source_id,
    apartment_id, staff_id, doc_id, note, moved_at, reverses_id, owner_apartment_id)
  values (p_item, p_from, p_to, p_qty, v_cost, p_src, p_src_id, p_apt, p_staff, p_doc, p_note,
    coalesce(p_moved, now()), p_reverses, v_owner)
  returning id into v;
  return v;
end $function$;

REVOKE ALL ON FUNCTION _insert_move(integer, integer, integer, numeric, numeric, text, text, integer, integer, uuid, text, timestamp with time zone, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION _insert_move(integer, integer, integer, numeric, numeric, text, text, integer, integer, uuid, text, timestamp with time zone, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
