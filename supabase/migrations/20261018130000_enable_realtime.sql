/*
# Включить Realtime для таблиц приложения

1. Проблема
- Ни одна миграция не добавляла таблицы в публикацию supabase_realtime,
  поэтому подписки postgres_changes (контакты в QR, заявки в админке) не получали событий.

2. Изменения
- Идемпотентно добавляет рабочие таблицы в публикацию supabase_realtime.
- Таблицы profiles, settings, audit_log, attachments, doc_counters, po_counters, apartment_private не добавляются.

3. Безопасность
- Realtime применяет RLS: клиент получает события только по строкам, доступным ему на чтение.
- События DELETE содержат только ключ строки; клиент использует их лишь как сигнал перезагрузки.
*/
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array[
    'apartments','apartment_notes','buildings','categories','items','staff','norm_rules',
    'cleaning_events','cleaning_event_staff','cleaning_event_lines','incidents','contacts',
    'documents','stock_moves','locations','suppliers','inventories','inventory_lines',
    'purchase_orders','purchase_order_lines','events'
  ] loop
    if to_regclass('public.' || t) is not null
       and not exists (
         select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
