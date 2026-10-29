/*
# Broaden apartment_notes RLS for QR module

## Context
The QR apartment page lets housekeepers and supervisors view and add notes
(comments with photos/videos) on apartments they scan. The existing policies
only allowed supervisors to read/insert notes. This blocks housekeepers from
using the QR page comment feature.

## Changes
1. Drop the old supervisor-only SELECT policy on apartment_notes.
2. Create a new SELECT policy allowing any active authenticated user to read
   notes with visibility = 'all' (admin-only notes stay hidden from non-admins
   via the admin_all policy which covers admins separately).
3. Drop the old supervisor-only INSERT policy.
4. Create a new INSERT policy allowing any active authenticated user to insert
   notes as themselves (author = auth.uid(), visibility = 'all').

## Security
- SELECT: active users see only 'all' visibility notes. Admins see everything
  via the existing admin_all policy.
- INSERT: author must match auth.uid() and visibility must be 'all'. This
  prevents impersonation and keeps admin-only notes admin-created.
- No UPDATE or DELETE policies added (notes are immutable once posted).
*/

DROP POLICY IF EXISTS sv_notes_read ON apartment_notes;
DROP POLICY IF EXISTS sv_notes_write ON apartment_notes;

CREATE POLICY sv_notes_read ON apartment_notes FOR SELECT
  TO authenticated
  USING (is_active_user() AND visibility = 'all');

CREATE POLICY sv_notes_write ON apartment_notes FOR INSERT
  TO authenticated
  WITH CHECK (is_active_user() AND author = auth.uid() AND visibility = 'all');
