# @setflow/db

Database schema and seed data for SetFlow (Supabase Postgres).

## Layout

```text
supabase/migrations/  Ordered SQL migrations (0001_..., 0002_...)
supabase/seed.sql     Built-in exercise library (global, owner_user_id null)
```

## Applying

Against a linked Supabase project (needs `supabase login` or an access token):

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push          # applies migrations/
psql "$DATABASE_URL" -f packages/db/supabase/seed.sql   # or run seed.sql in the SQL editor
```

Or paste each file into the Supabase dashboard SQL editor (migrations first,
then seed).

## Design notes

- Auth users live in Supabase's own `auth.users`; app tables reference them
  by uuid. `profiles` holds display name + preferences.
- **RLS is enabled from day one** — the anon key ships inside the apps, so
  every table has owner-only policies (built-in exercises are world-readable).
- SQL uses snake_case; `@setflow/api-client` maps to the camelCase types in
  `@setflow/shared`.
