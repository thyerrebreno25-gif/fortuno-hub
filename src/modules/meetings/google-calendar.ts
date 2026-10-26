import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import type { GoogleCalendarConnection, TeamCalendarEvent } from "@/generated/prisma/client";

export const calendarScope = "https://www.googleapis.com/auth/calendar.events";
export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET && (process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || process.env.GMAIL_TOKEN_ENCRYPTION_KEY));
}
export function redirectUri(request: Request) {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() || `${new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin}/api/calendar/google/callback`;
}
export function googleEventId(id: string) { return `fh${createHash("sha256").update(id).digest("hex")}`; }
export function googleEventBody(event: Pick<TeamCalendarEvent, "id" | "title" | "description" | "startsAt" | "endsAt" | "location" | "status" | "meetingId">) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  return { status: "confirmed", summary: event.title, description: `${event.description}${appUrl ? `\n\nFortuno Hub: ${new URL(event.meetingId ? `/reunioes?meeting=${encodeURIComponent(event.meetingId)}` : "/agenda", appUrl).href}` : ""}`, location: event.location,
    start: { dateTime: event.startsAt.toISOString(), timeZone: "America/Sao_Paulo" }, end: { dateTime: event.endsAt.toISOString(), timeZone: "America/Sao_Paulo" },
    reminders: { useDefault: false, overrides: event.status === "COMPLETED" ? [] : [{ method: "popup", minutes: 15 }] }, extendedProperties: { private: { fortunoEventId: event.id } } };
}
async function accessToken(connection: GoogleCalendarConnection) {
  if (connection.expiresAt.getTime() > Date.now() + 60_000) return decryptIntegrationSecret(connection.encryptedAccessToken);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!, client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!, refresh_token: decryptIntegrationSecret(connection.encryptedRefreshToken), grant_type: "refresh_token" }), signal: AbortSignal.timeout(15000) });
  const token = await response.json();
  if (!response.ok || !token.access_token) {
    if (response.status === 400 || response.status === 401) await prisma.googleCalendarConnection.update({ where: { id: connection.id }, data: { status: "RECONNECT", lastError: "Autorize o Google Agenda novamente." } });
    throw new Error("Não foi possível renovar a autorização do Google Agenda.");
  }
  await prisma.googleCalendarConnection.update({ where: { id: connection.id }, data: { encryptedAccessToken: encryptIntegrationSecret(token.access_token), expiresAt: new Date(Date.now() + (token.expires_in || 3600) * 1000) } });
  return token.access_token as string;
}
async function cancelFromGoogle(event: Pick<TeamCalendarEvent, "id" | "organizationId" | "userId" | "revision" | "googleEventId">) {
  // A personal calendar deletion must not complete a task or cancel the meeting for everyone.
  await prisma.teamCalendarEvent.updateMany({
    where: { id: event.id, organizationId: event.organizationId, userId: event.userId, revision: event.revision, googleEventId: event.googleEventId },
    data: { status: "CANCELLED", googleSyncStatus: "SYNCED", syncError: null, revision: { increment: 1 } },
  });
}

async function readGoogleEvent(base: string, id: string, token: string) {
  const response = await fetch(`${base}/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (response.status === 410) return { cancelled: true };
  if (!response.ok) throw new Error("Não foi possível conferir as alterações do evento no Google.");
  const remote = await response.json();
  return { cancelled: remote.status === "cancelled" };
}

export async function reconcileGoogleDeletions(organizationId: string, userId: string, start: Date, end: Date) {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  if (connection?.status !== "CONNECTED") return;
  const events = await prisma.teamCalendarEvent.findMany({ where: { organizationId, userId, status: { not: "CANCELLED" }, googleSyncStatus: "SYNCED", googleEventId: { not: null }, startsAt: { lt: end }, endsAt: { gt: start } }, orderBy: { updatedAt: "asc" }, take: 1000 });
  if (!events.length) return;
  const token = await accessToken(connection);
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events`;
  const deadline = Date.now() + 45000;
  for (let index = 0; index < events.length; index += 6) {
    if (Date.now() > deadline) throw new Error("A conferência das exclusões está demorando. Atualize a agenda novamente.");
    await Promise.all(events.slice(index, index + 6).map(async (event) => {
      const remote = await readGoogleEvent(base, event.googleEventId!, token);
      if (remote.cancelled) await cancelFromGoogle(event);
    }));
  }
}
export async function syncCalendarEvents(filter: { organizationId?: string; userId?: string } = {}) {
  if (!googleConfigured()) return { synced: 0, pending: true };
  const events = await prisma.teamCalendarEvent.findMany({ where: { ...filter, googleSyncStatus: { in: ["PENDING", "ERROR"] } }, orderBy: { updatedAt: "asc" }, take: 40 });
  let synced = 0;
  const deadline = Date.now() + 45000;
  const connections = new Map<string, { connection: GoogleCalendarConnection; token: string } | null>();
  for (const event of events) {
    if (Date.now() > deadline) break;
    const key = `${event.organizationId}:${event.userId}`;
    try {
      if (!connections.has(key)) {
        const connection = await prisma.googleCalendarConnection.findUnique({ where: { organizationId_userId: { organizationId: event.organizationId, userId: event.userId } } });
        connections.set(key, connection?.status === "CONNECTED" ? { connection, token: await accessToken(connection) } : null);
      }
      const auth = connections.get(key);
      if (!auth) continue;
      const id = event.googleEventId || googleEventId(event.id);
      const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(auth.connection.calendarId)}/events`;
      const headers = { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" };
      let response;
      if (event.status === "CANCELLED") {
        response = await fetch(`${base}/${id}?sendUpdates=none`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
        if (![200, 204, 404, 410].includes(response.status)) throw new Error("O Google não confirmou o cancelamento.");
      } else {
        if (event.googleEventId) {
          const remote = await readGoogleEvent(base, event.googleEventId, auth.token);
          if (remote.cancelled) { await cancelFromGoogle(event); continue; }
        }
        const body = googleEventBody(event);
        response = await fetch(`${base}/${id}?sendUpdates=none`, { method: "PUT", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        if (!event.googleEventId && (response.status === 404 || response.status === 410)) {
          response = await fetch(`${base}?sendUpdates=none`, { method: "POST", headers, body: JSON.stringify({ ...body, id }), signal: AbortSignal.timeout(15000) });
          if (response.status === 409) response = await fetch(`${base}/${id}?sendUpdates=none`, { method: "PUT", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        }
        if (event.googleEventId && response.status === 410) { await cancelFromGoogle(event); continue; }
        if (response.status === 401) await prisma.googleCalendarConnection.update({ where: { id: auth.connection.id }, data: { status: "RECONNECT", lastError: "Autorize o Google Agenda novamente." } });
        if (!response.ok) throw new Error("O Google não confirmou a sincronização.");
      }
      const updated = await prisma.teamCalendarEvent.updateMany({ where: { id: event.id, revision: event.revision }, data: { googleEventId: id, googleSyncStatus: "SYNCED", syncError: null } });
      // If an edit won the race while the HTTP call was running, replay its newer
      // state instead of leaving Google with a stale version marked as synced.
      if (!updated.count) await prisma.teamCalendarEvent.updateMany({ where: { id: event.id, revision: { gt: event.revision } }, data: { googleSyncStatus: "PENDING" } });
      synced++;
    } catch (error) {
      await prisma.teamCalendarEvent.updateMany({ where: { id: event.id, revision: event.revision }, data: { googleSyncStatus: "ERROR", syncError: error instanceof Error ? error.message : "Falha na sincronização." } });
    }
  }
  return { synced };
}
export async function listGoogleEvents(organizationId: string, userId: string, start: Date, end: Date) {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  if (!connection || connection.status !== "CONNECTED") return [];
  const token = await accessToken(connection);
  const items: Array<{ id: string; title: string; startsAt: string; endsAt: string; allDay: boolean; htmlLink?: string }> = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", ...(pageToken ? { pageToken } : {}) });
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Não foi possível consultar os eventos externos do Google.");
    const data = await response.json();
    for (const event of data.items || []) {
      if (event.status === "cancelled" || event.extendedProperties?.private?.fortunoEventId) continue;
      items.push({ id: event.id, title: event.summary || "Sem título", startsAt: event.start?.dateTime || `${event.start?.date}T00:00:00-03:00`, endsAt: event.end?.dateTime || `${event.end?.date}T00:00:00-03:00`, allDay: Boolean(event.start?.date), htmlLink: event.htmlLink });
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) return items;
  }
  throw new Error("Há muitos eventos externos neste intervalo. Selecione um período menor.");
}
