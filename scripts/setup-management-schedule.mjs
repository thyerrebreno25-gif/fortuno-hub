import { createHash, createHmac } from "node:crypto";

export async function setupManagementSchedule(client) {
  if (process.env.VERCEL_ENV !== "production") return;
  // Each production project invokes its own stable hostname with its own secret.
  // Client and worker leases prevent duplicate calls when deployments share a DB.
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const integrationKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  const secret = process.env.CRON_SECRET || (integrationKey ? createHmac("sha256", integrationKey).update("fortuno-management-sync-v1").digest("hex") : "");
  if (!host || !secret) throw Object.assign(new Error("Scheduler configuration unavailable"), { code: "MISSING_SCHEDULER_CONFIG" });
  const origin = new URL(`https://${host}`).origin;
  if (!/^[a-zA-Z0-9.-]+$/.test(host) || !host.includes(".")) throw Object.assign(new Error("Invalid production origin"), { code: "INVALID_SCHEDULER_ORIGIN" });
  const suffix = createHash("sha256").update(origin).digest("hex").slice(0, 16);
  const id = `schedule-${suffix}`, jobName = `fortuno-management-${suffix}`;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fortuno-management-schedule-v1'))");
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog");
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions");
    await client.query("CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault");
    const saveSecret = async (name, value) => {
      const found = await client.query("SELECT id FROM vault.secrets WHERE name = $1", [name]);
      if (found.rows[0]) await client.query("SELECT vault.update_secret($1::uuid, $2::text)", [found.rows[0].id, value]);
      else await client.query("SELECT vault.create_secret($1::text, $2::text)", [value, name]);
    };
    await saveSecret(`${jobName}-url`, `${origin}/api/cron/management`);
    await saveSecret(`${jobName}-token`, secret);
    // The tick runs every minute; tenants are only queried after the 15-minute TTL.
    // Tokens stay in Vault, never in job command text, logs or the browser.
    const command = `SELECT net.http_post(url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${jobName}-url'), headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${jobName}-token')), body := '{}'::jsonb, timeout_milliseconds := 10000);`;
    await client.query("SELECT cron.schedule($1::text, '* * * * *', $2::text)", [jobName, command]);
    await client.query('INSERT INTO "ManagementSyncState" (id, origin, "configuredAt") VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET origin=EXCLUDED.origin, "configuredAt"=NOW(), "setupError"=NULL', [id, origin]);
    await client.query("COMMIT");
    console.log("Management: automatic cloud schedule configured (15-minute refresh).");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await client.query('INSERT INTO "ManagementSyncState" (id, origin, "setupError") VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET "setupError"=EXCLUDED."setupError"', [id, origin, `Configuração automática pendente (${String(error.code || "unknown").replace(/[^a-zA-Z0-9_]/g, "").slice(0,60)}).`]);
    throw error;
  }
}
