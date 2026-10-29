/*
# Reload PostgREST schema cache for cleaning history

1. Purpose
- Refreshes the API schema cache so the `sv_cleaning_events` view exposes its current columns.
- Resolves stale API metadata after the view was updated with `revision` and media/audit fields.

2. Data safety
- No tables, columns, rows, policies, or permissions are created, changed, or removed.
- No user data is modified or deleted.

3. Security
- Existing Row Level Security policies and grants remain unchanged.

4. Important notes
- This is an operational cache refresh only.
- The database view already contains the `revision` column; the refresh makes the API use that current definition.
*/

NOTIFY pgrst, 'reload schema';