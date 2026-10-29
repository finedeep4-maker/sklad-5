-- B1: apartments.is_owner
alter table apartments add column if not exists is_owner boolean not null default false;

-- B2: locations.owner_apartment_id
alter table locations add column if not exists owner_apartment_id int unique references apartments(id) on delete cascade;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'locations_owner_stock_check'
  ) then
    alter table locations
      add constraint locations_owner_stock_check
      check ((type = 'owner_stock') = (owner_apartment_id is not null));
  end if;
end $$;

-- B3: tenant_coef on items and categories
alter table items add column if not exists tenant_coef numeric(8,3) check (tenant_coef is null or tenant_coef > 0);
alter table categories add column if not exists tenant_coef numeric(8,3) check (tenant_coef is null or tenant_coef > 0);

-- B4: stock_moves.owner_apartment_id
alter table stock_moves add column if not exists owner_apartment_id int references apartments(id);
create index if not exists stock_moves_owner_apt on stock_moves(owner_apartment_id) where owner_apartment_id is not null;

-- B5: incident_charges table
create table if not exists incident_charges (
  incident_id     uuid primary key references incidents(id) on delete cascade,
  tenant_note     text,
  base_cost       numeric(16,6) not null check (base_cost >= 0),
  base_source     text not null check (base_source in ('company','owner','manual')),
  coef            numeric(8,3) not null check (coef > 0),
  amount          numeric(14,2) not null,
  status          text not null default 'pending' check (status in ('pending','paid','waived')),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  status_changed_at timestamptz
);
alter table incident_charges enable row level security;
create policy admin_all_incident_charges on incident_charges for all to authenticated
  using (is_admin()) with check (is_admin());
revoke all on incident_charges from anon;

-- B6: helper functions

-- _loc_owner_stock(p_apartment int) returns int
create or replace function public._loc_owner_stock(p_apartment int) returns int
language sql stable security definer set search_path = public as $$
  select id from locations where type = 'owner_stock' and owner_apartment_id = p_apartment limit 1
$$;
revoke all on function public._loc_owner_stock(int) from public, anon;

-- _loc_owner(p_loc int, p_item int) returns int
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
  join apartments a on a.id = l.apartment_id
  where l.id = p_loc
$$;
revoke all on function public._loc_owner(int, int) from public, anon;

-- owner_avg_cost(p_item int, p_apartment int) returns numeric
create or replace function public.owner_avg_cost(p_item int, p_apartment int) returns numeric
language sql stable security definer set search_path = public as $$
  select sum(m.qty * m.unit_cost) / nullif(sum(m.qty), 0)
  from stock_moves m join locations l on l.id = m.to_loc
  where m.item_id = p_item
    and m.unit_cost is not null
    and m.reverses_id is null
    and not exists (select 1 from stock_moves r where r.reverses_id = m.id)
    and (
      (l.type = 'owner_stock' and l.owner_apartment_id = p_apartment)
      or
      (l.type = 'apartment' and l.apartment_id = p_apartment)
    )
$$;
revoke all on function public.owner_avg_cost(int, int) from public, anon;

-- B7: triggers on apartments

-- before update of is_owner: guard against assets with nonzero balance
create or replace function public.trg_apartments_guard_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if new.is_owner = old.is_owner then return new; end if;

  for r in
    select i.id as item_id, i.name,
           coalesce(_bal(_loc_apartment(new.id), i.id), 0) as apt_bal,
           coalesce(_bal(_loc_owner_stock(new.id), i.id), 0) as stock_bal
    from items i
    join categories c on c.id = i.category_id
    where c.kind = 'asset'
  loop
    if coalesce(r.apt_bal, 0) <> 0 or coalesce(r.stock_bal, 0) <> 0 then
      raise exception 'Сначала верните или спишите предметы (мебель, техника) из квартиры';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.trg_apartments_guard_owner() from public, anon;

drop trigger if exists apartments_guard_owner on apartments;
create trigger apartments_guard_owner
  before update of is_owner on apartments
  for each row execute function trg_apartments_guard_owner();

-- after insert or update of is_owner: create owner_stock location
create or replace function public.trg_apartments_ensure_owner_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_owner then
    insert into locations(type, name, owner_apartment_id)
    values ('owner_stock', 'Owner: ' || new.code, new.id)
    on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.trg_apartments_ensure_owner_stock() from public, anon;

drop trigger if exists apartments_ensure_owner_stock on apartments;
create trigger apartments_ensure_owner_stock
  after insert or update of is_owner on apartments
  for each row execute function trg_apartments_ensure_owner_stock();

-- RLS: allow admins to update apartments (admin_all already grants all, verify)
-- admin_all policy already exists on apartments from 001; no change needed.