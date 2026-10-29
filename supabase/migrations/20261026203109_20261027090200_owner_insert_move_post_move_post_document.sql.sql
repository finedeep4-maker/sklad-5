-- C8: _insert_move — same signature, add owner rules + owner_apartment_id + owner cost logic
create or replace function public._insert_move(p_item int, p_from int, p_to int, p_qty numeric, p_cost numeric,
                                                p_src text, p_src_id text, p_apt int, p_staff int, p_doc uuid,
                                                p_note text, p_moved timestamptz, p_reverses bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v bigint;
  v_cost numeric := p_cost;
  v_from_type loc_type; v_to_type loc_type;
  v_owner_from int; v_owner_to int; v_owner int;
  v_item_kind item_kind;
begin
  select type into v_from_type from locations where id = p_from;
  select type into v_to_type   from locations where id = p_to;
  select c.kind into v_item_kind
    from items i join categories c on c.id = i.category_id
    where i.id = p_item;

  v_owner_from := _loc_owner(p_from, p_item);
  v_owner_to   := _loc_owner(p_to,   p_item);

  -- owner movement rules apply only to assets
  if v_item_kind = 'asset' then
    if v_owner_from is not null or v_owner_to is not null then
      -- determine the "home" apartment of this asset
      if v_owner_from is not null and v_owner_to is not null and v_owner_from <> v_owner_to then
        raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
      end if;
      v_owner := coalesce(v_owner_from, v_owner_to);

      -- allowed destinations for an owner asset: source, owner_stock(X), apartment X, sink
      if v_to_type not in ('source','sink')
         and not (v_to_type = 'owner_stock' and _loc_owner_stock(v_owner) = p_to)
         and not (v_to_type = 'apartment' and p_to = _loc_apartment(v_owner)) then
        raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
      end if;
      if v_from_type not in ('source','sink')
         and not (v_from_type = 'owner_stock' and _loc_owner_stock(v_owner) = p_from)
         and not (v_from_type = 'apartment' and p_from = _loc_apartment(v_owner)) then
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
end $$;
revoke all on function public._insert_move(int,int,int,numeric,numeric,text,text,int,int,uuid,text,timestamp with time zone,bigint) from public, anon;

-- C9: post_move — drop old, add p_owner_apartment int default null
drop function if exists public.post_move(text, int, numeric, int, int, uuid, numeric, text, timestamptz);
create function public.post_move(p_op text, p_item int, p_qty numeric,
                                 p_apartment int default null, p_staff int default null,
                                 p_doc uuid default null, p_unit_cost numeric default null,
                                 p_note text default null, p_moved_at timestamptz default null,
                                 p_owner_apartment int default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_wh int := _loc_singleton('warehouse'); v_sink int := _loc_singleton('sink'); v_src int := _loc_singleton('source');
  v_from int; v_to int; v_msg text; v_apt_loc int; v_h int;
  v_is_asset boolean; v_is_owner boolean;
  v_ow int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Количество должно быть больше 0'; end if;

  select c.kind = 'asset' into v_is_asset
    from items i join categories c on c.id = i.category_id where i.id = p_item;

  if p_op in ('issue_apartment','return_apartment','writeoff_apartment') then
    v_apt_loc := _loc_apartment(p_apartment);
    if v_apt_loc is null then raise exception 'Не указана квартира'; end if;
    select is_owner into v_is_owner from apartments where id = p_apartment;
  end if;
  if p_op in ('issue_holder','return_holder','writeoff_holder') then
    v_h := _loc_holder(p_staff);
    if v_h is null then raise exception 'Не указан сотрудник'; end if;
  end if;

  case p_op
    when 'receipt' then
      if p_owner_apartment is not null then
        v_from := v_src;
        v_to   := _loc_owner_stock(p_owner_apartment);
        if v_to is null then raise exception 'Не указана owner-квартира'; end if;
        if not v_is_asset then
          raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
        end if;
      else
        v_from := v_src; v_to := v_wh;
      end if;

    when 'issue_apartment' then
      if v_is_owner and v_is_asset then
        v_from := _loc_owner_stock(p_apartment);
        v_to   := v_apt_loc;
        v_msg  := 'Нет на складе owner';
      else
        v_from := v_wh; v_to := v_apt_loc; v_msg := 'Не хватает на складе';
      end if;

    when 'return_apartment' then
      if v_is_owner and v_is_asset then
        v_from := v_apt_loc;
        v_to   := _loc_owner_stock(p_apartment);
        v_msg  := 'Нет в апартаменте';
      else
        v_from := v_apt_loc; v_to := v_wh; v_msg := 'Нет в апартаменте';
      end if;

    when 'writeoff_apartment' then
      v_from := v_apt_loc; v_to := v_sink; v_msg := 'Нет в апартаменте';

    when 'writeoff_warehouse' then
      if p_owner_apartment is not null then
        v_from := _loc_owner_stock(p_owner_apartment);
        v_to   := v_sink;
        v_msg  := 'Нет на складе owner';
        if v_from is null then raise exception 'Не указана owner-квартира'; end if;
      else
        v_from := v_wh; v_to := v_sink; v_msg := 'Не хватает на складе';
      end if;

    when 'issue_holder' then
      v_from := v_wh; v_to := v_h; v_msg := 'Не хватает на складе';
    when 'return_holder' then
      v_from := v_h; v_to := v_wh; v_msg := 'Нет у сотрудника';
    when 'writeoff_holder' then
      v_from := v_h; v_to := v_sink; v_msg := 'Нет у сотрудника';
    else raise exception 'Неизвестная операция %', p_op;
  end case;

  if v_msg is not null and _bal(v_from, p_item) < p_qty then raise exception '%', v_msg; end if;

  v_ow := coalesce(p_owner_apartment,
                   case when p_op in ('issue_apartment','return_apartment','writeoff_apartment')
                        and v_is_owner and v_is_asset then p_apartment end);

  return _insert_move(p_item, v_from, v_to, p_qty,
                      case when p_op = 'receipt' then p_unit_cost end,
                      'manual', p_op, p_apartment, p_staff, p_doc, p_note, coalesce(p_moved_at, now()), null);
end $$;
revoke all on function public.post_move(text,int,numeric,int,int,uuid,numeric,text,timestamptz,int) from public, anon;
grant execute on function public.post_move(text,int,numeric,int,int,uuid,numeric,text,timestamptz,int) to authenticated;

-- C9: post_document — drop old, add p_owner_apartment int default null
drop function if exists public.post_document(text, jsonb, int, int, int, text, date);
create function public.post_document(p_op text, p_lines jsonb, p_apartment int default null, p_staff int default null,
                                      p_supplier int default null, p_note text default null, p_doc_date date default null,
                                      p_owner_apartment int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_type doc_type; v_doc uuid; v_number text; v_total numeric := 0; v_n int := 0; r record;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_date date; v_moved timestamptz;
  v_is_asset boolean; v_is_owner boolean;
  v_ow_stk int; v_apt_loc int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Нет позиций';
  end if;
  v_date := coalesce(p_doc_date, v_today);
  if v_date > v_today then raise exception 'Дата документа не может быть в будущем'; end if;
  v_moved := case when v_date = v_today then now()
                  else (v_date::timestamp + interval '12 hours') at time zone 'Africa/Cairo' end;
  v_type := case
    when p_op = 'receipt' then 'receipt'::doc_type
    when p_op in ('issue_apartment','return_apartment','issue_holder','return_holder') then 'issue'::doc_type
    when p_op in ('writeoff_apartment','writeoff_warehouse','writeoff_holder') then 'writeoff'::doc_type
    else null end;
  if v_type is null then raise exception 'Неизвестная операция %', p_op; end if;
  v_number := _next_doc_number(v_type);
  insert into documents(doc_type, number, doc_date, supplier_id, note)
  values (v_type, v_number, v_date, case when p_op = 'receipt' then p_supplier end, p_note)
  returning id into v_doc;

  for r in
    select (e->>'item_id')::int as item_id,
           sum((e->>'qty')::numeric) as qty,
           sum((e->>'qty')::numeric * (e->>'unit_cost')::numeric) filter (where e->>'unit_cost' is not null)
             / nullif(sum((e->>'qty')::numeric) filter (where e->>'unit_cost' is not null), 0) as cost
    from jsonb_array_elements(p_lines) e
    group by 1 order by 1
  loop
    perform post_move(p_op, r.item_id, r.qty, p_apartment, p_staff, v_doc, r.cost, p_note, v_moved, p_owner_apartment);
    v_total := v_total + r.qty * coalesce(case when p_op = 'receipt' then r.cost end, 0);
    v_n := v_n + 1;
  end loop;
  if p_op = 'receipt' then update documents set total_cost = v_total where id = v_doc; end if;

  -- receipt + p_owner_apartment + p_apartment (must match): also issue into apartment in same doc
  if p_op = 'receipt' and p_owner_apartment is not null and p_apartment is not null then
    if p_owner_apartment <> p_apartment then
      raise exception 'owner-квартира и квартира выдачи должны совпадать';
    end if;
    v_apt_loc := _loc_apartment(p_apartment);
    for r in
      select (e->>'item_id')::int as item_id,
             sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(p_lines) e
      group by 1 order by 1
    loop
      select c.kind = 'asset' into v_is_asset
        from items i join categories c on c.id = i.category_id where i.id = r.item_id;
      if v_is_asset then
        perform _insert_move(r.item_id, _loc_owner_stock(p_apartment), v_apt_loc, r.qty,
                             null, 'manual', 'issue_apartment', p_apartment, null, v_doc, p_note, v_moved, null);
        v_n := v_n + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('doc_id', v_doc, 'doc_number', v_number, 'lines', v_n);
end $$;
revoke all on function public.post_document(text, jsonb, int, int, int, text, date, int) from public, anon;
grant execute on function public.post_document(text, jsonb, int, int, int, text, date, int) to authenticated;

-- C10: issue_missing_to_apartment — owner assets use owner_stock
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
      perform _insert_move(r.item_id, v_src, v_apt, r_give, null, 'manual', 'issue_missing',
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