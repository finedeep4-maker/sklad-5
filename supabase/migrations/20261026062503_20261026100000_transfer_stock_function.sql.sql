create function public.transfer_stock(p_from_kind text, p_from_id int, p_to_apartment int, p_lines jsonb,
                                      p_note text default null, p_doc_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_from int; v_to int; v_doc uuid; v_number text; v_n int := 0; r record;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_date date; v_moved timestamptz; v_name text; v_msg text; v_staff int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Нет позиций';
  end if;
  v_to := _loc_apartment(p_to_apartment);
  if v_to is null then raise exception 'Не указана квартира назначения'; end if;
  if p_from_kind = 'apartment' then
    if p_from_id is not distinct from p_to_apartment then
      raise exception 'Квартира-источник и квартира назначения совпадают';
    end if;
    v_from := _loc_apartment(p_from_id);
    if v_from is null then raise exception 'Не указана квартира-источник'; end if;
    v_msg := 'Нет в апартаменте';
  elsif p_from_kind = 'holder' then
    v_from := _loc_holder(p_from_id);
    if v_from is null then raise exception 'Не указан сотрудник'; end if;
    v_staff := p_from_id;
    v_msg := 'Нет у сотрудника';
  else
    raise exception 'Неизвестный источник %', p_from_kind;
  end if;
  v_date := coalesce(p_doc_date, v_today);
  if v_date > v_today then raise exception 'Дата документа не может быть в будущем'; end if;
  v_moved := case when v_date = v_today then now()
                  else (v_date::timestamp + interval '12 hours') at time zone 'Africa/Cairo' end;
  v_number := _next_doc_number('issue'::doc_type);
  insert into documents(doc_type, number, doc_date, note)
  values ('issue', v_number, v_date, coalesce(p_note, 'Перемещение'))
  returning id into v_doc;
  for r in
    select (e->>'item_id')::int as item_id, sum((e->>'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) e
    group by 1 order by 1
  loop
    if r.qty is null or r.qty <= 0 then raise exception 'Количество должно быть больше 0'; end if;
    if _bal(v_from, r.item_id) < r.qty then
      select name into v_name from items where id = r.item_id;
      raise exception '%: %', v_msg, coalesce(v_name, r.item_id::text);
    end if;
    perform _insert_move(r.item_id, v_from, v_to, r.qty, null, 'manual', 'transfer',
                         p_to_apartment, v_staff, v_doc, p_note, v_moved, null);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('doc_id', v_doc, 'doc_number', v_number, 'lines', v_n);
end $$;

revoke all on function public.transfer_stock(text, int, int, jsonb, text, date) from public, anon;
grant execute on function public.transfer_stock(text, int, int, jsonb, text, date) to authenticated;