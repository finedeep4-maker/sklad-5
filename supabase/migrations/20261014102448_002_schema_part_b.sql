create function post_move(p_op text, p_item int, p_qty numeric,
                          p_apartment int default null, p_staff int default null,
                          p_doc uuid default null, p_unit_cost numeric default null,
                          p_note text default null)
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
                      'manual', p_op, p_apartment, p_staff, p_doc, p_note, now(), null);
end $$;
create function issue_missing_to_apartment(p_apartment int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; v_doc uuid; v_number text; v_give numeric; v_avail numeric;
  v_wh int := _loc_singleton('warehouse'); v_apt int := _loc_apartment(p_apartment);
  v_issued jsonb := '[]'; v_short jsonb := '[]';
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if v_apt is null then raise exception 'Квартира не найдена'; end if;
  for r in select g.item_id, g.name, g.gap from apartment_gap g
           where g.apartment_id = p_apartment and g.gap > 0 order by g.name
  loop
    v_avail := greatest(_bal(v_wh, r.item_id), 0);
    v_give  := least(r.gap, v_avail);
    if v_give > 0 then
      if v_doc is null then
        v_number := _next_doc_number('issue');
        insert into documents(doc_type, number, note)
        values ('issue', v_number, 'Выдача в апартамент ' || (select code from apartments where id = p_apartment))
        returning id into v_doc;
      end if;
      perform _insert_move(r.item_id, v_wh, v_apt, v_give, null, 'manual', 'issue_missing',
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
create function _post_cleaning_lines(p_event uuid, p_rev int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e cleaning_events%rowtype; r record; s record;
  v_from int; v_move bigint; v_cost numeric; v_sink int := _loc_singleton('sink');
  v_lines jsonb := '[]'; v_short jsonb := '[]';
begin
  select * into e from cleaning_events where id = p_event;
  for r in
    select n.norm_type, n.item_id, n.qty, i.name, i.track_on_hand
    from effective_norms n join items i on i.id = n.item_id
    where n.apartment_id = e.apartment_id
      and n.norm_type in ('turnover_replenish', 'cleaning_consumption') and n.qty > 0
    order by n.norm_type, i.sort, i.name
  loop
    if r.track_on_hand then
      if e.lead_staff_id is null then
        raise exception 'Укажите, кто убирал: для «%» ведётся учёт на руках', r.name;
      end if;
      v_from := _loc_holder(e.lead_staff_id);
    else
      v_from := _loc_singleton('warehouse');
    end if;
    v_cost := avg_cost(r.item_id);
    v_move := _insert_move(r.item_id, v_from, v_sink, r.qty, v_cost, 'cleaning', p_event::text,
                           e.apartment_id, e.lead_staff_id, null, null, e.cleaned_at, null);
    insert into cleaning_event_lines(event_id, revision, item_id, norm_type, qty, unit_cost, from_loc, move_id)
    values (p_event, p_rev, r.item_id, r.norm_type, r.qty, v_cost, v_from, v_move);
    v_lines := v_lines || jsonb_build_object('item_id', r.item_id, 'item', r.name,
                                             'norm_type', r.norm_type, 'qty', r.qty);
  end loop;
  for s in
    select distinct l.from_loc, l.item_id, i.name, lo.type as loc_type, lo.name as loc_name
    from cleaning_event_lines l join items i on i.id = l.item_id join locations lo on lo.id = l.from_loc
    where l.event_id = p_event and l.revision = p_rev
  loop
    if _bal(s.from_loc, s.item_id) < 0 then
      v_short := v_short || jsonb_build_object('item_id', s.item_id, 'item', s.name,
                                               'location', s.loc_name, 'balance', _bal(s.from_loc, s.item_id));
    end if;
  end loop;
  if jsonb_array_length(v_short) > 0 then
    insert into events(type, payload)
    values ('shortage', jsonb_build_object('cleaning_event', p_event, 'apartment_id', e.apartment_id, 'items', v_short));
  end if;
  return jsonb_build_object('lines', v_lines, 'shortages', v_short);
end $$;
create function _cleaning_summary(p_event uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'event_id', e.id, 'status', e.status, 'revision', e.revision,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'item', i.name,
                                                           'norm_type', l.norm_type, 'qty', l.qty) order by l.id)
                       from cleaning_event_lines l join items i on i.id = l.item_id
                       where l.event_id = e.id and l.revision = e.revision), '[]'::jsonb))
  from cleaning_events e where e.id = p_event
$$;
create function complete_cleaning(p_apartment_id int,
                                  p_cleaned_at timestamptz default now(),
                                  p_client_op_id uuid default gen_random_uuid(),
                                  p_staff_ids int[] default '{}',
                                  p_lead_staff_id int default null,
                                  p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_lead int := p_lead_staff_id; v_res jsonb; v_staff int;
begin
  if not (is_admin() or is_supervisor()) then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if not exists (select 1 from apartments where id = p_apartment_id) then raise exception 'Квартира не найдена'; end if;
  if v_lead is null and coalesce(array_length(p_staff_ids, 1), 0) > 0 then v_lead := p_staff_ids[1]; end if;
  if v_lead is not null and not (v_lead = any (p_staff_ids)) then
    p_staff_ids := p_staff_ids || v_lead;
  end if;
  insert into cleaning_events(client_op_id, apartment_id, cleaned_at, lead_staff_id, note)
  values (p_client_op_id, p_apartment_id, coalesce(p_cleaned_at, now()), v_lead, p_note)
  on conflict (client_op_id) do nothing
  returning id into v_id;
  if v_id is null then   -- повтор того же запроса: ничего не списываем
    select id into v_id from cleaning_events where client_op_id = p_client_op_id;
    return _cleaning_summary(v_id) || jsonb_build_object('duplicate', true, 'shortages', '[]'::jsonb);
  end if;
  foreach v_staff in array coalesce(p_staff_ids, '{}') loop
    insert into cleaning_event_staff(event_id, staff_id) values (v_id, v_staff) on conflict do nothing;
  end loop;
  v_res := _post_cleaning_lines(v_id, 1);
  insert into events(type, payload)
  values ('cleaning_done', jsonb_build_object('event_id', v_id, 'apartment_id', p_apartment_id));
  return _cleaning_summary(v_id) || jsonb_build_object('duplicate', false, 'shortages', v_res->'shortages');
end $$;
create function _reverse_cleaning_moves(p_event uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m stock_moves%rowtype;
begin
  for m in select * from stock_moves x
           where x.source_type = 'cleaning' and x.source_id = p_event::text
             and not exists (select 1 from stock_moves r where r.reverses_id = x.id)
  loop
    perform _insert_move(m.item_id, m.to_loc, m.from_loc, m.qty, m.unit_cost, 'cleaning_reversal',
                         p_event::text, m.apartment_id, m.staff_id, null, p_reason, m.moved_at, m.id);
  end loop;
end $$;
create function reverse_cleaning(p_event uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if (select status from cleaning_events where id = p_event) is distinct from 'done' then
    raise exception 'Уборка не найдена или уже отменена';
  end if;
  perform _reverse_cleaning_moves(p_event, p_reason);
  update cleaning_events set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(),
                             reverse_reason = p_reason where id = p_event;
  insert into events(type, payload) values ('cleaning_reversed', jsonb_build_object('event_id', p_event));
  return jsonb_build_object('event_id', p_event, 'status', 'reversed');
end $$;
create function recalculate_cleaning(p_event uuid,
                                     p_cleaned_at timestamptz default null,
                                     p_staff_ids int[] default null,
                                     p_lead_staff_id int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rev int; v_res jsonb; v_staff int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if (select status from cleaning_events where id = p_event) is distinct from 'done' then
    raise exception 'Пересчитывать можно только действующую уборку';
  end if;
  perform _reverse_cleaning_moves(p_event, 'Пересчёт уборки');
  update cleaning_events
     set revision = revision + 1,
         cleaned_at = coalesce(p_cleaned_at, cleaned_at),
         lead_staff_id = coalesce(p_lead_staff_id, lead_staff_id)
   where id = p_event returning revision into v_rev;
  if p_staff_ids is not null then
    delete from cleaning_event_staff where event_id = p_event;
    foreach v_staff in array p_staff_ids loop
      insert into cleaning_event_staff(event_id, staff_id) values (p_event, v_staff) on conflict do nothing;
    end loop;
  end if;
  v_res := _post_cleaning_lines(p_event, v_rev);
  insert into events(type, payload) values ('cleaning_recalculated', jsonb_build_object('event_id', p_event, 'revision', v_rev));
  return _cleaning_summary(p_event) || jsonb_build_object('shortages', v_res->'shortages');
end $$;
create function approve_incident(p_incident uuid, p_decision text, p_note text default null,
                                 p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i incidents%rowtype; v_move bigint; v_apt int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into i from incidents where id = p_incident;
  if not found or i.status <> 'new' then raise exception 'Заявка не найдена или уже обработана'; end if;
  if p_decision = 'reject' then
    update incidents set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
     where id = p_incident;
    return jsonb_build_object('status', 'rejected');
  elsif p_decision <> 'confirm' then
    raise exception 'Решение должно быть confirm или reject';
  end if;
  if i.item_id is not null then
    v_apt := _loc_apartment(i.apartment_id);
    if not p_force and _bal(v_apt, i.item_id) < i.qty then raise exception 'Нет в апартаменте'; end if;
    v_move := _insert_move(i.item_id, v_apt, _loc_singleton('sink'), i.qty, null, 'incident', i.id::text,
                           i.apartment_id, null, null, i.kind::text || ': ' || coalesce(i.comment, ''), now(), null);
  end if;
  update incidents set status = 'confirmed', resolved_by = auth.uid(), resolved_at = now(),
                       resolution_note = p_note, writeoff_move_id = v_move where id = p_incident;
  return jsonb_build_object('status', 'confirmed', 'move_id', v_move);
end $$;
create function needs_bootstrap() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles)
$$;
create function claim_first_admin(p_login text, p_full_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Нужен вход'; end if;
  perform pg_advisory_xact_lock(7001);
  if exists (select 1 from profiles) then raise exception 'Администратор уже создан'; end if;
  insert into profiles(id, login, full_name, role)
  values (auth.uid(), lower(trim(p_login)), trim(p_full_name), 'admin');
end $$;
do $$
declare t text;
begin
  foreach t in array array['profiles','settings','buildings','apartments','apartment_private','locations',
    'categories','items','suppliers','staff','norm_rules','documents','doc_counters','attachments',
    'stock_moves','cleaning_events','cleaning_event_staff','cleaning_event_lines','incidents',
    'apartment_notes','contacts','audit_log','events']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;
create policy sv_own_profile   on profiles   for select to authenticated using (id = auth.uid());
create policy sv_contacts      on contacts   for select to authenticated using (is_active_user() and active);
create policy sv_notes_read    on apartment_notes for select to authenticated
  using (is_supervisor() and visibility = 'all');
create policy sv_notes_write   on apartment_notes for insert to authenticated
  with check (is_supervisor() and author = auth.uid() and visibility = 'all');
create policy sv_incidents_read  on incidents for select to authenticated
  using (is_supervisor() and created_by = auth.uid());
create policy sv_incidents_write on incidents for insert to authenticated
  with check (is_supervisor() and created_by = auth.uid() and status = 'new');
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from public, anon;
revoke all on all sequences in schema public from anon;
revoke insert, update, delete on stock_moves, cleaning_events, cleaning_event_staff,
                                 cleaning_event_lines, doc_counters, audit_log, events from authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on sv_apartments, sv_norms, sv_staff, sv_items, sv_cleaning_events, effective_norms to authenticated;
grant execute on function is_admin(), is_supervisor(), is_active_user() to authenticated;
grant execute on function post_move(text,int,numeric,int,int,uuid,numeric,text) to authenticated;
grant execute on function issue_missing_to_apartment(int) to authenticated;
grant execute on function complete_cleaning(int,timestamptz,uuid,int[],int,text) to authenticated;
grant execute on function reverse_cleaning(uuid,text) to authenticated;
grant execute on function recalculate_cleaning(uuid,timestamptz,int[],int) to authenticated;
grant execute on function approve_incident(uuid,text,text,boolean) to authenticated;
grant execute on function needs_bootstrap() to anon, authenticated;
grant execute on function claim_first_admin(text,text) to authenticated;