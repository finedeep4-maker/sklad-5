drop function if exists public.post_move(text, int, numeric, int, int, uuid, numeric, text);
drop function if exists public.post_document(text, jsonb, int, int, int, text);

create function public.post_move(p_op text, p_item int, p_qty numeric,
                                 p_apartment int default null, p_staff int default null,
                                 p_doc uuid default null, p_unit_cost numeric default null,
                                 p_note text default null, p_moved_at timestamptz default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_wh int := _loc_singleton('warehouse'); v_sink int := _loc_singleton('sink'); v_src int := _loc_singleton('source');
  v_from int; v_to int; v_msg text; v_apt_loc int; v_h int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Количество должно быть больше 0'; end if;
  if p_op in ('issue_apartment','return_apartment','writeoff_apartment') then
    v_apt_loc := _loc_apartment(p_apartment);
    if v_apt_loc is null then raise exception 'Не указана квартира'; end if;
  end if;
  if p_op in ('issue_holder','return_holder','writeoff_holder') then
    v_h := _loc_holder(p_staff);
    if v_h is null then raise exception 'Не указан сотрудник'; end if;
  end if;
  case p_op
    when 'receipt'            then v_from := v_src;     v_to := v_wh;
    when 'issue_apartment'    then v_from := v_wh;      v_to := v_apt_loc; v_msg := 'Не хватает на складе';
    when 'return_apartment'   then v_from := v_apt_loc; v_to := v_wh;      v_msg := 'Нет в апартаменте';
    when 'writeoff_apartment' then v_from := v_apt_loc; v_to := v_sink;    v_msg := 'Нет в апартаменте';
    when 'writeoff_warehouse' then v_from := v_wh;      v_to := v_sink;    v_msg := 'Не хватает на складе';
    when 'issue_holder'       then v_from := v_wh;      v_to := v_h;       v_msg := 'Не хватает на складе';
    when 'return_holder'      then v_from := v_h;       v_to := v_wh;      v_msg := 'Нет у сотрудника';
    when 'writeoff_holder'    then v_from := v_h;       v_to := v_sink;    v_msg := 'Нет у сотрудника';
    else raise exception 'Неизвестная операция %', p_op;
  end case;
  if v_msg is not null and _bal(v_from, p_item) < p_qty then raise exception '%', v_msg; end if;
  return _insert_move(p_item, v_from, v_to, p_qty,
                      case when p_op = 'receipt' then p_unit_cost end,
                      'manual', p_op, p_apartment, p_staff, p_doc, p_note, coalesce(p_moved_at, now()), null);
end $$;

create function public.post_document(p_op text, p_lines jsonb, p_apartment int default null, p_staff int default null,
                                     p_supplier int default null, p_note text default null, p_doc_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_type doc_type; v_doc uuid; v_number text; v_total numeric := 0; v_n int := 0; r record;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_date date; v_moved timestamptz;
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
    perform post_move(p_op, r.item_id, r.qty, p_apartment, p_staff, v_doc, r.cost, p_note, v_moved);
    v_total := v_total + r.qty * coalesce(case when p_op = 'receipt' then r.cost end, 0);
    v_n := v_n + 1;
  end loop;
  if p_op = 'receipt' then update documents set total_cost = v_total where id = v_doc; end if;
  return jsonb_build_object('doc_id', v_doc, 'doc_number', v_number, 'lines', v_n);
end $$;

revoke all on function public.post_move(text, int, numeric, int, int, uuid, numeric, text, timestamptz) from public, anon;
revoke all on function public.post_document(text, jsonb, int, int, int, text, date) from public, anon;
grant execute on function public.post_move(text, int, numeric, int, int, uuid, numeric, text, timestamptz) to authenticated;
grant execute on function public.post_document(text, jsonb, int, int, int, text, date) to authenticated;