const PROJECT_REF = "npytozgtmrskpqessnyj";

function securityError(code) {
  return Object.assign(new Error(code), { code });
}

// Never log a connection string: it contains database credentials.
export function assertFortunoDatabase(connectionString) {
  let url;
  try { url = new URL(connectionString); }
  catch { throw securityError("SECURITY_DATABASE_URL_INVALID"); }
  const directHost = url.hostname === `db.${PROJECT_REF}.supabase.co`;
  const poolerHost = url.hostname.endsWith(".pooler.supabase.com") &&
    decodeURIComponent(url.username).endsWith(`.${PROJECT_REF}`);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || (!directHost && !poolerHost)) {
    throw securityError("SECURITY_PROJECT_MISMATCH");
  }
}

export async function securePublicTables({ runtimeClient, adminClient, sql }) {
  const { rows: [runtime] } = await runtimeClient.query(
    "SELECT current_user AS role, current_database() AS database",
  );
  if (!runtime?.role || !runtime.database) throw securityError("SECURITY_RUNTIME_UNCONFIRMED");
  await adminClient.query("BEGIN");
  try {
    await adminClient.query("SET LOCAL lock_timeout = '20s'");
    await adminClient.query("SELECT pg_advisory_xact_lock(hashtext('fortuno-schema-setup-global-v1'))");
    const { rows: [target] } = await adminClient.query("SELECT current_database() AS database");
    if (target?.database !== runtime.database) throw securityError("SECURITY_DATABASE_MISMATCH");
    await adminClient.query("SELECT set_config('fortuno.security_runtime_role', $1, true)", [runtime.role]);
    await adminClient.query(sql);
    const { rows: [check] } = await adminClient.query(`
      SELECT count(*)::int AS protected_tables,
        count(*) FILTER (WHERE NOT c.relrowsecurity OR
          has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
          has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
          has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') OR
          has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))::int AS unsafe_tables
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    `);
    if (!check?.protected_tables || check.unsafe_tables !== 0) throw securityError("SECURITY_VERIFICATION_FAILED");
    await adminClient.query("COMMIT");
    return check.protected_tables;
  } catch (error) {
    await adminClient.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
