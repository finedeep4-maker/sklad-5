create or replace function public.void_document(p_doc uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d documents%rowtype;
  m stock_moves%rowtype;
  r record;
  v_n int := 0;
begin
  if not is_admin() then
    raise exception 'Только администратор' using errcode = '42501';
  end if;
  select * into d from documents where id = p_doc for update;
  if not found then
    raise exception 'Документ не найден';
  end if;
  if d.status <> 'posted' then
    raise exception 'Отменить можно только проведённый документ';
  end if;
  if d.doc_type not in ('receipt', 'issue', 'writeoff') then
    raise exception 'Этот тип документа отменять нельзя';
  end if;
  for r in
    select x.item_id, x.to_loc, sum(x.qty) as qty, i.name
    from stock_moves x join items i on i.id = x.item_id
    where x.doc_id = p_doc and x.reverses_id is null
      and not exists (select 1 from stock_moves y where y.reverses_id = x.id)
    group by x.item_id, x.to_loc, i.name
  loop
    if _bal(r.to_loc, r.item_id) < r.qty then
      raise exception 'Нельзя отменить: «%» уже израсходован (нужно вернуть %, есть %)',
        r.name, r.qty, _bal(r.to_loc, r.item_id);
    end if;
  end loop;
  for m in
    select * from stock_moves x
    where x.doc_id = p_doc and x.reverses_id is null
      and not exists (select 1 from stock_moves y where y.reverses_id = x.id)
    order by x.id
  loop
    perform _insert_move(m.item_id, m.to_loc, m.from_loc, m.qty, m.unit_cost, 'doc_void',
                         p_doc::text, m.apartment_id, m.staff_id, p_doc, p_reason, m.moved_at, m.id);
    v_n := v_n + 1;
  end loop;
  update documents
     set status = 'void',
         note = case when p_reason is null or btrim(p_reason) = '' then note
                     else coalesce(note || E'\n', '') || 'Отмена: ' || btrim(p_reason) end
   where id = p_doc;
  return jsonb_build_object('doc_id', p_doc, 'reversed', v_n);
end $$;
revoke all on function public.void_document(uuid, text) from public, anon;
grant execute on function public.void_document(uuid, text) to authenticated;