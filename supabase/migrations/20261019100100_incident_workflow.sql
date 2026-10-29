alter table incidents
  add column if not exists assigned_to uuid references profiles(id),
  add column if not exists due_at timestamptz,
  add column if not exists taken_at timestamptz,
  add column if not exists cleaning_event_id uuid references cleaning_events(id);

create index if not exists incidents_open_idx
  on incidents (status, due_at) where status in ('new','in_progress');
create index if not exists incidents_cleaning_event_idx
  on incidents (cleaning_event_id);

create or replace function take_incident(
  p_incident uuid, p_assignee uuid default null, p_due timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_assignee uuid := coalesce(p_assignee, auth.uid());
begin
  if not is_admin() then
    raise exception 'Только администратор' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles
                 where id = v_assignee and active
                   and role::text in ('admin','manager')) then
    raise exception 'Исполнитель не найден или неактивен';
  end if;
  update incidents
     set status = 'in_progress', assigned_to = v_assignee,
         due_at = p_due, taken_at = coalesce(taken_at, now())
   where id = p_incident and status in ('new','in_progress');
  if not found then raise exception 'Заявка не найдена или уже закрыта'; end if;
  return jsonb_build_object('status','in_progress','assigned_to',v_assignee,'due_at',p_due);
end $$;

revoke execute on function take_incident(uuid,uuid,timestamptz) from public, anon;
grant  execute on function take_incident(uuid,uuid,timestamptz) to authenticated;
