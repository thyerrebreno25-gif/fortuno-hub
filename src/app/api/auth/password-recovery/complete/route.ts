import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { recoveryOrigin } from "@/modules/auth/password-recovery";
import { DAILY_MFA_COOKIE_NAME } from "@/lib/auth/daily-mfa";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
const invalidLink = "O link de recuperação é inválido ou expirou. Solicite um novo e-mail para continuar.";
const input = z.object({
  tokenHash: z.string().min(16).max(256),
  password: z.string().min(8).max(128),
}).strict();

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== recoveryOrigin()) {
      return NextResponse.json({ error: "Origem da solicitação não permitida." }, { status: 403, headers });
    }
    if (Number(request.headers.get("content-length") || 0) > 2048) {
      return NextResponse.json({ error: "Solicitação inválida." }, { status: 400, headers });
    }
    const raw = await request.text();
    if (raw.length > 2048) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400, headers });
    const { tokenHash, password } = input.parse(JSON.parse(raw));
    const admin = createAdminClient();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!admin || !url || !key) throw new Error("Recovery unavailable");

    // Isolate OTP verification from the privileged client: verifyOtp creates an
    // AAL1 session and must never replace the admin client's authorization.
    const verifier = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    // Only a fresh, provider-verified, single-use recovery token authorizes this
    // operation. Never accept a regular login session, email or caller user ID.
    const verified = await verifier.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    const user = verified.data.user;
    const accessToken = verified.data.session?.access_token;
    if (verified.error || !user || !accessToken) {
      return NextResponse.json({ error: invalidLink, invalidLink: true }, { status: 400, headers });
    }
    try {
      const member = await prisma.user.findFirst({
        where: { id: user.id, memberships: { some: {} } }, select: { id: true },
      });
      if (!member) return NextResponse.json({ error: invalidLink, invalidLink: true }, { status: 400, headers });

      // Email-only password recovery is intentional. Existing MFA factors and
      // normal login enforcement remain intact; no daily MFA grant is minted.
      const updated = await admin.auth.admin.updateUserById(user.id, { password });
      if (updated.error) {
        return NextResponse.json({
          error: "Não foi possível atualizar a senha. Use uma senha diferente, com 8 a 128 caracteres, e solicite um novo link.",
          invalidLink: true,
        }, { status: 400, headers });
      }
      const response = NextResponse.json({ ok: true }, { headers });
      response.cookies.set(DAILY_MFA_COOKIE_NAME, "", { path: "/", maxAge: 0, httpOnly: true, secure: true, sameSite: "lax" });
      return response;
    } finally {
      // Do not leave the recovery session usable, even when updating fails.
      // Password updates already revoke refresh tokens in Supabase.
      try {
        const cleanup = await admin.auth.admin.signOut(accessToken, "global");
        if (cleanup.error) console.warn("Recovery session cleanup failed");
      }
      catch { console.warn("Recovery session cleanup failed"); }
    }
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Confira o link e use uma senha de 8 a 128 caracteres." }, { status: 400, headers });
    }
    console.error("Password recovery completion failed", { name: error instanceof Error ? error.name : "Unknown" });
    return NextResponse.json({ error: "Não foi possível atualizar a senha agora. Solicite um novo link e tente novamente.", invalidLink: true }, { status: 503, headers });
  }
}
