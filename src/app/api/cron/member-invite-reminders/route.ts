import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { sendAutomaticPendingInviteReminders } from "@/modules/settings/server/automatic-invite-reminders";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
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
