import { NextResponse } from "next/server";
import { sendAutomaticPendingInviteReminders } from "@/modules/settings/server/automatic-invite-reminders";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  const isVercelCron = request.headers.get("user-agent") === "vercel-cron/1.0";

  if (
    (secret && authorization !== `Bearer ${secret}`) ||
    (!secret && !isVercelCron)
  ) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const result = await sendAutomaticPendingInviteReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Erro nos lembretes automáticos de convite:", error);
    return NextResponse.json(
      { error: "Não foi possível processar os lembretes de convite." },
      { status: 500 },
    );
  }
}
