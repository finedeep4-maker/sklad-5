create or replace function public.issue_missing_to_apartment(p_apartment int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; v_doc uuid; v_number text; v_give numeric; v_avail numeric;
  v_wh int := _loc_singleton('warehouse'); v_apt int := _loc_apartment(p_apartment);
  v_issued jsonb := '[]'; v_short jsonb := '[]';
  v_is_owner boolean; v_is_asset boolean; v_src int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if v_apt is null then raise exception 'Квартира не найдена'; end if;
  select is_owner into v_is_owner from apartments where id = p_apartment;
  for r in select g.item_id, g.name, g.gap from apartment_gap g
           where g.apartment_id = p_apartment and g.gap > 0 order by g.name
  loop
    select c.kind = 'asset' into v_is_asset
      from items i join categories c on c.id = i.category_id where i.id = r.item_id;
    if v_is_owner and v_is_asset then
      v_src := _loc_owner_stock(p_apartment);
    else
      v_src := v_wh;
    end if;
    v_avail := greatest(_bal(v_src, r.item_id), 0);
    v_give  := least(r.gap, v_avail);
    if v_give > 0 then
      if v_doc is null then
        v_number := _next_doc_number('issue');
        insert into documents(doc_type, number, note)
        values ('issue', v_number, 'Выдача в апартамент ' || (select code from apartments where id = p_apartment))
        returning id into v_doc;
      end if;
      perform _insert_move(r.item_id, v_src, v_apt, v_give, null, 'manual', 'issue_missing',
                           p_apartment, null, v_doc, null, now(), null);
      v_issued := v_issued || jsonb_build_object('item_id', r.item_id, 'name', r.name, 'qty', v_give);
    end if;
    if v_give < r.gap then
      v_short := v_short || jsonb_build_object('item_id', r.item_id, 'name', r.name,
                                               'need', r.gap, 'issued', v_give);
    end if;
  end loop;
  return jsonb_build_object('doc_id', v_doc, 'doc_number', v_number, 'issued', v_issued, 'short', v_short);
end $$;
revoke all on function public.issue_missing_to_apartment(int) from public, anon;
grant execute on function public.issue_missing_to_apartment(int) to authenticated;