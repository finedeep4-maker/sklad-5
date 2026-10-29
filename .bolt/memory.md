# Project memory

## Product intent & audience

- Internal/admin-facing catalog and apartment management system (likely property/asset management)
- Multilingual: English + Arabic (data has `name_en`, `name_ar` columns)
- Manages items, categories, apartments, tenants, and normalization rules

## Brand personality & voice

- Not yet inferred from design work (no UI built this turn)

## Visual design & UX direction

- No design context yet from this turn; see `.bolt/prompt` for global UI instructions

## Decisions, constraints & rationale

- Backend: Supabase (SQL via `execute_sql`); project has `supabase/` directory that must never be touched
- Strict read-only investigation requests: no file/code/migration changes; never print `.env` or keys
- DB schema confirmed: `apartments.is_owner` column exists; `tenant_coefs` table exists; `items`/`categories` have `name_en`/`name_ar`; `norm_rules` table present
- Data snapshot: 191 items total, 180 assets, 0 untranslated assets, 211 norm rules
- Apartments: 22 active total (studio 9, 1br 10, 2br 3)
- Project is not a git repo (no remote)
- Key source files exist: `src/modules/admin/catalogFilter.ts`, `src/modules/core/useCatalogName.ts`
- Framework: Vite + React (JSX, Tailwind, lucide-react, `@/` path alias to `src/`)

## Open questions & assumptions

- Category `kind` values include at least `'asset'` (others not yet enumerated)
- Business logic for owner scenario, stock calculation for company warehouse, and task-document acceptance criteria remain unverified
- No UI design decisions established yet