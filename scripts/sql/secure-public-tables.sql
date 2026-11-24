-- Internal Hub tables are served through Prisma, never through the Data API.
-- The caller supplies the actual production runtime role after connecting with
-- DATABASE_URL. Abort the whole transaction before DDL if ownership cannot be
-- confirmed. Auth, Storage and extension-owned objects are outside this scope.
DO $security$
DECLARE
  runtime_role name := current_setting('fortuno.security_runtime_role', true);
  runtime_super boolean;
  runtime_bypass boolean;
  target record;
  column_grant record;
BEGIN
  IF runtime_role IS NULL OR runtime_role IN ('anon', 'authenticated', 'authenticator') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SECURITY_RUNTIME_UNCONFIRMED';
  END IF;
  SELECT rolsuper, rolbypassrls INTO runtime_super, runtime_bypass
    FROM pg_catalog.pg_roles WHERE rolname = runtime_role;
  IF runtime_super IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SECURITY_RUNTIME_UNCONFIRMED';
  END IF;

  -- Require independent owner rights, so revoking API grants cannot remove the
  -- runtime's access. RLS must also remain bypassable for the server role.
  FOR target IN
    SELECT c.oid, c.relowner, c.relforcerowsecurity
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  LOOP
    IF NOT runtime_super AND (NOT pg_has_role(runtime_role, target.relowner, 'USAGE')
      OR (target.relforcerowsecurity AND NOT runtime_bypass)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SECURITY_RUNTIME_OWNERSHIP_REQUIRED';
    END IF;
  END LOOP;

  FOR target IN
    SELECT c.oid, c.relname, c.relrowsecurity
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    ORDER BY c.relname
  LOOP
    IF NOT target.relrowsecurity THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.relname);
    END IF;
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated, PUBLIC', target.relname);
    -- Table revocations alone do not remove explicit column grants.
    FOR column_grant IN
      SELECT DISTINCT a.attname FROM pg_catalog.pg_attribute a
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
      WHERE a.attrelid = target.oid AND a.attnum > 0 AND NOT a.attisdropped
        AND (acl.grantee = 0 OR acl.grantee IN
          (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated')))
    LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES (%I) ON TABLE public.%I FROM anon, authenticated, PUBLIC',
        column_grant.attname, target.relname);
    END LOOP;
  END LOOP;

  -- Do not automatically grant API access to future tables created by the
  -- existing application table owners. Keep all changes in the public schema.
  FOR target IN
    SELECT DISTINCT r.rolname FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC', target.rolname);
  END LOOP;
END
$security$;
