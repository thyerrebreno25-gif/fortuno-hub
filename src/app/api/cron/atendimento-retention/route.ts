import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { purgeExpiredServiceTickets } from "@/modules/atendimento/retention";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const result = await purgeExpiredServiceTickets();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Erro na retenção de e-mails do atendimento:", error);
    return NextResponse.json(
      { error: "Não foi possível executar a retenção de e-mails." },
      { status: 500 },
    );
  }
}
