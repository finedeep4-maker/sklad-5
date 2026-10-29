/*
# Hardening Phase 2: events_ack, view columns, unit-change guard, indexes, storage, function fixes

## 1. New function: events_ack(p_ids bigint[])
   - SECURITY DEFINER, set search_path = public
   - Only is_admin() can call
   - Sets processed_at = now() on unprocessed events matching the given IDs
   - Grant execute to authenticated

## 2. View column additions
   - sv_norms: add i.pack_size at the end
   - sv_items: add i.pack_size, i.pack_label at the end
   - All other columns unchanged; recreated with CREATE OR REPLACE VIEW

## 3. Trigger: guard base_unit changes on items
   - BEFORE UPDATE trigger on items
   - If base_unit changed AND (stock_moves or norm_rules reference the item), raise exception
   - errcode 23514

## 4. incidents: add client_op_id column
   - uuid, nullable
   - Unique index where client_op_id is not null (idempotency for incident submission)

## 5. New indexes (all IF NOT EXISTS)
   - stock_moves(doc_id) where doc_id is not null
   - stock_moves(moved_at desc, id desc)
   - norm_rules(apartment_id) where apartment_id is not null
   - attachments(doc_id)
   - attachments(incident_id)
   - incidents(created_at desc)
   - incidents(apartment_id)
   - apartment_notes(apartment_id, created_at desc)
   - events(type, created_at desc) where processed_at is null
   - items(category_id)
   - documents(created_at desc)

## 6. Storage policy + bucket limits
   - SELECT policy on storage.objects for authenticated on incident-photos bucket
     where folder level 2 = 'notes' and is_active_user()
   - Bucket limits: incident-photos 50MB, receipts 10MB
   - MIME allowlists via storage.buckets update

## 7. Function replacements (bodies from prior migrations, only specified changes)
   a) complete_cleaning: validate all p_staff_ids exist in staff before inserting
   b) recalculate_cleaning: if p_staff_ids and p_lead_staff_id given and lead not in list, append lead
   c) po_generate: first line perform pg_advisory_xact_lock(hashtext('po_generate'))
   All other function bodies identical. Privileges re-granted after replace.
*/

-- =========================================================
-- 1. events_ack function
-- =========================================================
create or replace function events_ack(p_ids bigint[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  update events set processed_at = now()
  where id = any(p_ids) and processed_at is null;
end $$;
revoke all on function events_ack(bigint[]) from public, anon;
grant execute on function events_ack(bigint[]) to authenticated;

-- =========================================================
-- 2. View column additions
-- =========================================================
create or replace view sv_norms as
select n.apartment_id, n.norm_type, n.item_id, i.name as item_name, i.base_unit, i.pack_label, n.qty, i.pack_size
from effective_norms n join items i on i.id = n.item_id
where is_active_user();

create or replace view sv_items as
select i.id, i.name, c.name as category, i.base_unit, i.pack_size, i.pack_label
from items i join categories c on c.id = i.category_id
where i.active and is_active_user();

-- =========================================================
-- 3. Trigger: guard base_unit changes on items
-- =========================================================
create or replace function trg_guard_base_unit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.base_unit is distinct from old.base_unit then
    if exists (select 1 from stock_moves where item_id = new.id) then
      raise exception 'Нельзя менять единицу: у позиции есть история или нормы' using errcode = '23514';
    end if;
    if exists (select 1 from norm_rules where item_id = new.id) then
      raise exception 'Нельзя менять единицу: у позиции есть история или нормы' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists items_guard_base_unit on items;
create trigger items_guard_base_unit
  before update of base_unit on items
  for each row execute function trg_guard_base_unit();

-- =========================================================
-- 4. incidents: client_op_id column
-- =========================================================
alter table incidents add column if not exists client_op_id uuid;
create unique index if not exists incidents_client_op_id_uidx
  on incidents(client_op_id) where client_op_id is not null;

-- =========================================================
-- 5. Indexes
-- =========================================================
create index if not exists stock_moves_doc_id on stock_moves(doc_id) where doc_id is not null;
create index if not exists stock_moves_moved_at_id on stock_moves(moved_at desc, id desc);
create index if not exists norm_rules_apt on norm_rules(apartment_id) where apartment_id is not null;
create index if not exists attachments_doc on attachments(doc_id);
create index if not exists attachments_incident on attachments(incident_id);
create index if not exists incidents_created on incidents(created_at desc);
create index if not exists incidents_apt on incidents(apartment_id);
create index if not exists apartment_notes_apt_created on apartment_notes(apartment_id, created_at desc);
create index if not exists events_unprocessed on events(type, created_at desc) where processed_at is null;
create index if not exists items_category on items(category_id);
create index if not exists documents_created on documents(created_at desc);

-- =========================================================
-- 6. Storage: SELECT policy + bucket limits
-- =========================================================
drop policy if exists incident_photos_notes_read on storage.objects;
create policy incident_photos_notes_read on storage.objects for select to authenticated
  using (bucket_id = 'incident-photos' and public.is_active_user()
         and (storage.foldername(name))[2] = 'notes');

update storage.buckets set
  file_size_limit = 52428800,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']
where id = 'incident-photos';

update storage.buckets set
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
where id = 'receipts';

-- =========================================================
-- 7a. complete_cleaning — validate staff exist before insert
-- =========================================================
create or replace function complete_cleaning(p_apartment_id int,
                                  p_cleaned_at timestamptz default now(),
                                  p_client_op_id uuid default gen_random_uuid(),
                                  p_staff_ids int[] default '{}',
                                  p_lead_staff_id int default null,
                                  p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_lead int := p_lead_staff_id; v_res jsonb; v_staff int;
begin
  if not (is_admin() or is_supervisor()) then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if not exists (select 1 from apartments where id = p_apartment_id) then raise exception 'Квартира не найдена'; end if;
  if v_lead is null and coalesce(array_length(p_staff_ids, 1), 0) > 0 then v_lead := p_staff_ids[1]; end if;
  if v_lead is not null and not (v_lead = any (p_staff_ids)) then
    p_staff_ids := p_staff_ids || v_lead;
  end if;
  -- validate all staff IDs exist
  if coalesce(array_length(p_staff_ids, 1), 0) > 0 then
    if exists (select 1 from unnest(p_staff_ids) as s(id)
               where not exists (select 1 from staff where id = s.id)) then
      raise exception 'Сотрудник не найден';
    end if;
  end if;
  insert into cleaning_events(client_op_id, apartment_id, cleaned_at, lead_staff_id, note)
  values (p_client_op_id, p_apartment_id, coalesce(p_cleaned_at, now()), v_lead, p_note)
  on conflict (client_op_id) do nothing
  returning id into v_id;
  if v_id is null then   -- повтор того же запроса: ничего не списываем
    select id into v_id from cleaning_events where client_op_id = p_client_op_id;
    return _cleaning_summary(v_id) || jsonb_build_object('duplicate', true, 'shortages', '[]'::jsonb);
  end if;
  foreach v_staff in array coalesce(p_staff_ids, '{}') loop
    insert into cleaning_event_staff(event_id, staff_id) values (v_id, v_staff) on conflict do nothing;
  end loop;
  v_res := _post_cleaning_lines(v_id, 1);
  insert into events(type, payload)
  values ('cleaning_done', jsonb_build_object('event_id', v_id, 'apartment_id', p_apartment_id));
  return _cleaning_summary(v_id) || jsonb_build_object('duplicate', false, 'shortages', v_res->'shortages');
end $$;
revoke all on function complete_cleaning(int,timestamptz,uuid,int[],int,text) from public, anon;
grant execute on function complete_cleaning(int,timestamptz,uuid,int[],int,text) to authenticated;

-- =========================================================
-- 7b. recalculate_cleaning — append lead to staff_ids if missing
-- =========================================================
create or replace function recalculate_cleaning(p_event uuid,
                                     p_cleaned_at timestamptz default null,
                                     p_staff_ids int[] default null,
                                     p_lead_staff_id int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rev int; v_res jsonb; v_staff int;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  if (select status from cleaning_events where id = p_event) is distinct from 'done' then
    raise exception 'Пересчитывать можно только действующую уборку';
  end if;
  -- if staff_ids and lead given and lead not in list, append lead
  if p_staff_ids is not null and p_lead_staff_id is not null
     and not (p_lead_staff_id = any(p_staff_ids)) then
    p_staff_ids := p_staff_ids || p_lead_staff_id;
  end if;
  perform _reverse_cleaning_moves(p_event, 'Пересчёт уборки');
  update cleaning_events
     set revision = revision + 1,
         cleaned_at = coalesce(p_cleaned_at, cleaned_at),
         lead_staff_id = coalesce(p_lead_staff_id, lead_staff_id)
   where id = p_event returning revision into v_rev;
  if p_staff_ids is not null then
    delete from cleaning_event_staff where event_id = p_event;
    foreach v_staff in array p_staff_ids loop
      insert into cleaning_event_staff(event_id, staff_id) values (p_event, v_staff) on conflict do nothing;
    end loop;
  end if;
  v_res := _post_cleaning_lines(p_event, v_rev);
  insert into events(type, payload) values ('cleaning_recalculated', jsonb_build_object('event_id', p_event, 'revision', v_rev));
  return _cleaning_summary(p_event) || jsonb_build_object('shortages', v_res->'shortages');
end $$;
revoke all on function recalculate_cleaning(uuid,timestamptz,int[],int) from public, anon;
grant execute on function recalculate_cleaning(uuid,timestamptz,int[],int) to authenticated;

-- =========================================================
-- 7c. po_generate — advisory lock as first statement
-- =========================================================
create or replace function po_generate() returns jsonb
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
    select v_id, t.item_id, ceil(t.shortage / t.pack_size) * t.pack_size
    from to_order t join items i on i.id = t.item_id
    where i.supplier_id is not distinct from s.supplier_id
      and not exists (select 1 from purchase_order_lines l join purchase_orders o on o.id = l.order_id
                      where l.item_id = t.item_id and o.status in ('draft','sent') and o.id <> v_id);
    v_out := v_out || jsonb_build_object('order_id', v_id, 'number', v_number, 'supplier_id', s.supplier_id);
  end loop;
  return v_out;
end $$;
revoke all on function po_generate() from public, anon;
grant execute on function po_generate() to authenticated;
