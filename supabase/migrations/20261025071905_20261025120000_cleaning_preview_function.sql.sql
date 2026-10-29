create or replace function public.cleaning_preview(p_event uuid)
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
       and i.active
       and n.norm_type in ('turnover_replenish', 'cleaning_consumption') and n.qty > 0
  ), '[]'::jsonb);
end $$;