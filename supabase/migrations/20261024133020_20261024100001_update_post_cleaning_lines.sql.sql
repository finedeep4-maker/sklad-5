CREATE OR REPLACE FUNCTION public._post_cleaning_lines(p_event uuid, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
and i.active
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
end $function$;