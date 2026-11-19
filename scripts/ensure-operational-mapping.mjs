import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";

// Apply only this additive feature migration; do not replay historical migrations
// against installations originally provisioned outside Prisma migrate.
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  if (process.env.VERCEL) throw new Error("Configure DIRECT_URL or DATABASE_URL before deploying operational mapping.");
  console.log("Operational mapping: database setup skipped (local environment without database).");
} else {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000, statement_timeout: 30000 });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '20s'");
    // Shared tables are touched by multiple setup modules and Vercel projects.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fortuno-schema-setup-global-v1'))");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fortuno-operational-mapping-v1'))");
    const sql = await readFile(new URL("../prisma/migrations/20261019000000_operational_mapping/migration.sql", import.meta.url), "utf8");
    await client.query(sql.replace(/^\uFEFF/, ""));
    const pausedSql = await readFile(new URL("../prisma/migrations/20261119000000_operation_paused/migration.sql", import.meta.url), "utf8");
    await client.query(pausedSql);
    await client.query("COMMIT");
    // New enum values must commit before use. Lock without waiting, then read timers
    // in a fresh statement so a concurrent start can never be marked paused.
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fortuno-schema-setup-global-v1'))");
    const pausedCandidates = await client.query(`SELECT id FROM "OperationActivity" WHERE status='IN_PROGRESS' AND "deletedAt" IS NULL ORDER BY id FOR UPDATE SKIP LOCKED`);
    if(pausedCandidates.rows.length)await client.query(`UPDATE "OperationActivity" a SET status='PAUSED',"updatedAt"=CURRENT_TIMESTAMP WHERE a.id=ANY($1::text[]) AND a.status='IN_PROGRESS' AND NOT EXISTS(SELECT 1 FROM "OperationTimeEntry" e WHERE e."activityId"=a.id AND e."endedAt" IS NULL) AND EXISTS(SELECT 1 FROM "OperationEvent" e WHERE e."activityId"=a.id AND e.type='PAUSED')`,[pausedCandidates.rows.map(row=>row.id)]);
    await client.query("COMMIT");
    console.log("Operational mapping storage ready.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Operational mapping schema setup failed. Database error code:", error.code || "unknown");
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
