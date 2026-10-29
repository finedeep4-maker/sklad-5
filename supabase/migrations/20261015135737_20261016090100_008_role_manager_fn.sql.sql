create or replace function is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid()
                 and role::text in ('supervisor','manager') and active)
$$;
create or replace function is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid()
                 and role::text = 'manager' and active)
$$;
revoke all on function is_manager() from public, anon;
grant execute on function is_manager() to authenticated;