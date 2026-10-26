import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";

// Apply only this additive feature migration; do not replay historical migrations
// against installations originally provisioned outside Prisma migrate.
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  if (process.env.VERCEL) throw new Error("Configure DIRECT_URL or DATABASE_URL before deploying meetings and calendar.");
  console.log("Meetings and calendar: database setup skipped (local environment without database).");
} else {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000, statement_timeout: 30000 });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '20s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fortuno-meetings-calendar-v1'))");
    const sql = await readFile(new URL("../prisma/migrations/20261026000000_meetings_calendar/migration.sql", import.meta.url), "utf8");
    await client.query(sql.replace(/^\uFEFF/, ""));
    await client.query("COMMIT");
    console.log("Meetings and calendar storage ready.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Meetings and calendar schema setup failed. Database error code:", error.code || "unknown");
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
