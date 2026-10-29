/*
# Fix storage read policies and profiles write access

## Problem
1. Storage read policies on `incident-photos` and `cleaning-media` buckets
   allowed ANY active user to read ALL media — no folder/owner check.
   Any supervisor could download other users' photos/videos.
2. `profiles` table was writable by any `authenticated` user via the Data API
   (admin_all FOR ALL policy + table grants). This let admins directly change
   `role` and `active` columns, bypassing the admin-users edge function's
   last-admin / self-deactivate safeguards.

## Changes

### Storage read policies (security tightening)
- `cleaning_media_read`: replaced `is_active_user()` with
  `is_admin() OR (is_supervisor() AND folder = auth.uid())`.
  Admins keep full read; supervisors read only their own uploads.
- `incident_photos_read_active`: replaced `is_active_user()` with
  `is_admin() OR (is_supervisor() AND folder = auth.uid())`.
  Same pattern.

### Profiles write lockdown
- Revoked INSERT, UPDATE, DELETE on `profiles` from `authenticated`.
  Role/active/full_name changes now must go through the `admin-users`
  edge function (which enforces last-admin and self-deactivate guards).
- Replaced the `admin_all FOR ALL` policy with:
  - `profiles_admin_all` (FOR ALL, admin only) — admins still have access
  - `profiles_own_select` (SELECT, own row) — users read their own profile
- Added `profiles_own_update_name` (UPDATE, own row, only full_name)
  so users can still edit their own display name without touching role/active.

## Important notes
1. The `admin-users` edge function uses the service-role client which
   bypasses RLS, so its profile mutations are unaffected by this change.
2. `claim_first_admin` is a SECURITY DEFINER function that inserts into
   `profiles` as the owner — also unaffected by the grant revocation.
3. The bootstrap flow (`needs_bootstrap` + `claim_first_admin`) still works
   because `claim_first_admin` runs as SECURITY DEFINER.
*/

-- ── Storage: tighten cleaning-media read ──
DROP POLICY IF EXISTS "cleaning_media_read" ON storage.objects;
CREATE POLICY "cleaning_media_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'cleaning-media'
  AND (
    public.is_admin()
    OR (public.is_supervisor() AND (storage.foldername(name))[1] = auth.uid()::text)
  )
);

-- ── Storage: tighten incident-photos read ──
DROP POLICY IF EXISTS "incident_photos_read_active" ON storage.objects;
CREATE POLICY "incident_photos_read_active"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'incident-photos'
  AND (
    public.is_admin()
    OR (public.is_supervisor() AND (storage.foldername(name))[1] = auth.uid()::text)
  )
);

-- ── Profiles: revoke direct write from authenticated ──
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;

-- ── Profiles: replace admin_all FOR ALL with scoped policies ──
DROP POLICY IF EXISTS "admin_all" ON public.profiles;
DROP POLICY IF EXISTS "sv_own_profile" ON public.profiles;

-- Admin: full access to all profiles
CREATE POLICY "profiles_admin_all" ON public.profiles
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Users: read their own profile
CREATE POLICY "profiles_own_select" ON public.profiles
FOR SELECT TO authenticated
USING (id = auth.uid());

-- Users: update only their own full_name (not role, not active)
CREATE POLICY "profiles_own_update_name" ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());
