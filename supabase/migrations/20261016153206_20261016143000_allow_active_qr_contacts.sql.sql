/*
# Allow active QR users to read WhatsApp contacts

1. Change
- Updates the existing `sv_contacts` SELECT policy on `contacts`.
- Active authenticated users can read active contacts used by the QR WhatsApp tab.

2. Security
- Access remains limited to authenticated users whose profile is active.
- Only rows with `active = true` are visible.
- No insert, update, or delete access is added.
- The existing admin-only write policy remains unchanged.

3. Compatibility
- This fixes QR access for managers and supervisors without exposing inactive contacts.
*/

DROP POLICY IF EXISTS sv_contacts ON contacts;

CREATE POLICY sv_contacts
  ON contacts
  FOR SELECT
  TO authenticated
  USING (is_active_user() AND active);