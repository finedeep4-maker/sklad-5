alter table items add column supplier_id int references suppliers(id) on delete set null;
create function post_document(p_op text, p_lines jsonb, p_apartment int default null, p_staff int default null,
                              p_supplier int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_type doc_type; v_doc uuid; v_number text; v_total numeric := 0; v_n int := 0; r record;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Нет позиций';
  end if;
  v_type := case
    when p_op = 'receipt' then 'receipt'::doc_type
    when p_op in ('issue_apartment','return_apartment','issue_holder','return_holder') then 'issue'::doc_type
    when p_op in ('writeoff_apartment','writeoff_warehouse','writeoff_holder') then 'writeoff'::doc_type
    else null end;
  if v_type is null then raise exception 'Неизвестная операция %', p_op; end if;
  v_number := _next_doc_number(v_type);
  insert into documents(doc_type, number, supplier_id, note)
  values (v_type, v_number, case when p_op = 'receipt' then p_supplier end, p_note)
  returning id into v_doc;
  for r in
    select (e->>'item_id')::int as item_id,
           sum((e->>'qty')::numeric) as qty,
           sum((e->>'qty')::numeric * (e->>'unit_cost')::numeric) filter (where e->>'unit_cost' is not null)
             / nullif(sum((e->>'qty')::numeric) filter (where e->>'unit_cost' is not null), 0) as cost
    from jsonb_array_elements(p_lines) e
    group by 1 order by 1
  loop
    perform post_move(p_op, r.item_id, r.qty, p_apartment, p_staff, v_doc, r.cost, p_note);
    v_total := v_total + r.qty * coalesce(case when p_op = 'receipt' then r.cost end, 0);
    v_n := v_n + 1;
  end loop;
  if p_op = 'receipt' then update documents set total_cost = v_total where id = v_doc; end if;
  return jsonb_build_object('doc_id', v_doc, 'doc_number', v_number, 'lines', v_n);
end $$;
create table inventories (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('apartment','warehouse')),
  apartment_id int references apartments(id),
  status       text not null default 'open' check (status in ('open','closed','void')),
  note         text,
  doc_id       uuid references documents(id),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  closed_by    uuid,
  closed_at    timestamptz,
  check ((scope = 'apartment') = (apartment_id is not null))
);
create unique index inventories_one_open on inventories(scope, coalesce(apartment_id, 0)) where status = 'open';
create table inventory_lines (
  id           bigserial primary key,
  inventory_id uuid not null references inventories(id) on delete cascade,
  item_id      int not null references items(id),
  expected     numeric(14,3) not null,
  actual       numeric(14,3) not null check (actual >= 0),
  decision     text not null default 'pending' check (decision in ('pending','accepted','rejected')),
  move_id      bigint references stock_moves(id),
  unique (inventory_id, item_id)
);
create function _inv_loc(p_inv inventories) returns int
language sql stable set search_path = public as $$
  select case when p_inv.scope = 'warehouse' then _loc_singleton('warehouse') else _loc_apartment(p_inv.apartment_id) end
$$;
create function inventory_start(p_scope text, p_apartment int default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_inv inventories; v_loc int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_scope not in ('apartment','warehouse') then raise exception 'Неизвестная область инвентаризации'; end if;
  if p_scope = 'apartment' and (p_apartment is null or _loc_apartment(p_apartment) is null) then
    raise exception 'Квартира не найдена';
  end if;
  if exists (select 1 from inventories where status = 'open' and scope = p_scope
             and coalesce(apartment_id, 0) = coalesce(p_apartment, 0)) then
    raise exception 'Инвентаризация уже открыта';
  end if;
  insert into inventories(scope, apartment_id, note)
  values (p_scope, case when p_scope = 'apartment' then p_apartment end, p_note) returning * into v_inv;
  v_loc := _inv_loc(v_inv);
  insert into inventory_lines(inventory_id, item_id, expected, actual)
  select v_inv.id, b.item_id, b.qty, b.qty
  from stock_balance b join items i on i.id = b.item_id
  where b.loc_id = v_loc and b.qty > 0 and i.active;
  return v_inv.id;
end $$;
create function inventory_set_actual(p_inventory uuid, p_item int, p_actual numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv inventories;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if p_actual is null or p_actual < 0 then raise exception 'Факт не может быть отрицательным'; end if;
  select * into v_inv from inventories where id = p_inventory for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_inv.status <> 'open' then raise exception 'Инвентаризация закрыта'; end if;
  insert into inventory_lines(inventory_id, item_id, expected, actual)
  values (p_inventory, p_item, _bal(_inv_loc(v_inv), p_item), p_actual)
  on conflict (inventory_id, item_id) do update set actual = excluded.actual, decision = 'pending';
end $$;
create function inventory_close(p_inventory uuid, p_reject_items int[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inv inventories; v_loc int; v_wh int := _loc_singleton('warehouse');
  v_sink int := _loc_singleton('sink'); v_src int := _loc_singleton('source');
  v_doc uuid; v_number text; v_move bigint; v_delta numeric; v_name text;
  r inventory_lines%rowtype; v_short jsonb := '[]'; v_surplus jsonb := '[]'; v_adj int := 0;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into v_inv from inventories where id = p_inventory for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_inv.status <> 'open' then raise exception 'Инвентаризация уже закрыта'; end if;
  v_loc := _inv_loc(v_inv);
  for r in select * from inventory_lines where inventory_id = p_inventory order by item_id loop
    if r.item_id = any(coalesce(p_reject_items, '{}')) then
      update inventory_lines set decision = 'rejected' where id = r.id;
      continue;
    end if;
    v_delta := r.actual - _bal(v_loc, r.item_id);
    v_move := null;
    if v_delta <> 0 then
      if v_doc is null then
        v_number := _next_doc_number('inventory');
        insert into documents(doc_type, number, note)
        values ('inventory', v_number,
                case when v_inv.scope = 'warehouse' then 'Инвентаризация склада'
                     else 'Инвентаризация ' || (select code from apartments where id = v_inv.apartment_id) end)
        returning id into v_doc;
      end if;
      select name into v_name from items where id = r.item_id;
      if v_delta < 0 then
        v_move := _insert_move(r.item_id, v_loc, v_sink, -v_delta, null, 'inventory_adjust', p_inventory::text,
                               v_inv.apartment_id, null, v_doc, 'Недостача по инвентаризации', now(), null);
        v_short := v_short || jsonb_build_object('item_id', r.item_id, 'name', v_name, 'qty', -v_delta);
      else
        v_move := _insert_move(r.item_id, v_src, v_loc, v_delta, null, 'inventory_adjust', p_inventory::text,
                               v_inv.apartment_id, null, v_doc, 'Излишек по инвентаризации', now(), null);
        v_surplus := v_surplus || jsonb_build_object('item_id', r.item_id, 'name', v_name, 'qty', v_delta);
      end if;
      v_adj := v_adj + 1;
    end if;
    update inventory_lines set decision = 'accepted', move_id = v_move where id = r.id;
  end loop;
  update inventories set status = 'closed', closed_by = auth.uid(), closed_at = now(), doc_id = v_doc
  where id = p_inventory;
  if jsonb_array_length(v_short) > 0 then
    insert into events(type, payload)
    values ('inventory_shortage', jsonb_build_object('inventory_id', p_inventory, 'scope', v_inv.scope,
                                                     'apartment_id', v_inv.apartment_id, 'items', v_short));
  end if;
  return jsonb_build_object('doc_id', v_doc, 'doc_number', v_number, 'adjusted', v_adj,
                            'shortages', v_short, 'surpluses', v_surplus);
end $$;
create function inventory_cancel(p_inventory uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  update inventories set status = 'void', closed_by = auth.uid(), closed_at = now()
  where id = p_inventory and status = 'open';
  if not found then raise exception 'Открытая инвентаризация не найдена'; end if;
end $$;
create table po_counters (
  year int primary key,
  last int not null default 0
);
create table purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  number      text unique,
  supplier_id int references suppliers(id),
  status      text not null default 'draft' check (status in ('draft','sent','received','cancelled')),
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  received_at timestamptz
);
create table purchase_order_lines (
  id           bigserial primary key,
  order_id     uuid not null references purchase_orders(id) on delete cascade,
  item_id      int not null references items(id),
  qty          numeric(14,3) not null check (qty > 0),
  unit_cost    numeric(16,6),
  received_qty numeric(14,3) not null default 0 check (received_qty >= 0),
  unique (order_id, item_id)
);
create function _next_po_number() returns text
language plpgsql security definer set search_path = public as $$
declare v_year int := extract(year from (now() at time zone 'Africa/Cairo'))::int; v_n int;
begin
  insert into po_counters(year, last) values (v_year, 1)
  on conflict (year) do update set last = po_counters.last + 1 returning last into v_n;
  return 'ЗК-' || v_year || '-' || lpad(v_n::text, 4, '0');
end $$;
create function po_generate() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_id uuid; v_number text; v_out jsonb := '[]';
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  for s in
    select distinct i.supplier_id
    from to_order t join items i on i.id = t.item_id
    where not exists (select 1 from purchase_order_lines l join purchase_orders o on o.id = l.order_id
                      where l.item_id = t.item_id and o.status in ('draft','sent'))
    order by 1 nulls last
  loop
    v_number := _next_po_number();
    insert into purchase_orders(number, supplier_id) values (v_number, s.supplier_id) returning id into v_id;
    insert into purchase_order_lines(order_id, item_id, qty)
    select v_id, t.item_id, ceil(t.shortage / t.pack_size) * t.pack_size
    from to_order t join items i on i.id = t.item_id
    where i.supplier_id is not distinct from s.supplier_id
      and not exists (select 1 from purchase_order_lines l join purchase_orders o on o.id = l.order_id
                      where l.item_id = t.item_id and o.status in ('draft','sent') and o.id <> v_id);
    v_out := v_out || jsonb_build_object('order_id', v_id, 'number', v_number, 'supplier_id', s.supplier_id);
  end loop;
  return v_out;
end $$;
create function po_set_line(p_order uuid, p_item int, p_qty numeric, p_unit_cost numeric default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if (select status from purchase_orders where id = p_order) is distinct from 'draft' then
    raise exception 'Менять можно только черновик заказа';
  end if;
  if p_qty is null or p_qty <= 0 then
    delete from purchase_order_lines where order_id = p_order and item_id = p_item;
  else
    insert into purchase_order_lines(order_id, item_id, qty, unit_cost) values (p_order, p_item, p_qty, p_unit_cost)
    on conflict (order_id, item_id) do update set qty = excluded.qty, unit_cost = excluded.unit_cost;
  end if;
end $$;
create function po_set_status(p_order uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare o purchase_orders%rowtype;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into o from purchase_orders where id = p_order for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if p_status = 'sent' and o.status = 'draft' then
    if not exists (select 1 from purchase_order_lines where order_id = p_order) then
      raise exception 'В заказе нет позиций';
    end if;
    update purchase_orders set status = 'sent', sent_at = now() where id = p_order;
  elsif p_status = 'cancelled' and o.status in ('draft','sent') then
    if exists (select 1 from purchase_order_lines where order_id = p_order and received_qty > 0) then
      raise exception 'По заказу уже есть приход';
    end if;
    update purchase_orders set status = 'cancelled' where id = p_order;
  else
    raise exception 'Недопустимая смена статуса: % -> %', o.status, p_status;
  end if;
end $$;
create function po_receive(p_order uuid, p_lines jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o purchase_orders%rowtype; v_lines jsonb; v_res jsonb; e jsonb;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into o from purchase_orders where id = p_order for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if o.status <> 'sent' then raise exception 'Принимать можно только отправленный заказ'; end if;
  if p_lines is null then
    select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'qty', qty - received_qty,
                                                 'unit_cost', unit_cost)), '[]')
    into v_lines from purchase_order_lines where order_id = p_order and qty - received_qty > 0;
  else
    v_lines := p_lines;
  end if;
  if jsonb_array_length(v_lines) = 0 then raise exception 'Нечего принимать'; end if;
  for e in select * from jsonb_array_elements(v_lines) loop
    if not exists (select 1 from purchase_order_lines where order_id = p_order and item_id = (e->>'item_id')::int) then
      raise exception 'Позиции нет в заказе';
    end if;
  end loop;
  v_res := post_document('receipt', v_lines, null, null, o.supplier_id, 'Заказ ' || o.number);
  for e in select * from jsonb_array_elements(v_lines) loop
    update purchase_order_lines
    set received_qty = received_qty + (e->>'qty')::numeric,
        unit_cost = coalesce((e->>'unit_cost')::numeric, unit_cost)
    where order_id = p_order and item_id = (e->>'item_id')::int;
  end loop;
  if not exists (select 1 from purchase_order_lines where order_id = p_order and received_qty < qty) then
    update purchase_orders set status = 'received', received_at = now() where id = p_order;
  end if;
  return v_res || jsonb_build_object('order_status', (select status from purchase_orders where id = p_order));
end $$;
create view purchase_orders_v with (security_invoker = true) as
select o.id, o.number, o.status, o.supplier_id, s.name as supplier, o.note, o.created_at, o.sent_at, o.received_at,
       count(l.id) as lines, coalesce(sum(l.qty), 0) as total_qty, coalesce(sum(l.received_qty), 0) as received_qty,
       sum(l.qty * l.unit_cost) as est_cost
from purchase_orders o
left join suppliers s on s.id = o.supplier_id
left join purchase_order_lines l on l.order_id = o.id
group by o.id, s.name;
do $$
declare t text;
begin
  foreach t in array array['inventories','inventory_lines','po_counters','purchase_orders','purchase_order_lines']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
    execute format('revoke all on %I from anon', t);
  end loop;
  foreach t in array array['inventories','purchase_orders']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I
                    for each row execute function audit_row()', t);
  end loop;
end $$;
revoke insert, update, delete on inventories, inventory_lines, purchase_orders, purchase_order_lines from authenticated;
revoke all on po_counters from authenticated;
revoke all on purchase_orders_v from anon;
revoke all on function _inv_loc(inventories), _next_po_number() from public, anon, authenticated;
revoke all on function post_document(text,jsonb,int,int,int,text),
                       inventory_start(text,int,text), inventory_set_actual(uuid,int,numeric),
                       inventory_close(uuid,int[]), inventory_cancel(uuid), po_generate(),
                       po_set_line(uuid,int,numeric,numeric), po_set_status(uuid,text),
                       po_receive(uuid,jsonb) from public, anon;
grant execute on function post_document(text,jsonb,int,int,int,text),
                          inventory_start(text,int,text), inventory_set_actual(uuid,int,numeric),
                          inventory_close(uuid,int[]), inventory_cancel(uuid), po_generate(),
                          po_set_line(uuid,int,numeric,numeric), po_set_status(uuid,text),
                          po_receive(uuid,jsonb) to authenticated;