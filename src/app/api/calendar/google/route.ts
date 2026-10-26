import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { meetingAccess, meetingFailure, MeetingError } from "@/modules/meetings/auth";
import { calendarScope, googleConfigured, redirectUri, syncCalendarEvents } from "@/modules/meetings/google-calendar";
export async function POST(request: Request) {
  try {
    const { member } = await meetingAccess("CALENDAR", "canEdit");
    if (!googleConfigured()) throw new MeetingError("A integração Google Agenda será disponibilizada após configurar as credenciais OAuth.");
    const state = randomBytes(32).toString("hex"), verifier = randomBytes(32).toString("base64url");
    const jar = await cookies();
    jar.set("fortuno-calendar-oauth", encryptIntegrationSecret(JSON.stringify({ state, verifier, userId: member.userId, organizationId: member.organizationId, expires: Date.now() + 600000 })), { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", maxAge: 600, path: "/api/calendar/google" });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!, redirect_uri: redirectUri(request), response_type: "code", scope: calendarScope, access_type: "offline", prompt: "consent", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    return NextResponse.json({ url: url.href });
  } catch (error) { return meetingFailure(error); }
}
export async function DELETE() {
  try {
    const { member } = await meetingAccess("CALENDAR", "canEdit");
    await prisma.googleCalendarConnection.deleteMany({ where: { organizationId: member.organizationId, userId: member.userId } });
    return NextResponse.json({ ok: true });
  } catch (error) { return meetingFailure(error); }
}
export async function PATCH() {
  try {
    const { member } = await meetingAccess("CALENDAR", "canEdit");
    const result = await syncCalendarEvents({ organizationId: member.organizationId, userId: member.userId });
    return NextResponse.json(result);
  } catch (error) { return meetingFailure(error); }
}

export const maxDuration = 180;
