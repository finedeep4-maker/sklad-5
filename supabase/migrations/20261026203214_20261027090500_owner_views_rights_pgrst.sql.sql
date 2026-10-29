-- E15: sv_apartments — drop+recreate with is_owner added before last_cleaned_at
drop view if exists sv_apartments;
create view sv_apartments with (security_invoker = true) as
select a.id, a.code, b.name as building, a.type, a.status, a.is_owner,
       (select max(e.cleaned_at) from cleaning_events e
         where e.apartment_id = a.id and e.status = 'done') as last_cleaned_at
from apartments a join buildings b on b.id = a.building_id
where is_active_user() and a.status = 'active';
grant select on sv_apartments to authenticated;

-- E16: owner_stock_balance view (security_invoker)
create or replace view owner_stock_balance with (security_invoker = true) as
select l.owner_apartment_id as apartment_id,
       a.code,
       b.item_id,
       i.name,
       i.base_unit,
       b.qty
from stock_balance b
join locations l on l.id = b.loc_id
join apartments a on a.id = l.owner_apartment_id
join items i on i.id = b.item_id
where l.type = 'owner_stock' and b.qty <> 0;
grant select on owner_stock_balance to authenticated;

-- notify pgrst to reload schema cache
notify pgrst, 'reload schema';