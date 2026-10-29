import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeUazapiEvent, normalizeUazapiHistory, object, text, tokenMatches } from "@/modules/whatsapp/uazapi";
import { enqueueUazapiEvent, enqueueUazapiHistory, drainUazapiInbox } from "@/modules/whatsapp/uazapi-events";
export const maxDuration = 120;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (Number(request.headers.get("content-length")) > 4000000) return new NextResponse(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > 4000000) return new NextResponse(null, { status: 413 });
  let payload;
  try { payload = object(JSON.parse(raw)); } catch { return new NextResponse(null, { status: 400 }); }
  const { id } = await context.params;
  const connection = await prisma.whatsAppConnection.findUnique({ where: { id } });
  if (!connection || !tokenMatches(text(payload.token, 1000), connection.tokenHash)) return new NextResponse(null, { status: 401 });
  const event = normalizeUazapiEvent(payload);
  if (event) await enqueueUazapiEvent(connection, event);
  const history = normalizeUazapiHistory(payload);
  if (history.length) await enqueueUazapiHistory(connection, history);
  await prisma.whatsAppConnection.update({ where: { id }, data: { lastWebhookAt: new Date() } });
  after(async () => { await drainUazapiInbox(id); });
  return NextResponse.json({ ok: true });
}
