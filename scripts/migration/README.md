# Lovable Cloud → Supabase migration

Moves the live Boswa database off Lovable Cloud (`flplvvybmzqapklcftbq`) into a
new, empty Supabase project owned by the `boswabw` organisation. Nothing is
deleted anywhere: the Lovable project and the August copy in
`gmdbrgjxdeztgzvqsaaj` stay as they are.

## Needs
- PostgreSQL 18 client tools in `C:/Users/user/tools/pgsql/bin` (the export is
  made by pg_dump 18.6, zstd-compressed).
- `C:/Users/user/.boswa-migration.env` filled in (outside the repo).
- A Lovable export: Cloud → Overview → Advanced settings → Export data
  (one per 24 hours). Unzip it outside the repo.

## Run
```
bash scripts/migration/run_restore.sh "<path>/cuddle-showcase_YYMMDD.backup"
```
1. Refuses to run unless the target has no app tables and no users.
2. Builds a restore list (`build_restore_list.py`): the public schema, its
   grants, `auth.users` + `auth.identities` (password hashes carry over), the
   new-user trigger and the storage policies.
3. Restores it in one transaction — any error rolls everything back.
4. Copies all stored files (`copy_storage.mjs`, upload only).
5. Prints row counts (`target_counts.sql`) to compare with the export.

Working files (they contain personal data) go to
`C:/Users/user/boswa-migration-work`, not the repo.

## Not covered here
Edge functions and their secrets, auth settings (site URL, redirects, SMTP),
the VPS attendance agent, and the app's Supabase URL/key.
