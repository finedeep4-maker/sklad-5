-- ═══════════════════════════════════════════════════════════════
-- Current function definitions (pg_get_functiondef output)
-- Snapshot date: 2026-10-30
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- _insert_move (current: version from migration 20261030081820)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._insert_move(p_item integer, p_from integer, p_to integer, p_qty numeric, p_cost numeric, p_src text, p_src_id text, p_apt integer, p_staff integer, p_doc uuid, p_note text, p_moved timestamp with time zone, p_reverses bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
v bigint;
v_cost numeric := p_cost;
v_from_type loc_type; v_to_type loc_type;
v_owner_from int; v_owner_to int; v_owner int;
v_item_kind item_kind;
v_warehouse_ok boolean;
begin
select type into v_from_type from locations where id = p_from;
select type into v_to_type   from locations where id = p_to;
select c.kind into v_item_kind
from items i join categories c on c.id = i.category_id
where i.id = p_item;

v_owner_from := _loc_owner(p_from, p_item);
v_owner_to   := _loc_owner(p_to,   p_item);

-- warehouse is allowed as from/to for owner assets when reversing or doing owner transfers
v_warehouse_ok := p_src in ('owner_transfer', 'doc_void');

-- owner movement rules apply only to assets
if v_item_kind = 'asset' then
if v_owner_from is not null or v_owner_to is not null then
-- determine the "home" apartment of this asset
if v_owner_from is not null and v_owner_to is not null and v_owner_from <> v_owner_to then
raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
end if;
v_owner := coalesce(v_owner_from, v_owner_to);

-- allowed destinations for an owner asset: source, owner_stock(X), apartment X, sink
-- EXCEPTION: warehouse is also allowed for owner_transfer and doc_void
if v_to_type not in ('source','sink')
and not (v_to_type = 'owner_stock' and _loc_owner_stock(v_owner) = p_to)
and not (v_to_type = 'apartment' and p_to = _loc_apartment(v_owner))
and not (v_warehouse_ok and v_to_type = 'warehouse') then
raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
end if;
if v_from_type not in ('source','sink')
and not (v_from_type = 'owner_stock' and _loc_owner_stock(v_owner) = p_from)
and not (v_from_type = 'apartment' and p_from = _loc_apartment(v_owner))
and not (v_warehouse_ok and v_from_type = 'warehouse') then
raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
end if;
end if;
else
-- consumables: never into owner_stock
if v_to_type = 'owner_stock' then
raise exception 'Имущество собственника нельзя перемещать между собственниками или в имущество компании';
end if;
end if;

v_owner := coalesce(v_owner_from, v_owner_to);

-- cost for writeoffs without explicit price
if v_cost is null and p_reverses is null and v_to_type = 'sink' then
if v_owner is not null then
v_cost := owner_avg_cost(p_item, v_owner);
else
v_cost := avg_cost(p_item);
end if;
end if;

insert into stock_moves(item_id, from_loc, to_loc, qty, unit_cost, source_type, source_id,
apartment_id, staff_id, doc_id, note, moved_at, reverses_id, owner_apartment_id)
values (p_item, p_from, p_to, p_qty, v_cost, p_src, p_src_id, p_apt, p_staff, p_doc, p_note,
coalesce(p_moved, now()), p_reverses, v_owner)
returning id into v;
return v;
end $function$;


-- ═══════════════════════════════════════════════════════════════
-- void_document
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.void_document(p_doc uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
d documents%rowtype;
m stock_moves%rowtype;
r record;
v_n int := 0;
begin
if not is_admin() then
raise exception 'Только администратор' using errcode = '42501';
end if;
select * into d from documents where id = p_doc for update;
if not found then
raise exception 'Документ не найден';
end if;
if d.status <> 'posted' then
raise exception 'Отменить можно только проведённый документ';
end if;
if d.doc_type not in ('receipt', 'issue', 'writeoff') then
raise exception 'Этот тип документа отменять нельзя';
end if;
for r in
select x.item_id, x.to_loc, sum(x.qty) as qty, i.name
from stock_moves x join items i on i.id = x.item_id
where x.doc_id = p_doc and x.reverses_id is null
and not exists (select 1 from stock_moves y where y.reverses_id = x.id)
group by x.item_id, x.to_loc, i.name
loop
if _bal(r.to_loc, r.item_id) < r.qty then
raise exception 'Нельзя отменить: «%» уже израсходован (нужно вернуть %, есть %)',
r.name, r.qty, _bal(r.to_loc, r.item_id);
end if;
end loop;
for m in
select * from stock_moves x
where x.doc_id = p_doc and x.reverses_id is null
and not exists (select 1 from stock_moves y where y.reverses_id = x.id)
order by x.id
loop
perform _insert_move(m.item_id, m.to_loc, m.from_loc, m.qty, m.unit_cost, 'doc_void',
p_doc::text, m.apartment_id, m.staff_id, p_doc, p_reason, m.moved_at, m.id);
v_n := v_n + 1;
end loop;
update documents
set status = 'void',
note = case when p_reason is null or btrim(p_reason) = '' then note
else coalesce(note || E'\n', '') || 'Отмена: ' || btrim(p_reason) end
where id = p_doc;
return jsonb_build_object('doc_id', p_doc, 'reversed', v_n);
end $function$;


-- ═══════════════════════════════════════════════════════════════
-- transfer_company_owner
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.transfer_company_owner(p_direction text, p_owner_apartment integer, p_lines jsonb, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;


-- ═══════════════════════════════════════════════════════════════
-- report_stock_turnover
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.report_stock_turnover(p_from date, p_to date, p_scope text DEFAULT 'company'::text, p_owner_apartment integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;


-- ═══════════════════════════════════════════════════════════════
-- report_owner_vs_company
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.report_owner_vs_company(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;


-- ═══════════════════════════════════════════════════════════════
-- warehouse_valuation (view definition from pg_get_viewdef)
-- ═══════════════════════════════════════════════════════════════

 SELECT 'company'::text AS scope,
    NULL::integer AS owner_apartment_id,
    i.id AS item_id,
    COALESCE(b.qty, 0::numeric) AS on_hand,
    i.min_stock,
    avg_cost(i.id) AS avg_cost,
    ip.guest_price,
    COALESCE(b.qty, 0::numeric) * avg_cost(i.id) AS stock_value,
    COALESCE(b.qty, 0::numeric) * ip.guest_price AS potential_revenue,
        CASE
            WHEN avg_cost(i.id) IS NULL OR avg_cost(i.id) = 0::numeric OR ip.guest_price IS NULL THEN NULL::numeric
            ELSE round((ip.guest_price - avg_cost(i.id)) / avg_cost(i.id) * 100::numeric, 2)
        END AS margin
   FROM items i
     JOIN categories c ON c.id = i.category_id
     LEFT JOIN stock_balance b ON b.item_id = i.id AND b.loc_id = (( SELECT locations.id
           FROM locations
          WHERE locations.type = 'warehouse'::loc_type
         LIMIT 1))
     LEFT JOIN item_prices ip ON ip.item_id = i.id
  WHERE i.active AND c.kind = 'asset'::item_kind AND is_admin()
UNION ALL
 SELECT 'owner'::text AS scope,
    l.owner_apartment_id,
    i.id AS item_id,
    COALESCE(b.qty, 0::numeric) AS on_hand,
    i.min_stock,
    owner_avg_cost(i.id, l.owner_apartment_id) AS avg_cost,
    ip.guest_price,
    COALESCE(b.qty, 0::numeric) * owner_avg_cost(i.id, l.owner_apartment_id) AS stock_value,
    COALESCE(b.qty, 0::numeric) * ip.guest_price AS potential_revenue,
        CASE
            WHEN owner_avg_cost(i.id, l.owner_apartment_id) IS NULL OR owner_avg_cost(i.id, l.owner_apartment_id) = 0::numeric OR ip.guest_price IS NULL THEN NULL::numeric
            ELSE round((ip.guest_price - owner_avg_cost(i.id, l.owner_apartment_id)) / owner_avg_cost(i.id, l.owner_apartment_id) * 100::numeric, 2)
        END AS margin
   FROM items i
     JOIN categories c ON c.id = i.category_id
     JOIN locations l ON l.type = 'owner_stock'::loc_type
     LEFT JOIN stock_balance b ON b.item_id = i.id AND b.loc_id = l.id
     LEFT JOIN item_prices ip ON ip.item_id = i.id
  WHERE i.active AND c.kind = 'asset'::item_kind AND is_admin();
