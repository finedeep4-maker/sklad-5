create type app_role        as enum ('admin','supervisor');
create type apt_type        as enum ('studio','1br','2br');
create type item_kind       as enum ('asset','consumable');
create type base_unit       as enum ('pcs','g','ml');
create type loc_type        as enum ('warehouse','apartment','holder','sink','source');
create type norm_type       as enum ('asset_standing','turnover_replenish','cleaning_consumption');
create type event_status    as enum ('done','reversed');
create type incident_kind   as enum ('breakdown','broken','lost','other');
create type incident_status as enum ('new','confirmed','rejected');
create type doc_type        as enum ('receipt','issue','writeoff','inventory');
create type doc_status      as enum ('draft','posted','void');
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  login      text not null unique check (login ~ '^[a-z0-9._-]{3,32}$'),
  full_name  text not null,
  role       app_role not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create table settings (
  key   text primary key,
  value jsonb not null
);
create table buildings (
  id   serial primary key,
  name text not null unique
);
create table apartments (
  id          serial primary key,
  building_id int  not null references buildings(id),
  number      text not null,
  code        text not null unique,            -- например 'А1/202'
  type        apt_type not null,
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);
create table apartment_private (
  apartment_id int primary key references apartments(id) on delete cascade,
  owner_name   text,
  owner_phone  text,
  notes        text
);
create table staff (
  id        serial primary key,
  full_name text not null,
  role      text not null default 'housekeeper',
  phone     text,
  active    boolean not null default true
);
create table categories (
  id   serial primary key,
  name text not null unique,
  kind item_kind not null,
  sort int not null default 0
);
create table items (
  id            serial primary key,
  category_id   int not null references categories(id),
  name          text not null unique,
  base_unit     base_unit not null default 'pcs',
  pack_size     numeric(14,3) not null default 1 check (pack_size > 0),
  pack_label    text not null default 'шт',
  min_stock     numeric(14,3),                 -- в базовых единицах
  track_on_hand boolean not null default false, -- учёт «на руках» у хаус киперов
  qr_code       text unique,
  photo_path    text,
  active        boolean not null default true,
  sort          int not null default 0
);
create table suppliers (
  id    serial primary key,
  name  text not null unique,
  phone text,
  note  text
);
create table locations (
  id           serial primary key,
  type         loc_type not null,
  name         text not null,
  apartment_id int unique references apartments(id) on delete cascade,
  staff_id     int unique references staff(id) on delete cascade,
  check ((type = 'apartment') = (apartment_id is not null)),
  check ((type = 'holder')    = (staff_id is not null))
);
create unique index locations_singletons on locations(type) where type in ('warehouse','sink','source');
insert into locations(type, name) values
  ('warehouse','Основной склад'),
  ('sink','Расход (списано)'),
  ('source','Приход / начальный остаток');
create function trg_apartment_location() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into locations(type, name, apartment_id) values ('apartment', new.code, new.id);
  return new;
end $$;
create trigger apartments_location after insert on apartments
  for each row execute function trg_apartment_location();
create function trg_staff_location() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into locations(type, name, staff_id) values ('holder', 'На руках: ' || new.full_name, new.id);
  return new;
end $$;
create trigger staff_location after insert on staff
  for each row execute function trg_staff_location();
create table doc_counters (
  doc_type doc_type not null,
  year     int not null,
  last     int not null default 0,
  primary key (doc_type, year)
);
create table documents (
  id          uuid primary key default gen_random_uuid(),
  doc_type    doc_type not null,
  number      text unique,
  doc_date    date not null default ((now() at time zone 'Africa/Cairo')::date),
  supplier_id int references suppliers(id),
  status      doc_status not null default 'posted',
  note        text,
  total_cost  numeric(14,2),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create table stock_moves (
  id           bigserial primary key,
  item_id      int not null references items(id),
  from_loc     int not null references locations(id),
  to_loc       int not null references locations(id),
  qty          numeric(14,3) not null check (qty > 0),   -- в базовых единицах
  unit_cost    numeric(16,6),                           -- EGP за базовую единицу
  source_type  text not null,                           -- opening|manual|cleaning|cleaning_reversal|incident|...
  source_id    text,
  apartment_id int references apartments(id),           -- центр затрат
  staff_id     int references staff(id),
  doc_id       uuid references documents(id),
  note         text,
  created_by   uuid default auth.uid(),
  moved_at     timestamptz not null default now(),      -- дата операции (для отчётов)
  created_at   timestamptz not null default now(),
  reverses_id  bigint references stock_moves(id),
  check (from_loc <> to_loc)
);
create index stock_moves_item     on stock_moves(item_id);
create index stock_moves_from     on stock_moves(from_loc, item_id);
create index stock_moves_to       on stock_moves(to_loc, item_id);
create index stock_moves_apt_date on stock_moves(apartment_id, moved_at);
create index stock_moves_source   on stock_moves(source_type, source_id);
create unique index stock_moves_one_reversal on stock_moves(reverses_id) where reverses_id is not null;
create function trg_forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Журнал движений нельзя изменять или удалять: сделайте обратную запись';
end $$;
create trigger stock_moves_append_only before update or delete on stock_moves
  for each row execute function trg_forbid_mutation();
create table norm_rules (
  id           bigserial primary key,
  norm_type    norm_type not null,
  apt_type     apt_type,                       -- шаблон по типу квартиры
  apartment_id int references apartments(id) on delete cascade, -- исключение для квартиры
  item_id      int not null references items(id),
  qty          numeric(14,3) not null check (qty >= 0),  -- в базовых единицах; 0 = «не нужно»
  note         text,
  check ((apt_type is not null) <> (apartment_id is not null))
);
create unique index norm_rules_tpl on norm_rules(norm_type, apt_type, item_id)     where apartment_id is null;
create unique index norm_rules_apt on norm_rules(norm_type, apartment_id, item_id) where apt_type is null;
create table cleaning_events (
  id            uuid primary key default gen_random_uuid(),
  client_op_id  uuid not null unique,          -- ключ идемпотентности (генерирует клиент)
  apartment_id  int not null references apartments(id),
  cleaned_at    timestamptz not null default now(),
  lead_staff_id int references staff(id),      -- с чьих «рук» списываются позиции на руках
  status        event_status not null default 'done',
  revision      int not null default 1,
  note          text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  reversed_by   uuid,
  reversed_at   timestamptz,
  reverse_reason text
);
create index cleaning_events_apt on cleaning_events(apartment_id, cleaned_at desc);
create table cleaning_event_staff (
  event_id uuid not null references cleaning_events(id) on delete cascade,
  staff_id int  not null references staff(id),
  primary key (event_id, staff_id)
);
create table cleaning_event_lines (       -- снимок списанного
  id        bigserial primary key,
  event_id  uuid not null references cleaning_events(id) on delete cascade,
  revision  int not null,
  item_id   int not null references items(id),
  norm_type norm_type not null,
  qty       numeric(14,3) not null,
  unit_cost numeric(16,6),
  from_loc  int not null references locations(id),
  move_id   bigint references stock_moves(id)
);
create index cleaning_event_lines_ev on cleaning_event_lines(event_id, revision);
create table incidents (
  id              uuid primary key default gen_random_uuid(),
  apartment_id    int not null references apartments(id),
  item_id         int references items(id),
  free_text       text,
  kind            incident_kind not null,
  qty             numeric(14,3) not null default 1 check (qty > 0),
  status          incident_status not null default 'new',
  photo_paths     text[] not null default '{}',
  comment         text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  resolved_by     uuid,
  resolved_at     timestamptz,
  resolution_note text,
  writeoff_move_id bigint references stock_moves(id)
);
create table apartment_notes (
  id           bigserial primary key,
  apartment_id int not null references apartments(id) on delete cascade,
  author       uuid not null default auth.uid(),
  body         text not null,
  photo_path   text,
  visibility   text not null default 'all' check (visibility in ('all','admin')),
  created_at   timestamptz not null default now()
);
create table attachments (
  id          uuid primary key default gen_random_uuid(),
  doc_id      uuid references documents(id) on delete cascade,
  incident_id uuid references incidents(id) on delete cascade,
  kind        text not null default 'receipt' check (kind in ('receipt','photo','scan')),
  storage_path text not null,
  mime        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create table contacts (
  id           serial primary key,
  group_name   text,
  name         text not null,
  role_title   text,
  phone_e164   text not null check (phone_e164 ~ '^\+[0-9]{8,15}$'),
  has_whatsapp boolean not null default true,
  sort         int not null default 0,
  active       boolean not null default true
);
create table audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  action     text not null,
  table_name text not null,
  row_id     text,
  old_data   jsonb,
  new_data   jsonb
);
create table events (   -- outbox: уведомления и будущие интеграции
  id           bigserial primary key,
  type         text not null,
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb;
begin
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  insert into audit_log(user_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce(j->>'id', j->>'apartment_id', j->>'key'),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
do $$
declare t text;
begin
  foreach t in array array['apartments','apartment_private','staff','categories','items',
                           'norm_rules','profiles','contacts','settings','suppliers']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I
                    for each row execute function audit_row()', t);
  end loop;
end $$;
create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active)
$$;
create function is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'supervisor' and active)
$$;
create function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active)
$$;
create function _loc_singleton(p_type loc_type) returns int
language sql stable set search_path = public as $$
  select id from locations where type = p_type limit 1
$$;
create function _loc_apartment(p_apartment int) returns int
language sql stable set search_path = public as $$
  select id from locations where apartment_id = p_apartment
$$;
create function _loc_holder(p_staff int) returns int
language sql stable set search_path = public as $$
  select id from locations where staff_id = p_staff
$$;
create function _bal(p_loc int, p_item int) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(case when to_loc = p_loc then qty end), 0)
       - coalesce(sum(case when from_loc = p_loc then qty end), 0)
  from stock_moves
  where item_id = p_item and (to_loc = p_loc or from_loc = p_loc)
$$;
create function avg_cost(p_item int) returns numeric
language sql stable set search_path = public as $$
  select sum(m.qty * m.unit_cost) / nullif(sum(m.qty), 0)
  from stock_moves m join locations l on l.id = m.to_loc
  where m.item_id = p_item and l.type = 'warehouse' and m.unit_cost is not null and m.reverses_id is null
$$;
create function _insert_move(p_item int, p_from int, p_to int, p_qty numeric, p_cost numeric,
                             p_src text, p_src_id text, p_apt int, p_staff int, p_doc uuid,
                             p_note text, p_moved timestamptz, p_reverses bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into stock_moves(item_id, from_loc, to_loc, qty, unit_cost, source_type, source_id,
                          apartment_id, staff_id, doc_id, note, moved_at, reverses_id)
  values (p_item, p_from, p_to, p_qty, p_cost, p_src, p_src_id, p_apt, p_staff, p_doc, p_note,
          coalesce(p_moved, now()), p_reverses)
  returning id into v;
  return v;
end $$;
create function _next_doc_number(p_type doc_type) returns text
language plpgsql security definer set search_path = public as $$
declare v_year int := extract(year from (now() at time zone 'Africa/Cairo'))::int; v_n int; v_prefix text;
begin
  insert into doc_counters(doc_type, year, last) values (p_type, v_year, 1)
  on conflict (doc_type, year) do update set last = doc_counters.last + 1
  returning last into v_n;
  v_prefix := case p_type when 'receipt' then 'ПР' when 'issue' then 'ВД'
                          when 'writeoff' then 'СП' else 'ИН' end;
  return v_prefix || '-' || v_year || '-' || lpad(v_n::text, 4, '0');
end $$;
create view stock_balance with (security_invoker = true) as
select loc_id, item_id, sum(q) as qty from (
  select to_loc   as loc_id, item_id,  qty as q from stock_moves
  union all
  select from_loc as loc_id, item_id, -qty as q from stock_moves
) t group by loc_id, item_id;
create view warehouse_stock with (security_invoker = true) as
select i.id as item_id, i.name, c.name as category, c.kind, i.base_unit, i.pack_size, i.pack_label,
       coalesce(b.qty, 0) as qty, i.min_stock,
       (i.min_stock is not null and coalesce(b.qty, 0) < i.min_stock) as below_min
from items i
join categories c on c.id = i.category_id
left join stock_balance b on b.item_id = i.id and b.loc_id = (select id from locations where type = 'warehouse')
where i.active;
create view to_order with (security_invoker = true) as
select item_id, name, category, base_unit, pack_size, pack_label, qty, min_stock,
       (min_stock - qty) as shortage
from warehouse_stock where below_min;
create view effective_norms as
select a.id as apartment_id, n.norm_type, n.item_id, n.qty
from apartments a join norm_rules n on n.apartment_id = a.id
where is_active_user()
union all
select a.id, t.norm_type, t.item_id, t.qty
from apartments a
join norm_rules t on t.apt_type = a.type and t.apartment_id is null
where is_active_user()
  and not exists (select 1 from norm_rules o
                  where o.apartment_id = a.id and o.norm_type = t.norm_type and o.item_id = t.item_id);
create view apartment_gap with (security_invoker = true) as
select n.apartment_id, a.code, n.item_id, i.name, n.qty as norm,
       coalesce(b.qty, 0) as actual, n.qty - coalesce(b.qty, 0) as gap
from effective_norms n
join apartments a on a.id = n.apartment_id
join items i on i.id = n.item_id
left join locations l on l.apartment_id = n.apartment_id
left join stock_balance b on b.loc_id = l.id and b.item_id = n.item_id
where n.norm_type = 'asset_standing';
create view sv_apartments as
select a.id, a.code, b.name as building, a.type, a.status,
       (select max(e.cleaned_at) from cleaning_events e
         where e.apartment_id = a.id and e.status = 'done') as last_cleaned_at
from apartments a join buildings b on b.id = a.building_id
where is_active_user() and a.status = 'active';
create view sv_norms as
select n.apartment_id, n.norm_type, n.item_id, i.name as item_name, i.base_unit, i.pack_label, n.qty
from effective_norms n join items i on i.id = n.item_id
where is_active_user();
create view sv_staff as
select id, full_name from staff where active and role = 'housekeeper' and is_active_user();
create view sv_items as
select i.id, i.name, c.name as category, i.base_unit
from items i join categories c on c.id = i.category_id
where i.active and is_active_user();
create view sv_cleaning_events as
select e.id, e.apartment_id, e.cleaned_at, e.status, e.note,
       (select string_agg(s.full_name, ', ' order by s.full_name)
          from cleaning_event_staff es join staff s on s.id = es.staff_id
         where es.event_id = e.id) as staff_names
from cleaning_events e
where is_active_user();
