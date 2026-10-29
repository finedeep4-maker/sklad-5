-- Cleaning "done" from the QR app no longer writes off stock immediately.
-- A non-admin submission is stored as `pending`; the write-off is posted only when an admin confirms it.
-- An admin who marks a cleaning himself is treated as the confirmation (posted immediately, as before).

alter table cleaning_events
  add column if not exists posting_status text not null default 'posted',
  add column if not exists approved_by uuid references profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists approval_note text;

alter table cleaning_events drop constraint if exists cleaning_events_posting_status_check;
alter table cleaning_events
  add constraint cleaning_events_posting_status_check
  check (posting_status in ('pending', 'posted', 'rejected'));

create index if not exists cleaning_events_pending_idx
  on cleaning_events (created_at) where posting_status = 'pending';

-- ---------------------------------------------------------
-- complete_cleaning: pending for non-admins, immediate posting for admins
-- ---------------------------------------------------------
create or replace function complete_cleaning(p_apartment_id int,
                                  p_cleaned_at timestamptz default now(),
                                  p_client_op_id uuid default gen_random_uuid(),
                                  p_staff_ids int[] default '{}',
                                  p_lead_staff_id int default null,
                                  p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_lead int := p_lead_staff_id; v_res jsonb; v_staff int;
        v_pending boolean := not is_admin(); v_hand text;
begin
  if not (is_admin() or is_supervisor()) then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if not exists (select 1 from apartments where id = p_apartment_id) then raise exception 'Квартира не найдена'; end if;
  if v_lead is null and coalesce(array_length(p_staff_ids, 1), 0) > 0 then v_lead := p_staff_ids[1]; end if;
  if v_lead is not null and not (v_lead = any (p_staff_ids)) then
    p_staff_ids := p_staff_ids || v_lead;
  end if;
  if coalesce(array_length(p_staff_ids, 1), 0) > 0 then
    if exists (select 1 from unnest(p_staff_ids) as s(id)
               where not exists (select 1 from staff where id = s.id)) then
      raise exception 'Сотрудник не найден';
    end if;
  end if;
  -- fail early for the employee (not later for the admin) when "on hand" tracking needs a lead
  if v_pending and v_lead is null then
    select i.name into v_hand
      from effective_norms n join items i on i.id = n.item_id
     where n.apartment_id = p_apartment_id
       and n.norm_type in ('turnover_replenish', 'cleaning_consumption')
       and n.qty > 0 and i.track_on_hand
     order by i.name limit 1;
    if v_hand is not null then
      raise exception 'Укажите, кто убирал: для «%» ведётся учёт на руках', v_hand;
    end if;
  end if;
  insert into cleaning_events(client_op_id, apartment_id, cleaned_at, lead_staff_id, note, posting_status)
  values (p_client_op_id, p_apartment_id, coalesce(p_cleaned_at, now()), v_lead, p_note,
          case when v_pending then 'pending' else 'posted' end)
  on conflict (client_op_id) do nothing
  returning id into v_id;
  if v_id is null then   -- repeat of the same request: nothing is posted
    select id into v_id from cleaning_events where client_op_id = p_client_op_id;
    return _cleaning_summary(v_id) || jsonb_build_object(
      'duplicate', true, 'shortages', '[]'::jsonb,
      'pending', coalesce((select posting_status = 'pending' from cleaning_events where id = v_id), false));
  end if;
  foreach v_staff in array coalesce(p_staff_ids, '{}') loop
    insert into cleaning_event_staff(event_id, staff_id) values (v_id, v_staff) on conflict do nothing;
  end loop;
  if v_pending then
    insert into events(type, payload)
    values ('cleaning_pending', jsonb_build_object('event_id', v_id, 'apartment_id', p_apartment_id));
    return _cleaning_summary(v_id) || jsonb_build_object(
      'duplicate', false, 'shortages', '[]'::jsonb, 'pending', true);
  end if;
  v_res := _post_cleaning_lines(v_id, 1);
  insert into events(type, payload)
  values ('cleaning_done', jsonb_build_object('event_id', v_id, 'apartment_id', p_apartment_id));
  return _cleaning_summary(v_id) || jsonb_build_object(
    'duplicate', false, 'shortages', v_res->'shortages', 'pending', false);
end $$;
revoke all on function complete_cleaning(int,timestamptz,uuid,int[],int,text) from public, anon;
grant execute on function complete_cleaning(int,timestamptz,uuid,int[],int,text) to authenticated;

-- ---------------------------------------------------------
-- approve_cleaning: admin confirms (posts the write-off) or rejects (nothing is written off)
-- ---------------------------------------------------------
create or replace function approve_cleaning(p_event uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e cleaning_events%rowtype; v_res jsonb;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into e from cleaning_events where id = p_event for update;
  if not found or e.posting_status <> 'pending' or e.status <> 'done' then
    raise exception 'Уборка не найдена или уже обработана';
  end if;
  if p_decision = 'reject' then
    update cleaning_events
       set posting_status = 'rejected', status = 'reversed',
           reversed_by = auth.uid(), reversed_at = now(),
           reverse_reason = coalesce(p_note, 'Отклонено администратором'),
           approved_by = auth.uid(), approved_at = now(), approval_note = p_note
     where id = p_event;
    insert into events(type, payload)
    values ('cleaning_rejected', jsonb_build_object('event_id', p_event, 'apartment_id', e.apartment_id));
    return jsonb_build_object('status', 'rejected');
  elsif p_decision <> 'confirm' then
    raise exception 'Решение должно быть confirm или reject';
  end if;
  v_res := _post_cleaning_lines(p_event, e.revision);
  update cleaning_events
     set posting_status = 'posted', approved_by = auth.uid(), approved_at = now(), approval_note = p_note
   where id = p_event;
  insert into events(type, payload)
  values ('cleaning_done', jsonb_build_object('event_id', p_event, 'apartment_id', e.apartment_id));
  return _cleaning_summary(p_event) || jsonb_build_object('status', 'confirmed', 'shortages', v_res->'shortages');
end $$;
revoke all on function approve_cleaning(uuid,text,text) from public, anon;
grant execute on function approve_cleaning(uuid,text,text) to authenticated;

-- ---------------------------------------------------------
-- cleaning_preview: what would be written off for a cleaning (admin only), for the confirmation screen
-- ---------------------------------------------------------
create or replace function cleaning_preview(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('item_id', n.item_id, 'item', i.name,
                                        'norm_type', n.norm_type, 'qty', n.qty)
                     order by n.norm_type, i.sort, i.name)
      from cleaning_events e
      join effective_norms n on n.apartment_id = e.apartment_id
      join items i on i.id = n.item_id
     where e.id = p_event
       and n.norm_type in ('turnover_replenish', 'cleaning_consumption') and n.qty > 0
  ), '[]'::jsonb);
end $$;
revoke all on function cleaning_preview(uuid) from public, anon;
grant execute on function cleaning_preview(uuid) to authenticated;

-- ---------------------------------------------------------
-- guards: a pending cleaning must not be posted through recalculation
-- ---------------------------------------------------------
create or replace function recalculate_cleaning(p_event uuid,
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
  if (select posting_status from cleaning_events where id = p_event) is distinct from 'posted' then
    raise exception 'Сначала подтвердите уборку';
  end if;
  if p_staff_ids is not null and p_lead_staff_id is not null
     and not (p_lead_staff_id = any(p_staff_ids)) then
    p_staff_ids := p_staff_ids || p_lead_staff_id;
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
revoke all on function recalculate_cleaning(uuid,timestamptz,int[],int) from public, anon;
grant execute on function recalculate_cleaning(uuid,timestamptz,int[],int) to authenticated;

-- cancelling a still-pending cleaning also closes its approval state
create or replace function reverse_cleaning(p_event uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if (select status from cleaning_events where id = p_event) is distinct from 'done' then
    raise exception 'Уборка не найдена или уже отменена';
  end if;
  perform _reverse_cleaning_moves(p_event, p_reason);
  update cleaning_events set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(),
                             reverse_reason = p_reason,
                             posting_status = case when posting_status = 'pending' then 'rejected' else posting_status end
   where id = p_event;
  insert into events(type, payload) values ('cleaning_reversed', jsonb_build_object('event_id', p_event));
  return jsonb_build_object('event_id', p_event, 'status', 'reversed');
end $$;
revoke all on function reverse_cleaning(uuid,text) from public, anon;
grant execute on function reverse_cleaning(uuid,text) to authenticated;
