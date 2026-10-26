import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { queueDailyReminders, deliverMeetingEmails } from "@/modules/meetings/delivery";
import { syncCalendarEvents } from "@/modules/meetings/google-calendar";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  const provided = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || expected.length !== provided.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const queued = await queueDailyReminders();
    const email = await deliverMeetingEmails();
    const calendar = await syncCalendarEvents();
    return NextResponse.json({ ok: true, queued, email, calendar });
  } catch { return NextResponse.json({ error: "Falha ao processar os lembretes." }, { status: 500 }); }
}
