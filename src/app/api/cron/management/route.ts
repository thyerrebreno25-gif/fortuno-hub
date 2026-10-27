import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { runScheduledManagementSync } from "@/modules/management/sync";
import { pollGmailConnections } from "@/modules/atendimento/gmail/sync";
import { runNotionClientSync } from "@/modules/notion/client-sync";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  const integrationKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  const secret = process.env.CRON_SECRET || (integrationKey ? createHmac("sha256", integrationKey).update("fortuno-management-sync-v1").digest("hex") : "");
  const expected = Buffer.from(`Bearer ${secret || ""}`), provided = Buffer.from(request.headers.get("authorization") || "");
  if (!secret || expected.length !== provided.length || !timingSafeEqual(expected, provided)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  after(async () => { await runNotionClientSync().catch(() => undefined); await Promise.allSettled([runScheduledManagementSync(), pollGmailConnections()]); });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
