/*
# Item prices, owner↔company transfer, warehouse valuation, report RPCs

## 1. New table: item_prices
- `item_id` (int, PK, FK → items(id) ON DELETE CASCADE)
- `guest_price` (numeric(14,2), NOT NULL, CHECK ≥ 0) — guest-facing price per unit
- `updated_at` (timestamptz, DEFAULT now())
- RLS: admin-only (same pattern as tenant_coefs). REVOKE ALL FROM anon.
- Seed: guest_price = round(avg_cost(item_id) * coef, 2) where coef from tenant_coefs
  (item-level first, then category-level), only if both avg_cost and coef are NOT NULL.

## 2. New function: transfer_company_owner
- `transfer_company_owner(p_direction text, p_owner_apartment int, p_lines jsonb, p_note text)`
- Returns uuid (document id).
- p_direction: 'to_owner' (company warehouse → owner stock) or 'to_company' (owner stock → warehouse).
- Admin-only. Apartment must have is_owner = true.
- Checks source balance. Creates document via _next_doc_number, inserts moves via _insert_move
  with owner_apartment_id and source_type 'owner_transfer'.
- Cost: to_owner uses avg_cost(item), to_company uses owner_avg_cost(item, apartment).
- Reuses existing _insert_move which enforces owner asset movement rules.

## 3. New view: warehouse_valuation
- security_invoker, admin-visible only.
- Columns: scope ('company'|'owner'), owner_apartment_id, item_id, on_hand, min_stock,
  avg_cost, guest_price, stock_value, potential_revenue, margin.

## 4. New RPCs (admin-only)
- report_stock_turnover(p_from date, p_to date, p_scope text, p_owner_apartment int)
  — in/out/transfer quantities and values per item.
- report_owner_vs_company(p_from date, p_to date)
  — summary comparison of owner vs company stock and movements.

## Security
- item_prices: RLS enabled, admin-only policies, REVOKE ALL FROM anon, GRANT to authenticated.
- transfer_company_owner: SECURITY DEFINER, REVOKE FROM PUBLIC/anon, GRANT to authenticated.
- warehouse_valuation: security_invoker view, GRANT SELECT to authenticated.
- report functions: SECURITY DEFINER, REVOKE FROM PUBLIC/anon, GRANT to authenticated.
*/

-- ═══════════════════════════════════════════════════════════
-- 1. item_prices table
-- ═══════════════════════════════════════════════════════════

create table if not exists public.item_prices (
  item_id     int primary key references public.items(id) on delete cascade,
  guest_price numeric(14,2) not null check (guest_price >= 0),
  updated_at  timestamptz not null default now()
);

alter table public.item_prices enable row level security;

drop policy if exists "admin_all_item_prices" on public.item_prices;

create policy "admin_all_item_prices" on public.item_prices
  for all to authenticated
  using (is_admin()) with check (is_admin());

revoke all on public.item_prices from anon;

grant select, insert, update, delete on public.item_prices to authenticated;

-- Seed: guest_price = round(avg_cost * coef, 2) where both not null
insert into public.item_prices (item_id, guest_price)
select i.id,
       round(avg_cost(i.id) * coalesce(
         (select tc.coef from public.tenant_coefs tc where tc.item_id = i.id),
         (select tc.coef from public.tenant_coefs tc
            join public.categories c on c.id = i.category_id
           where tc.category_id = i.category_id)
       ), 2)
from public.items i
where avg_cost(i.id) is not null
  and coalesce(
        (select tc.coef from public.tenant_coefs tc where tc.item_id = i.id),
        (select tc.coef from public.tenant_coefs tc
           join public.categories c on c.id = i.category_id
          where tc.category_id = i.category_id)
      ) is not null
on conflict (item_id) do nothing;

-- ═══════════════════════════════════════════════════════════
-- 2. transfer_company_owner function
-- ═══════════════════════════════════════════════════════════

create or replace function public.transfer_company_owner(
  p_direction text,
  p_owner_apartment int,
  p_lines jsonb,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_wh int := _loc_singleton('warehouse');
  v_os int;  -- owner_stock location
  v_doc uuid; v_number text; v_n int := 0;
  r record; v_cost numeric; v_from int; v_to int; v_msg text;
  v_is_owner boolean;
begin
  if not is_admin() then
    raise exception 'Только администратор' using errcode = '42501';
  end if;

  if p_direction not in ('to_owner', 'to_company') then
    raise exception 'Направление должно быть to_owner или to_company';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Нет позиций';
  end if;

  select is_owner into v_is_owner from apartments where id = p_owner_apartment;
  if not found then
    raise exception 'Квартира не найдена';
  end if;
  if not v_is_owner then
    raise exception 'Квартира не является owner-квартирой' using errcode = '42501';
  end if;

  v_os := _loc_owner_stock(p_owner_apartment);
  if v_os is null then
    raise exception 'Owner-склад не найден';
  end if;

  if p_direction = 'to_owner' then
    v_from := v_wh;  v_to := v_os;  v_msg := 'Не хватает на складе компании';
  else  -- to_company
    v_from := v_os;  v_to := v_wh;  v_msg := 'Нет на складе owner';
  end if;

  v_number := _next_doc_number('issue'::doc_type);
  insert into documents(doc_type, number, doc_date, note)
  values ('issue', v_number, (now() at time zone 'Africa/Cairo')::date,
          coalesce(p_note, case when p_direction = 'to_owner'
                                then 'Перенос на owner-склад'
                                else 'Возврат с owner-склада' end))
  returning id into v_doc;

  for r in
    select (e->>'item_id')::int as item_id, sum((e->>'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) e
    group by 1 order by 1
  loop
    if r.qty is null or r.qty <= 0 then
      raise exception 'Количество должно быть больше 0';
    end if;

    if _bal(v_from, r.item_id) < r.qty then
      raise exception '%', v_msg;
    end if;

    if p_direction = 'to_owner' then
      v_cost := avg_cost(r.item_id);
    else
      v_cost := owner_avg_cost(r.item_id, p_owner_apartment);
    end if;

    perform _insert_move(
      r.item_id, v_from, v_to, r.qty, v_cost,
      'owner_transfer', v_doc::text, p_owner_apartment, null, v_doc,
      p_note, now(), null
    );
    v_n := v_n + 1;
  end loop;

  return v_doc;
end $$;

revoke all on function public.transfer_company_owner(text, int, jsonb, text) from public, anon;

grant execute on function public.transfer_company_owner(text, int, jsonb, text) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 3. warehouse_valuation view
-- ═══════════════════════════════════════════════════════════

create or replace view public.warehouse_valuation
with (security_invoker = true) as
select
  'company'::text as scope,
  null::int as owner_apartment_id,
  i.id as item_id,
  coalesce(b.qty, 0) as on_hand,
  i.min_stock,
  avg_cost(i.id) as avg_cost,
  ip.guest_price,
  coalesce(b.qty, 0) * avg_cost(i.id) as stock_value,
  coalesce(b.qty, 0) * ip.guest_price as potential_revenue,
  case
    when avg_cost(i.id) is null or avg_cost(i.id) = 0 or ip.guest_price is null then null
    else round((ip.guest_price - avg_cost(i.id)) / avg_cost(i.id) * 100, 2)
  end as margin
from public.items i
join public.categories c on c.id = i.category_id
left join public.stock_balance b
  on b.item_id = i.id and b.loc_id = (select id from public.locations where type = 'warehouse' limit 1)
left join public.item_prices ip on ip.item_id = i.id
where i.active and c.kind = 'asset' and is_admin()

union all

select
  'owner'::text as scope,
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
      or ip.guest_price is null then null
    else round(
      (ip.guest_price - owner_avg_cost(i.id, l.owner_apartment_id))
      / owner_avg_cost(i.id, l.owner_apartment_id) * 100, 2)
  end as margin
from public.items i
join public.categories c on c.id = i.category_id
join public.locations l on l.type = 'owner_stock'
left join public.stock_balance b on b.item_id = i.id and b.loc_id = l.id
left join public.item_prices ip on ip.item_id = i.id
where i.active and c.kind = 'asset' and is_admin();

grant select on public.warehouse_valuation to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 4. Report RPCs
-- ═══════════════════════════════════════════════════════════

-- 4a. report_stock_turnover
create or replace function public.report_stock_turnover(
  p_from date,
  p_to date,
  p_scope text default 'company',
  p_owner_apartment int default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wh int := _loc_singleton('warehouse');
  v_rows jsonb;
begin
  if not is_admin() then
    raise exception 'Только администратор' using errcode = '42501';
  end if;

  if p_scope = 'company' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', r.item_id,
      'item_name', r.item_name,
      'category', r.category,
      'in_qty', r.in_qty,
      'out_qty', r.out_qty,
      'transfer_in_qty', r.transfer_in_qty,
      'transfer_out_qty', r.transfer_out_qty,
      'in_value', r.in_value,
      'out_value', r.out_value,
      'transfer_in_value', r.transfer_in_value,
      'transfer_out_value', r.transfer_out_value
    ) order by r.item_name), '[]'::jsonb) into v_rows
    from (
      select
        i.id as item_id,
        i.name as item_name,
        c.name as category,
        coalesce(sum(case when m.source_type in ('receipt') and m.to_loc = v_wh
                          and m.reverses_id is null then m.qty end), 0) as in_qty,
        coalesce(sum(case when m.from_loc = v_wh and m.source_type not in ('receipt','owner_transfer')
                          and m.reverses_id is null then m.qty end), 0) as out_qty,
        coalesce(sum(case when m.source_type = 'owner_transfer' and m.to_loc = v_wh
                          and m.reverses_id is null then m.qty end), 0) as transfer_in_qty,
        coalesce(sum(case when m.source_type = 'owner_transfer' and m.from_loc = v_wh
                          and m.reverses_id is null then m.qty end), 0) as transfer_out_qty,
        coalesce(sum(case when m.source_type = 'receipt' and m.to_loc = v_wh
                          and m.reverses_id is null then m.qty * m.unit_cost end), 0) as in_value,
        coalesce(sum(case when m.from_loc = v_wh and m.source_type not in ('receipt','owner_transfer')
                          and m.reverses_id is null then m.qty * m.unit_cost end), 0) as out_value,
        coalesce(sum(case when m.source_type = 'owner_transfer' and m.to_loc = v_wh
                          and m.reverses_id is null then m.qty * m.unit_cost end), 0) as transfer_in_value,
        coalesce(sum(case when m.source_type = 'owner_transfer' and m.from_loc = v_wh
                          and m.reverses_id is null then m.qty * m.unit_cost end), 0) as transfer_out_value
      from public.stock_moves m
      join public.items i on i.id = m.item_id
      join public.categories c on c.id = i.category_id
      where m.moved_at >= p_from::timestamp
        and m.moved_at < (p_to + interval '1 day')::timestamp
        and m.reverses_id is null
        and (m.from_loc = v_wh or m.to_loc = v_wh)
      group by i.id, i.name, c.name
    ) r;

  elsif p_scope = 'owner' then
    if p_owner_apartment is null then
      raise exception 'Для scope=owner укажите p_owner_apartment';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', r.item_id,
      'item_name', r.item_name,
      'category', r.category,
      'in_qty', r.in_qty,
      'out_qty', r.out_qty,
      'transfer_in_qty', r.transfer_in_qty,
      'transfer_out_qty', r.transfer_out_qty,
      'in_value', r.in_value,
      'out_value', r.out_value,
      'transfer_in_value', r.transfer_in_value,
      'transfer_out_value', r.transfer_out_value
    ) order by r.item_name), '[]'::jsonb) into v_rows
    from (
      select
        i.id as item_id,
        i.name as item_name,
        c.name as category,
        coalesce(sum(case when m.source_type = 'receipt' and m.to_loc = _loc_owner_stock(p_owner_apartment)
                          and m.reverses_id is null then m.qty end), 0) as in_qty,
        coalesce(sum(case when m.from_loc = _loc_owner_stock(p_owner_apartment)
                          and m.source_type not in ('receipt','owner_transfer')
                          and m.reverses_id is null then m.qty end), 0) as out_qty,
        coalesce(sum(case when m.source_type = 'owner_transfer' and m.to_loc = _loc_owner_stock(p_owner_apartment)
                          and m.reverses_id is null then m.qty end), 0) as transfer_in_qty,
        coalesce(sum(case when m.source_type = 'owner_transfer' and m.from_loc = _loc_owner_stock(p_owner_apartment)
                          and m.reverses_id is null then m.qty end), 0) as transfer_out_qty,
        coalesce(sum(case when m.source_type = 'receipt' and m.to_loc = _loc_owner_stock(p_owner_apartment)
                          and m.reverses_id is null then m.qty * m.unit_cost end), 0) as in_value,
        coalesce(sum(case when m.from_loc = _loc_owner_stock(p_owner_apartment)
                          and m.source_type not in ('receipt','owner_transfer')
                          and m.reverses_id is null then m.qty * m.unit_cost end), 0) as out_value,
        coalesce(sum(case when m.source_type = 'owner_transfer' and m.to_loc = _loc_owner_stock(p_owner_apartment)
                          and m.reverses_id is null then m.qty * m.unit_cost end), 0) as transfer_in_value,
        coalesce(sum(case when m.source_type = 'owner_transfer' and m.from_loc = _loc_owner_stock(p_owner_apartment)
                          and m.reverses_id is null then m.qty * m.unit_cost end), 0) as transfer_out_value
      from public.stock_moves m
      join public.items i on i.id = m.item_id
      join public.categories c on c.id = i.category_id
      where m.moved_at >= p_from::timestamp
        and m.moved_at < (p_to + interval '1 day')::timestamp
        and m.reverses_id is null
        and m.owner_apartment_id = p_owner_apartment
      group by i.id, i.name, c.name
    ) r;

  else
    raise exception 'scope должен быть company или owner';
  end if;

  return v_rows;
end $$;

revoke all on function public.report_stock_turnover(date, date, text, int) from public, anon;

grant execute on function public.report_stock_turnover(date, date, text, int) to authenticated;

-- 4b. report_owner_vs_company
create or replace function public.report_owner_vs_company(
  p_from date default null,
  p_to date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wh int := _loc_singleton('warehouse');
  v_date_to timestamp;
  v_date_from timestamp;
begin
  if not is_admin() then
    raise exception 'Только администратор' using errcode = '42501';
  end if;

  v_date_to := coalesce((p_to + interval '1 day')::timestamp, now());
  v_date_from := coalesce(p_from::timestamp, '1900-01-01'::timestamp);

  return jsonb_build_object(
    'company', jsonb_build_object(
      'total_items', (select count(*) from public.warehouse_valuation where scope = 'company' and on_hand > 0),
      'stock_value', (select coalesce(sum(stock_value), 0) from public.warehouse_valuation where scope = 'company'),
      'potential_revenue', (select coalesce(sum(potential_revenue), 0) from public.warehouse_valuation where scope = 'company')
    ),
    'owner', jsonb_build_object(
      'total_apartments', (select count(distinct owner_apartment_id) from public.warehouse_valuation where scope = 'owner' and on_hand > 0),
      'total_items', (select count(*) from public.warehouse_valuation where scope = 'owner' and on_hand > 0),
      'stock_value', (select coalesce(sum(stock_value), 0) from public.warehouse_valuation where scope = 'owner'),
      'potential_revenue', (select coalesce(sum(potential_revenue), 0) from public.warehouse_valuation where scope = 'owner')
    ),
    'transfers', jsonb_build_object(
      'to_owner_count', (select count(*) from public.stock_moves m
        join public.documents d on d.id = m.doc_id
        where m.source_type = 'owner_transfer' and m.from_loc = v_wh
          and m.moved_at >= v_date_from and m.moved_at < v_date_to
          and m.reverses_id is null),
      'to_company_count', (select count(*) from public.stock_moves m
        join public.documents d on d.id = m.doc_id
        where m.source_type = 'owner_transfer' and m.to_loc = v_wh
          and m.moved_at >= v_date_from and m.moved_at < v_date_to
          and m.reverses_id is null),
      'to_owner_value', (select coalesce(sum(m.qty * m.unit_cost), 0) from public.stock_moves m
        where m.source_type = 'owner_transfer' and m.from_loc = v_wh
          and m.moved_at >= v_date_from and m.moved_at < v_date_to
          and m.reverses_id is null),
      'to_company_value', (select coalesce(sum(m.qty * m.unit_cost), 0) from public.stock_moves m
        where m.source_type = 'owner_transfer' and m.to_loc = v_wh
          and m.moved_at >= v_date_from and m.moved_at < v_date_to
          and m.reverses_id is null)
    )
  );

end $$;

revoke all on function public.report_owner_vs_company(date, date) from public, anon;

grant execute on function public.report_owner_vs_company(date, date) to authenticated;
