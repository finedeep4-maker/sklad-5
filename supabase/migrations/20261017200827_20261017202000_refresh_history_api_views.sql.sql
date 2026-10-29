/*
# Refresh history API views

1. Purpose
- Re-publishes the cleaning history and incident history views using their current definitions.
- Ensures the API schema exposes `sv_cleaning_events.revision` and `sv_apartment_incidents`.

2. Views refreshed
- `sv_cleaning_events`: cleaning history with revision, audit fields, search text, and media paths.
- `sv_apartment_incidents`: incident history with item, author, resolution, and search fields.
- `sv_cleaning_event_lines`: current inventory lines for each cleaning event.

3. Data safety
- No tables or rows are deleted or changed.
- The views only read existing application data.

4. Security
- Security-invoker behavior is preserved.
- Existing RLS policies and grants remain responsible for access control.

5. Important notes
- This refresh addresses stale API metadata after previous view updates.
- The final notification asks PostgREST to reload its schema cache.
*/

create or replace view public.sv_cleaning_events with (security_invoker = true) as
select e.id,
       e.apartment_id,
       e.cleaned_at,
       e.status,
       e.note,
       (select string_agg(s.full_name, ', ' order by s.full_name)
          from cleaning_event_staff es
          join staff s on s.id = es.staff_id
         where es.event_id = e.id) as staff_names,
       e.revision,
       ls.full_name as lead_staff_name,
       p.full_name as author_name,
       e.reversed_at,
       rb.full_name as reversed_by_name,
       e.reverse_reason,
       (select concat_ws(' ',
          p.full_name,
          ls.full_name,
          (select string_agg(s2.full_name, ', ' order by s2.full_name)
             from cleaning_event_staff es2
             join staff s2 on s2.id = es2.staff_id
            where es2.event_id = e.id),
          e.note,
          (select string_agg(i.name, ', ' order by i.name)
             from cleaning_event_lines cel
             join items i on i.id = cel.item_id
            where cel.event_id = e.id and cel.revision = e.revision))) as search_text,
       e.media_paths
  from cleaning_events e
  left join staff ls on ls.id = e.lead_staff_id
  left join profiles p on p.id = e.created_by
  left join profiles rb on rb.id = e.reversed_by
 where is_active_user();

create or replace view public.sv_cleaning_event_lines with (security_invoker = true) as
select cel.event_id,
       cel.item_id,
       i.name as item_name,
       cel.norm_type,
       cel.qty,
       i.base_unit
  from cleaning_event_lines cel
  join cleaning_events e on e.id = cel.event_id
  left join items i on i.id = cel.item_id
 where cel.revision = e.revision and is_active_user();

create or replace view public.sv_apartment_incidents with (security_invoker = true) as
select inc.id,
       inc.apartment_id,
       inc.created_at,
       inc.kind,
       inc.status,
       inc.qty,
       i.name as item_name,
       inc.free_text,
       inc.comment,
       inc.photo_paths,
       p.full_name as author_name,
       inc.resolved_at,
       rp.full_name as resolved_by_name,
       inc.resolution_note,
       concat_ws(' ', i.name, inc.free_text, inc.comment, inc.resolution_note, p.full_name) as search_text
  from incidents inc
  left join items i on i.id = inc.item_id
  left join profiles p on p.id = inc.created_by
  left join profiles rp on rp.id = inc.resolved_by
 where is_active_user();

notify pgrst, 'reload schema';
notify pgrst, 'reload config';