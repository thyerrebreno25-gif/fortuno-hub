import { NextResponse, type NextRequest } from "next/server";
import {
  createDailyMfaToken,
  DAILY_MFA_COOKIE_MAX_AGE_SECONDS,
  DAILY_MFA_COOKIE_NAME,
  verifyDailyMfaToken,
} from "@/lib/auth/daily-mfa";
import { sessionDay, signedInToday } from "@/modules/session/daily-policy";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const [{ data: userResult }, { data: assurance, error: assuranceError }] =
    await Promise.all([
      supabase.auth.getUser(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);

  if (!userResult.user) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (!signedInToday(userResult.user.last_sign_in_at)) return NextResponse.json({error:"Entre novamente com sua senha para iniciar o acesso de hoje.",code:"DAILY_LOGIN_REQUIRED"},{status:401});
  if (assuranceError || assurance?.currentLevel !== "aal2") {
    return NextResponse.json(
      { error: "Confirme o código do autenticador antes de liberar este dispositivo." },
      { status: 403 },
    );
  }

  try {
    const token = await createDailyMfaToken(userResult.user.id);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(DAILY_MFA_COOKIE_NAME, token, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: DAILY_MFA_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("Erro ao registrar verificação diária do MFA:", error);
    return NextResponse.json(
      { error: "Não foi possível registrar a verificação diária." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {data:{user}} = await supabase.auth.getUser();
  if(!user) return NextResponse.json({error:"Sessão inválida."},{status:401});
  const valid = await verifyDailyMfaToken(request.cookies.get(DAILY_MFA_COOKIE_NAME)?.value,user.id);
  if(!valid) return NextResponse.json({error:"Entre novamente para iniciar o acesso de hoje.",code:"DAILY_LOGIN_REQUIRED"},{status:401});
  return NextResponse.json({ok:true,day:sessionDay()},{headers:{"Cache-Control":"private, no-store"}});
}
