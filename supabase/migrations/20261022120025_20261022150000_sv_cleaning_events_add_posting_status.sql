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
       e.media_paths,
       e.posting_status
  from cleaning_events e
  left join staff ls on ls.id = e.lead_staff_id
  left join profiles p on p.id = e.created_by
  left join profiles rb on rb.id = e.reversed_by
 where is_active_user();
notify pgrst, 'reload schema';