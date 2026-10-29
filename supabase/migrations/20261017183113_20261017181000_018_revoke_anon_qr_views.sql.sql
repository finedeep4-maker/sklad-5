/*
# 018 — Revoke anon privileges on QR views

1. Problem
- sv_apartment_incidents and sv_cleaning_event_lines carried SELECT/INSERT/
  UPDATE/DELETE privileges for the anon role (granted when they were created).
  After 017 both views enforce RLS via security_invoker, but the table grants
  themselves still let unauthenticated callers reach the Data API relation at
  all. The app never reads these views as anon (the QR app requires sign-in).

2. Changes
- Revoke all privileges on both views from anon (and public, which anon
  inherits from). authenticated access is untouched.

3. Security
- Unauthenticated callers can no longer address either view through the API.
- Idempotent: re-running REVOKE is a no-op.
*/

revoke select, insert, update, delete on public.sv_apartment_incidents from anon, public;
revoke select, insert, update, delete on public.sv_cleaning_event_lines from anon, public;

revoke execute on function public.trg_guard_base_unit() from anon, public;
