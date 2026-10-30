import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { setupManagementSchedule } from "./setup-management-schedule.mjs";
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  if (process.env.VERCEL) throw new Error("Configure the database before deploying management.");
  console.log("Management: local database setup skipped.");
} else {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000, statement_timeout: 30000 });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '20s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fortuno-management-v1'))");
    await client.query(await readFile(new URL("../prisma/migrations/20261027000000_management/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261027010000_management_sync/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261028000000_document_import_reviews/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261028010000_investment_delivery/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261028020000_investment_financial/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261028030000_uazapi_connection/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261029000000_whatsapp_history/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261029010000_whatsapp_merge/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261029020000_contract_delivery/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261029030000_contract_buyer/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261030000000_client_ca_categories/migration.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../prisma/migrations/20261030010000_whatsapp_read_state/migration.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
    console.log("Management storage ready.");
    try { await setupManagementSchedule(client); }
    catch (error) { console.error("Management schedule setup failed:", error.code || "unknown"); }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Management database setup failed:", error.code || "unknown");
    process.exitCode = 1;
  } finally { await client.end(); }
}
