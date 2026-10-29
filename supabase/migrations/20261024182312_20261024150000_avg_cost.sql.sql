create or replace function public.avg_cost(p_item int)
returns numeric
language sql
stable
set search_path = public
as $$
  select sum(m.qty * m.unit_cost) / nullif(sum(m.qty), 0)
  from stock_moves m join locations l on l.id = m.to_loc
  where m.item_id = p_item and l.type = 'warehouse' and m.unit_cost is not null and m.reverses_id is null
    and not exists (select 1 from stock_moves r where r.reverses_id = m.id)
$$;