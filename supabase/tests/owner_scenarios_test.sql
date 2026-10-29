-- Проверка owner-логики. Запускать в Supabase SQL Editor на ТЕСТОВОЙ БД.
-- Скрипт сам откатывает все данные: в конце намеренно падает с ошибкой "ОТЧЁТ", в тексте — результаты.
create or replace function pg_temp.r(n text, c boolean) returns text language sql as
$$ select case when coalesce(c, false) then 'OK    ' else 'FAIL  ' end || n || E'\n' $$;

do $$
declare
  v_admin uuid; rep text := ''; t text; j jsonb; rec record;
  v_bld int; v_O int; v_R int; v_ca int; v_cn int; v_cc int; v_A int; v_B int; v_C int; v_D int; v_inc3 uuid;
  l_wh int; l_O int; l_R int; l_os int; v_inc uuid; v_inc2 uuid; v_mv bigint;
begin
  select id into v_admin from profiles where role = 'admin' and active limit 1;
  if v_admin is null then
    -- в базе нет админа: создаём временного (откатится вместе со всем остальным)
    v_admin := gen_random_uuid();
    insert into auth.users(id, email) values (v_admin, 'zz-test-admin@example.invalid');
    insert into profiles(id, login, full_name, role) values (v_admin, 'zz-test-admin', 'ZZ Test Admin', 'admin');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- данные
  insert into buildings(name) values ('ZZT') returning id into v_bld;
  insert into apartments(building_id, number, code, type) values (v_bld, '1', 'ZZT/1', 'studio') returning id into v_O;
  insert into apartments(building_id, number, code, type) values (v_bld, '2', 'ZZT/2', 'studio') returning id into v_R;
  insert into categories(name, kind) values ('ZZ актив с коэф', 'asset') returning id into v_ca;
  insert into tenant_coefs(category_id, coef) values (v_ca, 1.5);
  insert into categories(name, kind) values ('ZZ актив без коэф', 'asset') returning id into v_cn;
  insert into categories(name, kind) values ('ZZ расходник', 'consumable') returning id into v_cc;
  insert into items(category_id, name) values (v_ca, 'ZZ A') returning id into v_A;
  insert into items(category_id, name) values (v_cn, 'ZZ B') returning id into v_B;
  insert into items(category_id, name) values (v_cc, 'ZZ C') returning id into v_C;
  l_wh := _loc_singleton('warehouse'); l_O := _loc_apartment(v_O); l_R := _loc_apartment(v_R);

  -- T1 флаг owner и полка
  update apartments set is_owner = true where id = v_O;
  l_os := _loc_owner_stock(v_O);
  rep := rep || pg_temp.r('T1 полка owner создана', l_os is not null);
  rep := rep || pg_temp.r('T1b _loc_owner(полка, актив) = owner', _loc_owner(l_os, v_A) = v_O);
  rep := rep || pg_temp.r('T1c _loc_owner(квартира owner, актив) = owner', _loc_owner(l_O, v_A) = v_O);
  rep := rep || pg_temp.r('T1d _loc_owner(квартира owner, расходник) = null', _loc_owner(l_O, v_C) is null);
  rep := rep || pg_temp.r('T1e _loc_owner(склад, актив) = null', _loc_owner(l_wh, v_A) is null);

  -- T2 приход собственника на полку
  perform post_move(p_op => 'receipt', p_item => v_A, p_qty => 2, p_unit_cost => 100, p_owner_apartment => v_O);
  rep := rep || pg_temp.r('T2 остаток полки = 2', _bal(l_os, v_A) = 2);
  rep := rep || pg_temp.r('T2 склад компании не изменился', _bal(l_wh, v_A) = 0);
  rep := rep || pg_temp.r('T2 avg_cost компании пуст', avg_cost(v_A) is null);
  rep := rep || pg_temp.r('T2 owner_avg_cost = 100', owner_avg_cost(v_A, v_O) = 100);
  rep := rep || pg_temp.r('T2 движение помечено owner', (select owner_apartment_id from stock_moves order by id desc limit 1) = v_O);
  rep := rep || pg_temp.r('T3 warehouse_stock по A = 0', coalesce((select qty from warehouse_stock where item_id = v_A), 0) = 0);

  -- T4 выдача актива в owner-квартиру берёт с полки
  perform post_move(p_op => 'issue_apartment', p_item => v_A, p_qty => 1, p_apartment => v_O);
  rep := rep || pg_temp.r('T4 полка = 1, квартира = 1', _bal(l_os, v_A) = 1 and _bal(l_O, v_A) = 1);
  rep := rep || pg_temp.r('T4b owner_stock_balance показывает 1', (select qty from owner_stock_balance where apartment_id = v_O and item_id = v_A) = 1);

  -- T5 расходник идёт со склада компании
  perform post_move(p_op => 'receipt', p_item => v_C, p_qty => 5, p_unit_cost => 10);
  perform post_move(p_op => 'issue_apartment', p_item => v_C, p_qty => 2, p_apartment => v_O);
  rep := rep || pg_temp.r('T5 расходник: склад 3, квартира 2', _bal(l_wh, v_C) = 3 and _bal(l_O, v_C) = 2);
  rep := rep || pg_temp.r('T5 движение расходника без owner', (select owner_apartment_id from stock_moves order by id desc limit 1) is null);

  -- T6 запреты
  t := null;
  begin perform transfer_stock('apartment', v_O, v_R, jsonb_build_array(jsonb_build_object('item_id', v_A, 'qty', 1)));
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('T6a актив owner в другую квартиру запрещён', t like '%Имущество собственника%');

  t := null;
  begin perform _insert_move(v_A, l_os, l_wh, 1, null, 'manual', 't', null, null, null, null, now(), null);
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('T6b полка owner -> склад компании запрещено', t like '%Имущество собственника%');

  perform post_move(p_op => 'receipt', p_item => v_A, p_qty => 1, p_unit_cost => 50);
  t := null;
  begin perform _insert_move(v_A, l_wh, l_O, 1, null, 'manual', 't', null, null, null, null, now(), null);
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('T6c актив компании -> owner-квартира запрещено', t like '%Имущество собственника%');
  rep := rep || pg_temp.r('T6c2 цены раздельны: компания 50, owner 100', avg_cost(v_A) = 50 and owner_avg_cost(v_A, v_O) = 100);

  t := null;
  begin perform _insert_move(v_C, l_wh, l_os, 1, null, 'manual', 't', null, null, null, null, now(), null);
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('T6d расходник на полку owner запрещён', t like '%Имущество собственника%');

  t := null;
  begin update apartments set is_owner = false where id = v_O;
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('T6e снять флаг при наличии активов нельзя', t like '%Сначала верните%');

  -- T7 начисление в owner-квартире
  insert into incidents(apartment_id, item_id, kind, qty, created_by) values (v_O, v_A, 'lost', 1, v_admin) returning id into v_inc;
  j := incident_charge_preview(v_inc);
  rep := rep || pg_temp.r('T7 превью: база 100, источник owner, коэф 1.5 (category)',
    (j->>'base_cost')::numeric = 100 and j->>'base_source' = 'owner' and (j->>'coef')::numeric = 1.5 and j->>'coef_source' = 'category');
  perform approve_incident(v_inc, 'confirm', null, false, '{"tenant_note":"тест"}'::jsonb);
  select * into rec from incident_charges where incident_id = v_inc;
  rep := rep || pg_temp.r('T7 начисление: 100 x 1.5 = 150, owner', rec.base_cost = 100 and rec.coef = 1.5 and rec.amount = 150 and rec.base_source = 'owner' and rec.status = 'pending');
  rep := rep || pg_temp.r('T7 списание помечено owner', (select m.owner_apartment_id from incidents i join stock_moves m on m.id = i.writeoff_move_id where i.id = v_inc) = v_O);
  rep := rep || pg_temp.r('T7 avg_cost компании не затронут', avg_cost(v_A) = 50);

  -- T8 коэффициент не задан
  perform post_move(p_op => 'receipt', p_item => v_B, p_qty => 1, p_unit_cost => 40);
  perform post_move(p_op => 'issue_apartment', p_item => v_B, p_qty => 1, p_apartment => v_R);
  insert into incidents(apartment_id, item_id, kind, qty, created_by) values (v_R, v_B, 'broken', 1, v_admin) returning id into v_inc2;
  j := incident_charge_preview(v_inc2);
  rep := rep || pg_temp.r('T8 превью: коэф не задан, база 40 company', (j->'coef') = 'null'::jsonb and (j->>'base_cost')::numeric = 40 and j->>'base_source' = 'company');
  t := null;
  begin perform approve_incident(v_inc2, 'confirm', null, false, '{}'::jsonb);
  exception when others then t := sqlerrm; end;
  rep := rep || pg_temp.r('T8 без коэф начислить нельзя', t like '%Не задан коэффициент%');
  rep := rep || pg_temp.r('T8 заявка осталась необработанной', (select status::text from incidents where id = v_inc2) = 'new');
  perform approve_incident(v_inc2, 'confirm', null, false, '{"coef":2}'::jsonb);
  select * into rec from incident_charges where incident_id = v_inc2;
  rep := rep || pg_temp.r('T8 ручной коэф: 40 x 2 = 80, company', rec.amount = 80 and rec.base_source = 'company');

  -- T9 статус
  perform set_incident_charge_status(v_inc, 'paid');
  rep := rep || pg_temp.r('T9 статус paid + дата', (select status = 'paid' and status_changed_at is not null from incident_charges where incident_id = v_inc));

  -- T10 коэффициент предмета важнее коэффициента группы
  insert into items(category_id, name) values (v_ca, 'ZZ D') returning id into v_D;
  insert into tenant_coefs(item_id, coef) values (v_D, 3);
  insert into incidents(apartment_id, item_id, kind, qty, created_by) values (v_R, v_D, 'lost', 1, v_admin) returning id into v_inc3;
  j := incident_charge_preview(v_inc3);
  rep := rep || pg_temp.r('T10 коэф предмета 3 (item) важнее группы 1.5', (j->>'coef')::numeric = 3 and j->>'coef_source' = 'item');

  raise exception E'ОТЧЁТ (данные откатаны):\n%', rep;
end $$;
