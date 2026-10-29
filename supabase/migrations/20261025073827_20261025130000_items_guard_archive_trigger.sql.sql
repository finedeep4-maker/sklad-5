create or replace function public.trg_guard_archive_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.active and not new.active then
    if exists (select 1 from stock_balance b join locations l on l.id = b.loc_id
               where b.item_id = new.id and l.type in ('warehouse','apartment','holder') and b.qty > 0) then
      raise exception 'Нельзя отключить: у позиции есть остаток (склад, квартиры или руки). Спишите или верните его.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists items_guard_archive on public.items;
create trigger items_guard_archive before update of active on public.items
  for each row execute function public.trg_guard_archive_item();