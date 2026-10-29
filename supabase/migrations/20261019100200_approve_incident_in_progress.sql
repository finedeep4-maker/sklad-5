create or replace function public.approve_incident(
  p_incident uuid, p_decision text, p_note text default null, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare i incidents%rowtype; v_move bigint; v_apt int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into i from incidents where id = p_incident;
  if not found or i.status not in ('new', 'in_progress') then
    raise exception 'Заявка не найдена или уже обработана';
  end if;
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
end $function$;
