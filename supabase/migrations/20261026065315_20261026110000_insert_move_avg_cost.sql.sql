create or replace function public._insert_move(p_item int, p_from int, p_to int, p_qty numeric, p_cost numeric,
                                               p_src text, p_src_id text, p_apt int, p_staff int, p_doc uuid,
                                               p_note text, p_moved timestamptz, p_reverses bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint; v_cost numeric := p_cost;
begin
  -- расход (движение в «списано») без явной цены получает среднюю цену прихода на момент операции
  if v_cost is null and p_reverses is null
     and p_to = (select id from locations where type = 'sink' limit 1) then
    v_cost := avg_cost(p_item);
  end if;
  insert into stock_moves(item_id, from_loc, to_loc, qty, unit_cost, source_type, source_id,
                          apartment_id, staff_id, doc_id, note, moved_at, reverses_id)
  values (p_item, p_from, p_to, p_qty, v_cost, p_src, p_src_id, p_apt, p_staff, p_doc, p_note,
          coalesce(p_moved, now()), p_reverses)
  returning id into v;
  return v;
end $$;