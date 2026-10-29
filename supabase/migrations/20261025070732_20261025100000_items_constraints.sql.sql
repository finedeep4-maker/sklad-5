alter table public.items
  add constraint items_min_stock_nonneg check (min_stock is null or min_stock >= 0);
create unique index if not exists items_name_lower_uidx
  on public.items (lower(btrim(name)));