/*
  # Исправления после ревью переноса склад компании <-> owner

  1. Безопасность: миграции 20261030120000 и 20261030130000 выдали
     GRANT EXECUTE на внутреннюю _insert_move роли authenticated. По lockdown-миграции
     (20261016100000_009) внутренние функции недоступны клиентам; _insert_move
     SECURITY DEFINER и не проверяет is_admin(), поэтому любой вошедший пользователь
     мог бы вызвать её через RPC и записать произвольное движение. Права отзываются.
  2. Отчёты: исходное движение отменённого документа (void_document) оставалось в отчётах,
     потому что отсекались только сами сторно-строки (reverses_id is not null).
     Теперь не учитываются и движения, к которым уже есть сторно.
  3. report_owner_vs_company: *_count считал строки движений, теперь число документов.
  4. Границы периода считаются по Africa/Cairo (как doc_date в transfer_company_owner),
     а не по часовому поясу сессии. Пустые даты = без ограничения.
  Формат ответа обеих функций не менялся.
*/

-- 1. права
revoke all on function public._insert_move(integer, integer, integer, numeric, numeric, text, text, integer, integer, uuid, text, timestamp with time zone, bigint)
  from public, anon, authenticated;

-- 2. report_stock_turnover
create or replace function public.report_stock_turnover(
  p_from date,
  p_to date,
  p_scope text default 'company',
  p_owner_apartment int default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh int := _loc_singleton('warehouse');
  v_loc int;
  v_from timestamptz;
  v_to timestamptz;
  v_rows jsonb;
begin
  if not is_admin() then
    raise exception 'Только администратор' using errcode = '42501';
  end if;

  if p_scope = 'company' then
    v_loc := v_wh;
  elsif p_scope = 'owner' then
    if p_owner_apartment is null then
      raise exception 'Для scope=owner укажите p_owner_apartment';
    end if;
    v_loc := _loc_owner_stock(p_owner_apartment);
    if v_loc is null then
      raise exception 'Owner-склад не найден';
    end if;
  else
    raise exception 'scope должен быть company или owner';
  end if;

  v_from := coalesce(p_from, date '1900-01-01')::timestamp at time zone 'Africa/Cairo';
  v_to   := (coalesce(p_to, date '2100-01-01') + 1)::timestamp at time zone 'Africa/Cairo';

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', r.item_id,
    'item_name', r.item_name,
    'category', r.category,
    'in_qty', r.in_qty,
    'out_qty', r.out_qty,
    'transfer_in_qty', r.transfer_in_qty,
    'transfer_out_qty', r.transfer_out_qty,
    'in_value', r.in_value,
    'out_value', r.out_value,
    'transfer_in_value', r.transfer_in_value,
    'transfer_out_value', r.transfer_out_value
  ) order by r.item_name), '[]'::jsonb) into v_rows
  from (
    select
      i.id as item_id,
      i.name as item_name,
      c.name as category,
      coalesce(sum(m.qty) filter (where m.source_type = 'receipt' and m.to_loc = v_loc), 0) as in_qty,
      coalesce(sum(m.qty) filter (where m.from_loc = v_loc and m.source_type not in ('receipt', 'owner_transfer')), 0) as out_qty,
      coalesce(sum(m.qty) filter (where m.source_type = 'owner_transfer' and m.to_loc = v_loc), 0) as transfer_in_qty,
      coalesce(sum(m.qty) filter (where m.source_type = 'owner_transfer' and m.from_loc = v_loc), 0) as transfer_out_qty,
      coalesce(sum(m.qty * m.unit_cost) filter (where m.source_type = 'receipt' and m.to_loc = v_loc), 0) as in_value,
      coalesce(sum(m.qty * m.unit_cost) filter (where m.from_loc = v_loc and m.source_type not in ('receipt', 'owner_transfer')), 0) as out_value,
      coalesce(sum(m.qty * m.unit_cost) filter (where m.source_type = 'owner_transfer' and m.to_loc = v_loc), 0) as transfer_in_value,
      coalesce(sum(m.qty * m.unit_cost) filter (where m.source_type = 'owner_transfer' and m.from_loc = v_loc), 0) as transfer_out_value
    from public.stock_moves m
    join public.items i on i.id = m.item_id
    join public.categories c on c.id = i.category_id
    where m.moved_at >= v_from
      and m.moved_at < v_to
      and m.reverses_id is null
      and not exists (select 1 from public.stock_moves y where y.reverses_id = m.id)
      and (
        (p_scope = 'company' and (m.from_loc = v_wh or m.to_loc = v_wh))
        or (p_scope = 'owner' and m.owner_apartment_id = p_owner_apartment)
      )
    group by i.id, i.name, c.name
  ) r;

  return v_rows;
end $$;

revoke all on function public.report_stock_turnover(date, date, text, int) from public, anon;
grant execute on function public.report_stock_turnover(date, date, text, int) to authenticated;

-- 3. report_owner_vs_company
create or replace function public.report_owner_vs_company(
  p_from date default null,
  p_to date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh int := _loc_singleton('warehouse');
  v_from timestamptz;
  v_to timestamptz;
  v_res jsonb;
begin
  if not is_admin() then
    raise exception 'Только администратор' using errcode = '42501';
  end if;

  v_from := coalesce(p_from, date '1900-01-01')::timestamp at time zone 'Africa/Cairo';
  v_to   := (coalesce(p_to, date '2100-01-01') + 1)::timestamp at time zone 'Africa/Cairo';

  with t as (
    select m.doc_id, m.qty, m.unit_cost, m.from_loc, m.to_loc
    from public.stock_moves m
    where m.source_type = 'owner_transfer'
      and m.reverses_id is null
      and not exists (select 1 from public.stock_moves y where y.reverses_id = m.id)
      and m.moved_at >= v_from
      and m.moved_at < v_to
  )
  select jsonb_build_object(
    'company', jsonb_build_object(
      'total_items', (select count(*) from public.warehouse_valuation where scope = 'company' and on_hand > 0),
      'stock_value', (select coalesce(sum(stock_value), 0) from public.warehouse_valuation where scope = 'company'),
      'potential_revenue', (select coalesce(sum(potential_revenue), 0) from public.warehouse_valuation where scope = 'company')
    ),
    'owner', jsonb_build_object(
      'total_apartments', (select count(distinct owner_apartment_id) from public.warehouse_valuation where scope = 'owner' and on_hand > 0),
      'total_items', (select count(*) from public.warehouse_valuation where scope = 'owner' and on_hand > 0),
      'stock_value', (select coalesce(sum(stock_value), 0) from public.warehouse_valuation where scope = 'owner'),
      'potential_revenue', (select coalesce(sum(potential_revenue), 0) from public.warehouse_valuation where scope = 'owner')
    ),
    'transfers', jsonb_build_object(
      'to_owner_count', (select count(distinct doc_id) from t where from_loc = v_wh),
      'to_company_count', (select count(distinct doc_id) from t where to_loc = v_wh),
      'to_owner_value', (select coalesce(sum(qty * unit_cost), 0) from t where from_loc = v_wh),
      'to_company_value', (select coalesce(sum(qty * unit_cost), 0) from t where to_loc = v_wh)
    )
  ) into v_res;

  return v_res;
end $$;

revoke all on function public.report_owner_vs_company(date, date) from public, anon;
grant execute on function public.report_owner_vs_company(date, date) to authenticated;

notify pgrst, 'reload schema';
