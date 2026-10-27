import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  if (process.env.VERCEL) throw new Error("Configure the database before deploying Notion.");
  console.log("Notion: local database setup skipped.");
} else {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000, statement_timeout: 30000 });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '20s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fortuno-notion-v1'))");
    await client.query(await readFile(new URL("../prisma/migrations/20261026010000_notion/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261027030000_notion_client_sync/migration.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
    console.log("Notion storage ready.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Notion database setup failed:", error.code || "unknown");
    process.exitCode = 1;
  } finally { await client.end(); }
}
