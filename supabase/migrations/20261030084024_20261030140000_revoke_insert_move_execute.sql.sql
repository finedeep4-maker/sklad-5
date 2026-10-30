/*
# Revoke execute on _insert_move from all roles

## Rationale
`_insert_move` is an internal SECURITY DEFINER function called by higher-level
functions (post_document, post_move, void_document, transfer_company_owner, etc.).
It should never be called directly from the frontend. Revoking EXECUTE from
public, anon, and authenticated prevents direct RPC calls while still allowing
SECURITY DEFINER functions to call it internally (they run as the owner).

## Changes
- REVOKE ALL ON FUNCTION _insert_move(...) FROM public, anon, authenticated
- No GRANT replacement — the function is internal only
*/

revoke all on function public._insert_move(
  integer, integer, integer, numeric, numeric,
  text, text, integer, integer, uuid, text,
  timestamp with time zone, bigint
) from public, anon, authenticated;
