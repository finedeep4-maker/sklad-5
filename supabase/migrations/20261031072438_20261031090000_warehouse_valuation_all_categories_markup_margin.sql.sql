/*
# Recreate warehouse_valuation view: all categories, markup/margin pct

## Summary
Recreates the `public.warehouse_valuation` view to include ALL active items
(not just assets) in both `company` and `owner` scopes. Removes the old
`margin` column and adds `markup_pct` (markup on cost) and `margin_pct`
(profit margin on price). The owner scope now only returns rows with
on_hand > 0 to avoid zero-stock rows for every item × apartment combination.

## Changes

### View `public.warehouse_valuation` (dropped and recreated)
Columns:
- `scope` text — 'company' or 'owner'
- `owner_apartment_id` int — null for company scope, owner apartment id for owner scope
- `item_id` int
- `on_hand` numeric — stock balance at warehouse (company) or owner_stock location (owner)
- `min_stock` numeric — from items
- `avg_cost` numeric — avg_cost(item_id) for company, owner_avg_cost(item_id, owner_apartment_id) for owner
- `guest_price` numeric — from item_prices (may be null)
- `stock_value` numeric — on_hand * avg_cost
- `potential_revenue` numeric — on_hand * guest_price
- `markup_pct` numeric — round((guest_price - cost) / cost * 100, 2); null if cost or guest_price null/0
- `margin_pct` numeric — round((guest_price - cost) / guest_price * 100, 2); null if cost or guest_price null/0

### Scope filters
- company: all active items (no category kind filter), stock_balance at warehouse location
- owner: all active items, only rows where on_hand > 0 at the owner_stock location

### Security
- `security_invoker = true` preserved
- `is_admin()` check preserved in both branches
- REVOKE ALL FROM public, anon
- GRANT SELECT TO authenticated

### Notes
- _insert_move rules NOT changed
- No data loss — view-only recreation
*/

drop view if exists public.warehouse_valuation;

create view public.warehouse_valuation with (security_invoker = true) as
-- company scope: all active items at the warehouse location
select 'company'::text as scope,
       null::integer as owner_apartment_id,
       i.id as item_id,
       coalesce(b.qty, 0) as on_hand,
       i.min_stock,
       avg_cost(i.id) as avg_cost,
       ip.guest_price,
       coalesce(b.qty, 0) * avg_cost(i.id) as stock_value,
       coalesce(b.qty, 0) * ip.guest_price as potential_revenue,
       case
         when avg_cost(i.id) is null or avg_cost(i.id) = 0
              or ip.guest_price is null or ip.guest_price = 0
         then null::numeric
         else round((ip.guest_price - avg_cost(i.id)) / avg_cost(i.id) * 100, 2)
       end as markup_pct,
       case
         when avg_cost(i.id) is null or avg_cost(i.id) = 0
              or ip.guest_price is null or ip.guest_price = 0
         then null::numeric
         else round((ip.guest_price - avg_cost(i.id)) / ip.guest_price * 100, 2)
       end as margin_pct
  from items i
  left join stock_balance b
    on b.item_id = i.id
   and b.loc_id = (select locations.id from locations where locations.type = 'warehouse' limit 1)
  left join item_prices ip on ip.item_id = i.id
  where i.active and is_admin()

union all

-- owner scope: all active items at owner_stock locations, only on_hand > 0
select 'owner'::text as scope,
       l.owner_apartment_id,
       i.id as item_id,
       coalesce(b.qty, 0) as on_hand,
       i.min_stock,
       owner_avg_cost(i.id, l.owner_apartment_id) as avg_cost,
       ip.guest_price,
       coalesce(b.qty, 0) * owner_avg_cost(i.id, l.owner_apartment_id) as stock_value,
       coalesce(b.qty, 0) * ip.guest_price as potential_revenue,
       case
         when owner_avg_cost(i.id, l.owner_apartment_id) is null
              or owner_avg_cost(i.id, l.owner_apartment_id) = 0
              or ip.guest_price is null or ip.guest_price = 0
         then null::numeric
         else round((ip.guest_price - owner_avg_cost(i.id, l.owner_apartment_id))
                    / owner_avg_cost(i.id, l.owner_apartment_id) * 100, 2)
       end as markup_pct,
       case
         when owner_avg_cost(i.id, l.owner_apartment_id) is null
              or owner_avg_cost(i.id, l.owner_apartment_id) = 0
              or ip.guest_price is null or ip.guest_price = 0
         then null::numeric
         else round((ip.guest_price - owner_avg_cost(i.id, l.owner_apartment_id))
                    / ip.guest_price * 100, 2)
       end as margin_pct
  from items i
  join locations l on l.type = 'owner_stock'
  left join stock_balance b
    on b.item_id = i.id
   and b.loc_id = l.id
  left join item_prices ip on ip.item_id = i.id
  where i.active and is_admin() and coalesce(b.qty, 0) > 0;

revoke all on public.warehouse_valuation from public, anon;
grant select on public.warehouse_valuation to authenticated;
