create or replace function public._loc_owner(p_loc int, p_item int) returns int
language sql stable security definer set search_path = public as $$
  select case
    when l.type = 'owner_stock' then l.owner_apartment_id
    when l.type = 'apartment' and a.is_owner
         and exists (select 1 from items i join categories c on c.id = i.category_id
                      where i.id = p_item and c.kind = 'asset')
      then l.apartment_id
    else null
  end
  from locations l
  left join apartments a on a.id = l.apartment_id
  where l.id = p_loc
$$;
revoke all on function public._loc_owner(int, int) from public, anon;