do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
  loop execute format('revoke all on function %s from public, anon, authenticated', r.sig); end loop;
end $$;

grant execute on function needs_bootstrap() to anon, authenticated;

grant execute on function is_admin(), is_supervisor(), is_manager(), is_active_user(),
  claim_first_admin(text,text),
  post_move(text,int,numeric,int,int,uuid,numeric,text),
  post_document(text,jsonb,int,int,int,text),
  issue_missing_to_apartment(int),
  complete_cleaning(int,timestamptz,uuid,int[],int,text),
  reverse_cleaning(uuid,text), recalculate_cleaning(uuid,timestamptz,int[],int),
  approve_incident(uuid,text,text,boolean),
  inventory_start(text,int,text), inventory_set_actual(uuid,int,numeric),
  inventory_close(uuid,int[]), inventory_cancel(uuid),
  po_generate(), po_set_line(uuid,int,numeric,numeric),
  po_set_status(uuid,text), po_receive(uuid,jsonb)
  to authenticated;

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
