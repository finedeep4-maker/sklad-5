create or replace view public.apartment_room_view with (security_invoker = true) as
with norms as (
  select a.id as apartment_id, n.room_id, n.item_id, n.qty
    from public.apartments a
    join public.room_norms n on n.apartment_id = a.id
  union all
  select a.id, t.room_id, t.item_id, t.qty
    from public.apartments a
    join public.room_norms t on t.apt_type = a.type and t.apartment_id is null
   where not exists (
     select 1 from public.room_norms o
      where o.apartment_id = a.id and o.room_id = t.room_id and o.item_id = t.item_id)
),
keys as (
  select apartment_id, room_id, item_id from norms
  union
  select apartment_id, room_id, item_id from public.room_stock
)
select k.apartment_id, k.room_id, r.name as room_name, r.sort as room_sort,
       k.item_id, i.name as item_name, i.base_unit, i.pack_label,
       coalesce(n.qty, 0) as norm,
       coalesce(s.qty, 0) as actual,
       coalesce(n.qty, 0) - coalesce(s.qty, 0) as gap
  from keys k
  join public.rooms r on r.id = k.room_id
  join public.items i on i.id = k.item_id
  left join norms n
    on n.apartment_id = k.apartment_id and n.room_id = k.room_id and n.item_id = k.item_id
  left join public.room_stock s
    on s.apartment_id = k.apartment_id and s.room_id = k.room_id and s.item_id = k.item_id;
grant select on public.apartment_room_view to authenticated;
