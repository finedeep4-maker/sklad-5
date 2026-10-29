/*
# 017 — Fix SECURITY DEFINER views and grant read access consistently

1. Problem
- Eight views (sv_apartments, sv_norms, sv_staff, sv_items, sv_cleaning_events,
  sv_cleaning_event_lines, sv_apartment_incidents, effective_norms) were created
  WITHOUT `security_invoker = true`. As SECURITY DEFINER views they run with the
  view owner's rights and bypass RLS on the underlying tables.
- Two of them (sv_apartment_incidents, sv_cleaning_event_lines) were also granted
  to the `anon` role, giving unauthenticated Data API access to incidents and
  cleaning line items.
- The underlying base tables are guarded by admin-only policies
  (admin_all USING is_admin()). The definer views were the ONLY read path for
  supervisors/managers. Switching the views to security_invoker without adding
  read policies would cut supervisors off from all data, so this migration also
  adds explicit read policies matching the app's access model:
  - reference/catalog data (buildings, apartments, staff, items, categories,
    norm_rules, locations): readable by every ACTIVE authenticated user
  - cleaning_events / cleaning_event_staff / cleaning_event_lines: readable by
    every active authenticated user (cleaning history is shared across
    supervisors/managers/admins in the UI; writes stay admin-only)
  - incidents: keep the existing per-user policy (active users read their own;
    admins see all) — sv_apartment_incidents view just re-filters through
    is_active_user()
  - profiles: keep admin_all + sv_own_profile
- 017 also fixes the one function the linter flagged for a mutable search_path
  (trg_forbid_mutation) and revokes the anon-executable trigger helper
  trg_guard_base_unit from anon.

2. Changes
2.1 Views
- Recreate all 8 views with `with (security_invoker = true)`.
- Column order for sv_cleaning_events is preserved (media_paths stays last) so
  existing clients that select * keep working.
2.2 New SELECT policies (read-only, authenticated, active users)
- buildings_read_active, apartments_read_active, staff_read_active,
  items_read_active, categories_read_active, norm_rules_read_active,
  locations_read_active: USING (is_active_user())
- cleaning_events_read_active / cleaning_event_staff_read_active /
  cleaning_event_lines_read_active: USING (is_active_user())
2.3 Function hardening
- ALTER FUNCTION trg_forbid_mutation SET search_path = public, pg_temp;
- REVOKE EXECUTE on trg_guard_base_unit from anon (trigger helper, never called
  directly; needs_bootstrap stays anon-executable on purpose — the bootstrap
  screen uses it before any user exists).

3. Security
- All views now enforce the caller's RLS instead of bypassing it.
- anon loses all access to the two previously exposed views.
- New policies are SELECT-only; writes remain admin-only (plus the existing
  SECURITY DEFINER functions with their own internal checks).
- Idempotent: DROP POLICY IF EXISTS / CREATE OR REPLACE VIEW.
*/

-- 2.1 Recreate views as security invoker -------------------------------

create or replace view public.effective_norms with (security_invoker = true) as
select a.id as apartment_id, n.norm_type, n.item_id, n.qty
from apartments a join norm_rules n on n.apartment_id = a.id
where is_active_user()
union all
select a.id, t.norm_type, t.item_id, t.qty
from apartments a
join norm_rules t on t.apt_type = a.type and t.apartment_id is null
where is_active_user()
  and not exists (select 1 from norm_rules o
                  where o.apartment_id = a.id and o.norm_type = t.norm_type and o.item_id = t.item_id);

create or replace view public.sv_apartments with (security_invoker = true) as
select a.id, a.code, b.name as building, a.type, a.status,
       (select max(e.cleaned_at) from cleaning_events e
         where e.apartment_id = a.id and e.status = 'done') as last_cleaned_at
from apartments a join buildings b on b.id = a.building_id
where is_active_user() and a.status = 'active';

create or replace view public.sv_norms with (security_invoker = true) as
select n.apartment_id, n.norm_type, n.item_id, i.name as item_name, i.base_unit, i.pack_label, n.qty, i.pack_size
from effective_norms n join items i on i.id = n.item_id
where is_active_user();

create or replace view public.sv_staff with (security_invoker = true) as
select id, full_name from staff where active and role = 'housekeeper' and is_active_user();

create or replace view public.sv_items with (security_invoker = true) as
select i.id, i.name, c.name as category, i.base_unit, i.pack_size, i.pack_label
from items i join categories c on c.id = i.category_id
where i.active and is_active_user();

create or replace view public.sv_cleaning_events with (security_invoker = true) as
select e.id, e.apartment_id, e.cleaned_at, e.status, e.note,
       (select string_agg(s.full_name, ', ' order by s.full_name)
          from cleaning_event_staff es join staff s on s.id = es.staff_id
         where es.event_id = e.id) as staff_names,
       e.revision,
       ls.full_name as lead_staff_name,
       p.full_name as author_name,
       e.reversed_at,
       rb.full_name as reversed_by_name,
       e.reverse_reason,
       (select concat_ws(' ',
          p.full_name, ls.full_name,
          (select string_agg(s2.full_name, ', ' order by s2.full_name)
             from cleaning_event_staff es2 join staff s2 on s2.id = es2.staff_id
            where es2.event_id = e.id),
          e.note,
          (select string_agg(i.name, ', ' order by i.name)
             from cleaning_event_lines cel join items i on i.id = cel.item_id
            where cel.event_id = e.id and cel.revision = e.revision))) as search_text,
       e.media_paths
from cleaning_events e
left join staff ls on ls.id = e.lead_staff_id
left join profiles p on p.id = e.created_by
left join profiles rb on rb.id = e.reversed_by
where is_active_user();

create or replace view public.sv_cleaning_event_lines with (security_invoker = true) as
select cel.event_id, cel.item_id, i.name as item_name, cel.norm_type, cel.qty, i.base_unit
from cleaning_event_lines cel
join cleaning_events e on e.id = cel.event_id
left join items i on i.id = cel.item_id
where cel.revision = e.revision and is_active_user();

create or replace view public.sv_apartment_incidents with (security_invoker = true) as
select inc.id, inc.apartment_id, inc.created_at, inc.kind, inc.status, inc.qty,
       i.name as item_name, inc.free_text, inc.comment, inc.photo_paths,
       p.full_name as author_name, inc.resolved_at, rp.full_name as resolved_by_name,
       inc.resolution_note,
       concat_ws(' ', i.name, inc.free_text, inc.comment, inc.resolution_note, p.full_name) as search_text
from incidents inc
left join items i on i.id = inc.item_id
left join profiles p on p.id = inc.created_by
left join profiles rp on rp.id = inc.resolved_by
where is_active_user();

-- 2.2 Read policies for active users -----------------------------------

drop policy if exists buildings_read_active on buildings;
create policy buildings_read_active on buildings for select
  to authenticated using (is_active_user());

drop policy if exists apartments_read_active on apartments;
create policy apartments_read_active on apartments for select
  to authenticated using (is_active_user());

drop policy if exists staff_read_active on staff;
create policy staff_read_active on staff for select
  to authenticated using (is_active_user());

drop policy if exists items_read_active on items;
create policy items_read_active on items for select
  to authenticated using (is_active_user());

drop policy if exists categories_read_active on categories;
create policy categories_read_active on categories for select
  to authenticated using (is_active_user());

drop policy if exists norm_rules_read_active on norm_rules;
create policy norm_rules_read_active on norm_rules for select
  to authenticated using (is_active_user());

drop policy if exists locations_read_active on locations;
create policy locations_read_active on locations for select
  to authenticated using (is_active_user());

drop policy if exists cleaning_events_read_active on cleaning_events;
create policy cleaning_events_read_active on cleaning_events for select
  to authenticated using (is_active_user());

drop policy if exists cleaning_event_staff_read_active on cleaning_event_staff;
create policy cleaning_event_staff_read_active on cleaning_event_staff for select
  to authenticated using (is_active_user());

drop policy if exists cleaning_event_lines_read_active on cleaning_event_lines;
create policy cleaning_event_lines_read_active on cleaning_event_lines for select
  to authenticated using (is_active_user());

-- 2.3 Function hardening -----------------------------------------------

alter function public.trg_forbid_mutation() set search_path = public, pg_temp;

revoke execute on function public.trg_guard_base_unit() from anon;
