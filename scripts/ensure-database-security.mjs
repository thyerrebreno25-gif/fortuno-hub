import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertFortunoDatabase, securePublicTables } from "./database-security.mjs";

const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DIRECT_URL || runtimeUrl;
if (!runtimeUrl || !adminUrl) {
  if (process.env.VERCEL) throw new Error("SECURITY_DATABASE_REQUIRED");
  console.log("Database security: local setup skipped (no database configured).");
} else {
  let runtimeClient;
  let adminClient;
  try {
    assertFortunoDatabase(runtimeUrl);
    assertFortunoDatabase(adminUrl);
    const options = { connectionTimeoutMillis: 15000, statement_timeout: 60000 };
    runtimeClient = new pg.Client({ ...options, connectionString: runtimeUrl });
    adminClient = new pg.Client({ ...options, connectionString: adminUrl });
    await runtimeClient.connect();
    await adminClient.connect();
    const sql = await readFile(new URL("./sql/secure-public-tables.sql", import.meta.url), "utf8");
    const count = await securePublicTables({ runtimeClient, adminClient, sql });
    console.log(`Database security verified: ${count} internal tables protected; 0 API-accessible tables.`);
  } catch (error) {
    // Error messages from drivers can include credentials; print only a code.
    console.error("Database security setup failed:", error.code || "SECURITY_SETUP_FAILED");
    process.exitCode = 1;
  } finally {
    await adminClient?.end().catch(() => {});
    await runtimeClient?.end().catch(() => {});
  }
}
