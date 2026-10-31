-- Проверка transfer_company_owner, item_prices, warehouse_valuation, report RPCs.
-- Запускать в Supabase SQL Editor на ТЕСТОВОЙ БД.
-- Скрипт сам откатывает все данные: в конце намеренно падает с ошибкой "ОТЧЁТ", в тексте — результаты.
-- T8 (warehouse_valuation) проверяется ДО сторно, пока на полке owner есть остатки.
-- T7 (void) сторнирует документы в обратном порядке: сначала T3 (to_company), потом T2 (to_owner).
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; t text; j jsonb; v_doc uuid; v_doc2 uuid;
  v_bld int; v_O int; v_R int; v_ca int; v_A int; v_B int;
  v_cc int; v_C int;
  l_wh int; l_os int; l_R int;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-tr-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-tr-admin', 'ZZ TR Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- данные
  insert into buildings(name) values ('ZZTR') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZTR/1', 'studio') returning id into v_O;
  insert into apartments(building_id, number, code, type) values (v_bld, '2', 'ZZTR/2', 'studio') returning id into v_R;
  update apartments set is_owner = true where id = v_O;
  insert into categories(name, kind) values ('ZZ актив', 'asset') returning id into v_ca;
  insert into categories(name, kind) values ('ZZ расходник', 'consumable') returning id into v_cc;
  insert into items(category_id, name) values (v_ca, 'ZZ TR-A') returning id into v_A;
  insert into items(category_id, name) values (v_ca, 'ZZ TR-B') returning id into v_B;
  insert into items(category_id, name) values (v_cc, 'ZZ TR-C') returning id into v_C;
  insert into tenant_coefs(item_id, coef) values (v_A, 2.0);

  l_wh := _loc_singleton('warehouse');
  l_os := _loc_owner_stock(v_O);
  l_R  := _loc_apartment(v_R);

  -- T1 item_prices
  perform post_move(p_op => 'receipt', p_item => v_A, p_qty => 3, p_unit_cost => 100);
  perform post_move(p_op => 'receipt', p_item => v_B, p_qty => 1, p_unit_cost => 50);
  perform post_move(p_op => 'receipt', p_item => v_C, p_qty => 5, p_unit_cost => 10);
  insert into item_prices(item_id, guest_price) values (v_A, 200) on conflict do nothing;
  insert into item_prices(item_id, guest_price) values (v_B, 75) on conflict do nothing;
  rep := rep || pg_temp.r('T1 item_prices для A = 200', (select guest_price from item_prices where item_id = v_A) = 200);
  rep := rep || pg_temp.r('T1 item_prices для B = 75', (select guest_price from item_prices where item_id = v_B) = 75);
  rep := rep || pg_temp.r('T1 расходник C на складе компании', _bal(l_wh, v_C) = 5);

  -- T2 transfer to_owner
  v_doc := transfer_company_owner('to_owner', v_O, jsonb_build_array(
    jsonb_build_object('item_id', v_A, 'qty', 2)
  ), 'ZZTR test transfer');
  rep := rep || pg_temp.r('T2 документ создан', v_doc is not null);
  rep := rep || pg_temp.r('T2 полка owner = 2', _bal(l_os, v_A) = 2);
  rep := rep || pg_temp.r('T2 склад компании = 1', _bal(l_wh, v_A) = 1);
  rep := rep || pg_temp.r('T2 движение помечено owner',
    (select owner_apartment_id from stock_moves where source_type = 'owner_transfer' order by id desc limit 1) = v_O);
  rep := rep || pg_temp.r('T2 source_type = owner_transfer',
    (select source_type from stock_moves where source_type = 'owner_transfer' order by id desc limit 1) = 'owner_transfer');
  rep := rep || pg_temp.r('T2 себестоимость = avg_cost = 100',
    (select unit_cost from stock_moves where source_type = 'owner_transfer' order by id desc limit 1) = 100);

  -- T8 warehouse_valuation (проверяем ДО сторно, пока на полке owner есть остатки)
  rep := rep || pg_temp.r('T8 view company scope',
    (select count(*) > 0 from warehouse_valuation where scope = 'company' and on_hand > 0));
  rep := rep || pg_temp.r('T8 view owner scope',
    (select count(*) > 0 from warehouse_valuation where scope = 'owner' and on_hand > 0 and owner_apartment_id = v_O));
  -- T8a расходник с остатком попадает в scope company (все категории)
  rep := rep || pg_temp.r('T8a расходник C в scope company',
    (select count(*) > 0 from warehouse_valuation where scope = 'company' and item_id = v_C and on_hand > 0));
  -- T8b owner-ветка не содержит строк с нулевым остатком
  rep := rep || pg_temp.r('T8b owner scope без нулевых остатков',
    (select count(*) = 0 from warehouse_valuation where scope = 'owner' and on_hand <= 0));
  -- T8c markup_pct = 100 и margin_pct = 50 для guest_price=200, avg_cost=100
  rep := rep || pg_temp.r('T8c company markup_pct = 100 для A',
    (select markup_pct from warehouse_valuation where scope = 'company' and item_id = v_A) = 100);
  rep := rep || pg_temp.r('T8c company margin_pct = 50 для A',
    (select margin_pct from warehouse_valuation where scope = 'company' and item_id = v_A) = 50);
  rep := rep || pg_temp.r('T8c owner markup_pct = 100 для A',
    (select markup_pct from warehouse_valuation where scope = 'owner' and item_id = v_A and owner_apartment_id = v_O) = 100);
  rep := rep || pg_temp.r('T8c owner margin_pct = 50 для A',
    (select margin_pct from warehouse_valuation where scope = 'owner' and item_id = v_A and owner_apartment_id = v_O) = 50);
  -- T8d старая колонка margin удалена
  rep := rep || pg_temp.r('T8d колонка margin удалена',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'warehouse_valuation' and column_name = 'margin'));

  -- T3 transfer to_company
  v_doc2 := transfer_company_owner('to_company', v_O, jsonb_build_array(
    jsonb_build_object('item_id', v_A, 'qty', 1)
  ), 'ZZTR return');
  rep := rep || pg_temp.r('T3 полка owner = 1', _bal(l_os, v_A) = 1);
  rep := rep || pg_temp.r('T3 склад компании = 2', _bal(l_wh, v_A) = 2);
  rep := rep || pg_temp.r('T3 себестоимость = owner_avg_cost = 100',
    (select unit_cost from stock_moves where source_type = 'owner_transfer' and to_loc = l_wh order by id desc limit 1) = 100);

  -- T3b отчёт оборота до сторно: перенос туда 2, обратно 1
  j := report_stock_turnover('1900-01-01'::date, '2100-01-01'::date, 'owner', v_O);
  rep := rep || pg_temp.r('T3b turnover owner: transfer_in_qty = 2',
    (select (e->>'transfer_in_qty')::numeric from jsonb_array_elements(j) e where (e->>'item_id')::int = v_A) = 2);
  rep := rep || pg_temp.r('T3b turnover owner: transfer_out_qty = 1',
    (select (e->>'transfer_out_qty')::numeric from jsonb_array_elements(j) e where (e->>'item_id')::int = v_A) = 1);

  -- T4 нехватка остатка
  t := null;
  begin
    perform transfer_company_owner('to_owner', v_O, jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 100)
    ));
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('T4 нехватка на складе компании', t is not null and t like '%Не хватает на складе компании%');

  t := null;
  begin
    perform transfer_company_owner('to_company', v_O, jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 100)
    ));
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('T4b нехватка на owner-складе', t is not null and t like '%Нет на складе owner%');

  -- T5 не-owner квартира
  t := null;
  begin
    perform transfer_company_owner('to_owner', v_R, jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 1)
    ));
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('T5 не-owner квартира отклонена', t is not null and t like '%не является owner-квартирой%');

  -- T6 не-админ
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  t := null;
  begin
    perform transfer_company_owner('to_owner', v_O, jsonb_build_array(
      jsonb_build_object('item_id', v_A, 'qty', 1)
    ));
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('T6 не-админ отклонён', t is not null and t like '%Только администратор%');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- T6b не-админ не видит строк warehouse_valuation
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  rep := rep || pg_temp.r('T6b не-админ не видит warehouse_valuation',
    (select count(*) = 0 from warehouse_valuation));
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- T7 сторно документов в обратном порядке: сначала T3 (to_company), потом T2 (to_owner)
  perform void_document(v_doc2, 'ZZTR void T3');
  rep := rep || pg_temp.r('T7 void T3: документ void', (select status from documents where id = v_doc2) = 'void');
  rep := rep || pg_temp.r('T7 void T3: полка owner = 2', _bal(l_os, v_A) = 2);

  perform void_document(v_doc, 'ZZTR void T2');
  rep := rep || pg_temp.r('T7 void T2: документ void', (select status from documents where id = v_doc) = 'void');
  rep := rep || pg_temp.r('T7 void T2: полка owner = 0', _bal(l_os, v_A) = 0);
  rep := rep || pg_temp.r('T7 void T2: склад = 3', _bal(l_wh, v_A) = 3);

  -- T7b отменённые переносы не попадают в отчёт оборота
  j := report_stock_turnover('1900-01-01'::date, '2100-01-01'::date, 'owner', v_O);
  rep := rep || pg_temp.r('T7b turnover owner после сторно: переносов нет',
    coalesce((select sum((e->>'transfer_in_qty')::numeric + (e->>'transfer_out_qty')::numeric) from jsonb_array_elements(j) e), 0) = 0);

  -- T11 _insert_move недоступна клиентским ролям
  rep := rep || pg_temp.r('T11 _insert_move не выполняется authenticated',
    not has_function_privilege('authenticated',
      'public._insert_move(integer,integer,integer,numeric,numeric,text,text,integer,integer,uuid,text,timestamp with time zone,bigint)', 'EXECUTE'));
  rep := rep || pg_temp.r('T11 _insert_move не выполняется anon',
    not has_function_privilege('anon',
      'public._insert_move(integer,integer,integer,numeric,numeric,text,text,integer,integer,uuid,text,timestamp with time zone,bigint)', 'EXECUTE'));

  -- T9 report_owner_vs_company
  j := report_owner_vs_company(null, null);
  rep := rep || pg_temp.r('T9 report есть company.stock_value', (j->'company'->>'stock_value') is not null);
  rep := rep || pg_temp.r('T9 report есть owner.stock_value', (j->'owner'->>'stock_value') is not null);
  rep := rep || pg_temp.r('T9 report есть transfers', (j->'transfers'->>'to_owner_count') is not null);

  -- T10 report_stock_turnover
  j := report_stock_turnover('1900-01-01'::date, '2100-01-01'::date, 'company', null);
  rep := rep || pg_temp.r('T10 turnover company возвращает массив', jsonb_typeof(j) = 'array');
  j := report_stock_turnover('1900-01-01'::date, '2100-01-01'::date, 'owner', v_O);
  rep := rep || pg_temp.r('T10 turnover owner возвращает массив', jsonb_typeof(j) = 'array');

  raise exception E'ОТЧЁТ (данные откатаны):\n%', rep;
end $$;
