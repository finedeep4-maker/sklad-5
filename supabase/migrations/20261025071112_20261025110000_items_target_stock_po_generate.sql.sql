alter table public.items
  add column if not exists target_stock numeric(14,3),
  add column if not exists note text;
alter table public.items
  add constraint items_target_stock_check
  check (target_stock is null or (target_stock >= 0 and target_stock >= coalesce(min_stock, 0)));
create or replace function public.po_generate() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_id uuid; v_number text; v_out jsonb := '[]';
begin
  perform pg_advisory_xact_lock(hashtext('po_generate'));
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
    select v_id, t.item_id,
           ceil((greatest(coalesce(i.target_stock, t.min_stock), t.min_stock) - t.qty) / t.pack_size) * t.pack_size
    from to_order t join items i on i.id = t.item_id
    where i.supplier_id is not distinct from s.supplier_id
      and not exists (select 1 from purchase_order_lines l join purchase_orders o on o.id = l.order_id
                      where l.item_id = t.item_id and o.status in ('draft','sent') and o.id <> v_id);
    v_out := v_out || jsonb_build_object('order_id', v_id, 'number', v_number, 'supplier_id', s.supplier_id);
  end loop;
  return v_out;
end $$;