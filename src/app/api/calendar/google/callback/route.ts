import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { meetingAccess } from "@/modules/meetings/auth";
import { calendarScope, redirectUri, syncCalendarEvents } from "@/modules/meetings/google-calendar";
export async function GET(request: Request) {
  const target = new URL("/agenda", request.url);
  const jar = await cookies();
  const cookie = jar.get("fortuno-calendar-oauth")?.value;
  jar.delete({ name: "fortuno-calendar-oauth", path: "/api/calendar/google" });
  try {
    const { member } = await meetingAccess("CALENDAR", "canEdit");
    const url = new URL(request.url), code = url.searchParams.get("code"), receivedState = url.searchParams.get("state") || "";
    if (!cookie || !code || url.searchParams.has("error")) throw new Error("Autorização cancelada ou expirada.");
    const state = JSON.parse(decryptIntegrationSecret(cookie));
    if (state.userId !== member.userId || state.organizationId !== member.organizationId || state.expires < Date.now() || typeof state.state !== "string" || receivedState.length !== state.state.length || !timingSafeEqual(Buffer.from(receivedState), Buffer.from(state.state))) throw new Error("Autorização inválida. Inicie a conexão novamente.");
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!, client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!, code, code_verifier: state.verifier, redirect_uri: redirectUri(request), grant_type: "authorization_code" }), signal: AbortSignal.timeout(15000) });
    const token = await response.json();
    if (!response.ok || !token.access_token || !token.refresh_token || !String(token.scope || "").split(" ").includes(calendarScope)) throw new Error("O Google não liberou o acesso necessário. Autorize a agenda e tente novamente.");
    const data = { encryptedAccessToken: encryptIntegrationSecret(token.access_token), encryptedRefreshToken: encryptIntegrationSecret(token.refresh_token), expiresAt: new Date(Date.now() + (token.expires_in || 3600) * 1000), status: "CONNECTED", lastError: null };
    await prisma.googleCalendarConnection.upsert({ where: { organizationId_userId: { organizationId: member.organizationId, userId: member.userId } }, create: { ...data, organizationId: member.organizationId, userId: member.userId }, update: data });
    // Reconcile all saved internal events, including events created before connecting.
    await prisma.teamCalendarEvent.updateMany({ where: { organizationId: member.organizationId, userId: member.userId }, data: { googleSyncStatus: "PENDING" } });
    after(async () => { await syncCalendarEvents({ organizationId: member.organizationId, userId: member.userId }); });
    target.searchParams.set("google", "connected");
  } catch (error) {
    target.searchParams.set("google_error", error instanceof Error ? error.message : "Não foi possível conectar ao Google.");
  }
  return NextResponse.redirect(target);
}

export const maxDuration = 180;
