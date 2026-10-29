-- Коэффициенты для жильцов переносятся из items/categories в отдельную таблицу tenant_coefs,
-- доступную только админу (items и categories читают все активные пользователи).
create table if not exists public.tenant_coefs (
  id          bigint generated always as identity primary key,
  item_id     int unique references public.items(id) on delete cascade,
  category_id int unique references public.categories(id) on delete cascade,
  coef        numeric(8,3) not null check (coef > 0),
  updated_at  timestamptz not null default now(),
  check ((item_id is not null)::int + (category_id is not null)::int = 1)
);
alter table public.tenant_coefs enable row level security;
drop policy if exists admin_all_tenant_coefs on public.tenant_coefs;
create policy admin_all_tenant_coefs on public.tenant_coefs for all to authenticated
  using (is_admin()) with check (is_admin());
revoke all on public.tenant_coefs from anon;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='items' and column_name='tenant_coef') then
    insert into public.tenant_coefs(item_id, coef)
      select id, tenant_coef from public.items where tenant_coef is not null
      on conflict (item_id) do nothing;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='categories' and column_name='tenant_coef') then
    insert into public.tenant_coefs(category_id, coef)
      select id, tenant_coef from public.categories where tenant_coef is not null
      on conflict (category_id) do nothing;
  end if;
end $$;

create or replace function public.approve_incident(p_incident uuid, p_decision text, p_note text default null,
                                        p_force boolean default false, p_charge jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i incidents%rowtype; v_move bigint; v_apt int;
  v_base numeric; v_coef numeric; v_amount numeric;
  v_base_source text; v_coef_source text;
  v_owner int; v_move_rec stock_moves%rowtype;
  v_item_tenant numeric; v_cat_tenant numeric;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into i from incidents where id = p_incident;
  if not found or i.status not in ('new','in_progress') then
    raise exception 'Заявка не найдена или уже обработана';
  end if;

  if p_decision = 'reject' then
    update incidents set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
     where id = p_incident;
    return jsonb_build_object('status', 'rejected');
  elsif p_decision <> 'confirm' then
    raise exception 'Решение должно быть confirm или reject';
  end if;

  if i.item_id is not null then
    v_apt := _loc_apartment(i.apartment_id);
    if not p_force and _bal(v_apt, i.item_id) < i.qty then raise exception 'Нет в апартаменте'; end if;
    v_move := _insert_move(i.item_id, v_apt, _loc_singleton('sink'), i.qty, null, 'incident', i.id::text,
                           i.apartment_id, null, null, i.kind::text || ': ' || coalesce(i.comment, ''), now(), null);
  end if;

  update incidents set status = 'confirmed', resolved_by = auth.uid(), resolved_at = now(),
                       resolution_note = p_note, writeoff_move_id = v_move where id = p_incident;

  -- charge
  if p_charge is not null then
    -- base_cost
    if p_charge ? 'base_cost' and (p_charge->>'base_cost') is not null then
      v_base := (p_charge->>'base_cost')::numeric;
      v_base_source := 'manual';
    elsif v_move is not null then
      select * into v_move_rec from stock_moves where id = v_move;
      if v_move_rec.unit_cost is null then
        raise exception 'Укажите закупочную цену';
      end if;
      v_base := v_move_rec.unit_cost;
      if v_move_rec.owner_apartment_id is not null then
        v_base_source := 'owner';
      else
        v_base_source := 'company';
      end if;
    else
      raise exception 'Укажите закупочную цену';
    end if;

    -- coef: explicit → items → categories
    if p_charge ? 'coef' and (p_charge->>'coef') is not null then
      v_coef := (p_charge->>'coef')::numeric;
      v_coef_source := 'manual';
    else
      select coef into v_item_tenant from tenant_coefs where item_id = i.item_id;
      if v_item_tenant is not null then
        v_coef := v_item_tenant;
        v_coef_source := 'item';
      else
        select tc.coef into v_cat_tenant
          from items i2 join tenant_coefs tc on tc.category_id = i2.category_id where i2.id = i.item_id;
        if v_cat_tenant is not null then
          v_coef := v_cat_tenant;
          v_coef_source := 'category';
        else
          raise exception 'Не задан коэффициент для жильцов: укажите его в заявке или в каталоге';
        end if;
      end if;
    end if;

    if v_coef is null or v_coef <= 0 then
      raise exception 'Не задан коэффициент для жильцов: укажите его в заявке или в каталоге';
    end if;

    v_amount := round(i.qty * v_base * v_coef, 2);

    insert into incident_charges(incident_id, tenant_note, base_cost, base_source, coef, amount, status, created_by)
    values (p_incident, p_charge->>'tenant_note', v_base, v_base_source, v_coef, v_amount, 'pending', auth.uid())
    on conflict (incident_id) do nothing;
  end if;

  return jsonb_build_object('status', 'confirmed', 'move_id', v_move);
end $$;
revoke all on function public.approve_incident(uuid, text, text, boolean, jsonb) from public, anon;
grant execute on function public.approve_incident(uuid, text, text, boolean, jsonb) to authenticated;

-- D13: incident_charge_preview(p_incident uuid) returns jsonb (admin)
create or replace function public.incident_charge_preview(p_incident uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  i incidents%rowtype; v_base numeric; v_owner int;
  v_base_source text; v_item_tenant numeric; v_cat_tenant numeric; v_coef numeric; v_coef_source text;
begin
  if not is_admin() then raise exception 'Только администратор' using errcode = '42501'; end if;
  select * into i from incidents where id = p_incident;
  if not found then raise exception 'Заявка не найдена'; end if;

  v_owner := _loc_owner(_loc_apartment(i.apartment_id), i.item_id);
  if v_owner is not null then
    v_base := owner_avg_cost(i.item_id, v_owner);
    v_base_source := 'owner';
  else
    v_base := avg_cost(i.item_id);
    v_base_source := 'company';
  end if;

  select coef into v_item_tenant from tenant_coefs where item_id = i.item_id;
  if v_item_tenant is not null then
    v_coef := v_item_tenant; v_coef_source := 'item';
  else
    select tc.coef into v_cat_tenant
      from items it join tenant_coefs tc on tc.category_id = it.category_id where it.id = i.item_id;
    if v_cat_tenant is not null then
      v_coef := v_cat_tenant; v_coef_source := 'category';
    else
      v_coef := null; v_coef_source := null;
    end if;
  end if;

  return jsonb_build_object(
    'qty', i.qty,
    'item_id', i.item_id,
    'base_cost', v_base,
    'base_source', v_base_source,
    'coef', v_coef,
    'coef_source', v_coef_source
  );
end $$;
revoke all on function public.incident_charge_preview(uuid) from public, anon;
grant execute on function public.incident_charge_preview(uuid) to authenticated;

alter table public.items drop column if exists tenant_coef;
alter table public.categories drop column if exists tenant_coef;

notify pgrst, 'reload schema';