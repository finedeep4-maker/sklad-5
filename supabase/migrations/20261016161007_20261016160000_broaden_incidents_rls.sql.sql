/*
# Broaden incidents RLS for managers and all active users

## Context
The QR apartment page lets supervisors and managers report breakdowns.
The existing incident RLS policies only allowed `supervisor` role to
insert and read incidents. Managers were excluded by `is_supervisor()`,
so "Report breakdown" silently failed for them.

## Changes
1. Drop the old supervisor-only SELECT policy on incidents.
2. Create a new SELECT policy allowing any active authenticated user to
   read incidents they created (created_by = auth.uid()). Admins see
   everything via the existing admin_all policy.
3. Drop the old supervisor-only INSERT policy.
4. Create a new INSERT policy allowing any active authenticated user to
   insert incidents as themselves (created_by = auth.uid(), status = 'new').

## Security
- SELECT: active users see only their own incidents. Admins see all via admin_all.
- INSERT: creator must match auth.uid() and status must be 'new'.
- No UPDATE or DELETE policies added (incidents are mutated only via
  approve_incident SECURITY DEFINER function, which checks is_admin() internally).
*/

DROP POLICY IF EXISTS sv_incidents_read ON incidents;
DROP POLICY IF EXISTS sv_incidents_write ON incidents;

CREATE POLICY sv_incidents_read ON incidents FOR SELECT
  TO authenticated
  USING (is_active_user() AND created_by = auth.uid());

CREATE POLICY sv_incidents_write ON incidents FOR INSERT
  TO authenticated
  WITH CHECK (is_active_user() AND created_by = auth.uid() AND status = 'new');
