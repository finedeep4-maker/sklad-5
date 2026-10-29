alter table public.items
  add column if not exists default_cost numeric(16,6)
  check (default_cost is null or default_cost >= 0);