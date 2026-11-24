# Internal table access

Fortuno Hub accesses application tables on the server through Prisma/pg.
Supabase clients are used for Auth and Storage, not table REST/GraphQL calls.
Only the Supabase project `npytozgtmrskpqessnyj` is authorized for this setup.

The last database setup step in `npm run build` runs
`scripts/ensure-database-security.mjs`. Do not run the build locally against a
production database for verification; use unit checks locally and the authorized
deployment for application of the security setup.

The step connects using DATABASE_URL to confirm the actual runtime role, then
uses DIRECT_URL (or DATABASE_URL) for one transaction with the shared schema lock.
Before any changes, it verifies that the runtime retains owner access to every
non-extension application table in public and can bypass any forced RLS.
If the project, database or runtime access does not match, the setup fails.
Connection strings and database credentials are never printed.

For internal public tables, including _prisma_migrations, it enables RLS,
revokes table and explicit column permissions from anon, authenticated and PUBLIC,
and removes automatic public-schema table grants for existing table owners.
Existing RLS policies and explicit service_role permissions are preserved.
Auth/Storage schemas, extensions, functions and other Supabase projects are untouched.

Before COMMIT, the setup checks the effective table/column privileges of both API
roles and refuses to commit if any internal table still lacks RLS or is accessible
to those roles. It logs only table counts. An error rolls back the transaction and
stops the deployment. The successful deployment log should include:

```
Database security verified: <count> internal tables protected; 0 API-accessible tables.
```

After deployment, rerun the Supabase Security Advisor and confirm that
rls_disabled_in_public and sensitive_columns_exposed are gone. Smoke-test the Hub
with the existing signed-in session. This prevents public API access; it does not
establish whether any data was accessed before remediation.

For a future feature that needs direct Data API access, use a dedicated API schema
with explicit grants and organization-scoped RLS. Do not grant these internal
tables broadly or add permissive policies to silence the advisor.
