create table if not exists public.rooms (
  id serial primary key,
  name text not null unique,
  sort int not null default 0,
  active boolean not null default true
);

insert into public.rooms (name, sort) values
  ('Ресепшен', 1), ('Спальня', 2), ('Кухня', 3),
  ('Ванная', 4), ('Балкон', 5)
on conflict (name) do nothing;

create table if not exists public.room_norms (
  id bigserial primary key,
  apt_type apt_type,
  apartment_id int references public.apartments(id) on delete cascade,
  room_id int not null references public.rooms(id),
  item_id int not null references public.items(id),
  qty numeric(14,3) not null check (qty >= 0),
  check ((apt_type is not null) <> (apartment_id is not null))
);
create unique index if not exists room_norms_tpl
  on public.room_norms (apt_type, room_id, item_id) where apartment_id is null;
create unique index if not exists room_norms_apt
  on public.room_norms (apartment_id, room_id, item_id) where apt_type is null;
create index if not exists room_norms_item_idx on public.room_norms (item_id);

create table if not exists public.room_stock (
  id bigserial primary key,
  apartment_id int not null references public.apartments(id) on delete cascade,
  room_id int not null references public.rooms(id),
  item_id int not null references public.items(id),
  qty numeric(14,3) not null check (qty >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (apartment_id, room_id, item_id)
);
create index if not exists room_stock_item_idx on public.room_stock (item_id);

alter table public.rooms enable row level security;
alter table public.room_norms enable row level security;
alter table public.room_stock enable row level security;

drop policy if exists admin_all on public.rooms;
create policy admin_all on public.rooms for all to authenticated
  using (is_admin()) with check (is_admin());
drop policy if exists rooms_read_active on public.rooms;
create policy rooms_read_active on public.rooms for select to authenticated
  using (is_active_user());

drop policy if exists admin_all on public.room_norms;
create policy admin_all on public.room_norms for all to authenticated
  using (is_admin()) with check (is_admin());
drop policy if exists room_norms_read_active on public.room_norms;
create policy room_norms_read_active on public.room_norms for select to authenticated
  using (is_active_user());

drop policy if exists admin_all on public.room_stock;
create policy admin_all on public.room_stock for all to authenticated
  using (is_admin()) with check (is_admin());
drop policy if exists room_stock_read_active on public.room_stock;
create policy room_stock_read_active on public.room_stock for select to authenticated
  using (is_active_user());

revoke all on public.rooms, public.room_norms, public.room_stock from anon;
grant select, insert, update, delete on public.rooms, public.room_norms, public.room_stock to authenticated;
grant usage, select on sequence public.rooms_id_seq, public.room_norms_id_seq, public.room_stock_id_seq to authenticated;
