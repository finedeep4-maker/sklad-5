# Project memory

## Product intent & audience

- Internal/admin-facing catalog and apartment management system (property/asset management)
- Multilingual: English + Arabic (data has `name_en`, `name_ar` columns)
- Manages items, categories, apartments, tenants, and normalization rules
- Includes inventory movement tracking, stock valuation, owner-vs-company reporting

## Brand personality & voice

- Not yet inferred from design work (no UI built)

## Visual design & UX direction

- No design context yet; see `.bolt/prompt` for global UI instructions

## Decisions, constraints & rationale

- Backend: Supabase (SQL via `execute_sql`); `supabase/` directory must never be touched
- Strict read-only investigation requests: no file/code/migration changes; never print `.env` or keys
- Framework: Vite + React (JSX, Tailwind, lucide-react, `@/` path alias to `src/`)
- Project is not a git repo (no remote)
- DB schema confirmed: `apartments.is_owner`, `tenant_coefs`, `items`/`categories` (`name_en`/`name_ar`), `norm_rules`, `stock_balance`, `item_prices`
- Key source files: `src/modules/admin/catalogFilter.ts`, `src/modules/core/useCatalogName.ts`
- Data snapshot: 191 items total, 180 assets, 0 untranslated assets, 211 norm rules, 22 active apartments (studio 9, 1br 10, 2br 3)

### Deployed DB functions (public schema)
- `_insert_move` — core movement insert; warehouse allowed as from/to for owner assets only when `p_src in ('owner_transfer', 'doc_void')`; other source types restricted. **`authenticated` role EXECUTE privilege revoked** — function is internal-only, not callable from frontend
- `void_document` — admin-only; checks balance before reversing; uses `source_type='doc_void'`; marks document `void`
- `transfer_company_owner` — admin-only; validates owner apartment; creates `issue` document; uses `avg_cost` (to_owner) / `owner_avg_cost` (to_company); `source_type='owner_transfer'`
- `report_stock_turnover` — admin-only; supports `company`/`owner` scopes; separates receipt/out/transfer quantities and values
- `report_owner_vs_company` — admin-only; returns company stock value/revenue, owner apartments/items/stock value/revenue, transfer counts/values both directions
- `warehouse_valuation` — view; company & owner scopes; joins `stock_balance` with `item_prices`; calculates `stock_value`, `potential_revenue`, `margin`; protected by `is_admin()` + `security_invoker`

### Migration & test status
- 3 migrations applied today; all 26 SQL tests pass; typecheck 0 errors; 103/103 frontend tests; build OK

## Open questions & assumptions

- Category `kind` values include at least `'asset'` (others not enumerated)
- Business logic for owner scenario, stock calculation for company warehouse, and task-document acceptance criteria remain partially verified (function defs now confirmed)
- No UI design decisions established yet
- Frontend must call wrapper functions (e.g., `void_document`, `transfer_company_owner`) instead of `_insert_move` directly