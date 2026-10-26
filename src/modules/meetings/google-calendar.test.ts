import { afterEach, beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ teamCalendarEvent: { findMany: vi.fn(), updateMany: vi.fn() }, googleCalendarConnection: { findUnique: vi.fn(), update: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/purchase-invoices/server/crypto", () => ({ decryptIntegrationSecret: () => "token", encryptIntegrationSecret: (value: string) => value }));
import { googleEventBody, googleEventId, reconcileGoogleDeletions, syncCalendarEvents } from "./google-calendar";
const event = { id: "event", organizationId: "org", userId: "u", title: "Entrega", description: "", startsAt: new Date("2026-10-30T20:00:00Z"), endsAt: new Date("2026-10-30T20:30:00Z"), location: "", status: "ACTIVE", revision: 1, meetingId: "m", googleEventId: null };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "id"); vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "secret"); vi.stubEnv("INTEGRATION_TOKEN_ENCRYPTION_KEY", "key"); db.teamCalendarEvent.findMany.mockResolvedValue([event]); db.teamCalendarEvent.updateMany.mockResolvedValue({ count: 1 }); db.googleCalendarConnection.findUnique.mockResolvedValue({ id: "connection", status: "CONNECTED", expiresAt: new Date(Date.now() + 3600000), encryptedAccessToken: "encrypted", calendarId: "primary" }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("uses a deterministic Google-valid event ID and removes reminders after completion", () => {
  expect(googleEventId("event")).toMatch(/^[a-v0-9]{5,1024}$/);
  expect(googleEventId("event")).toBe(googleEventId("event"));
  expect(googleEventBody({ ...event, status: "COMPLETED" }).reminders.overrides).toEqual([]);
});
it("inserts with the same id when an event does not exist yet", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 404 })).mockResolvedValueOnce(new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetchMock);
  await syncCalendarEvents({ userId: "u" });
  expect(fetchMock.mock.calls[1][1].method).toBe("POST"); expect(JSON.parse(fetchMock.mock.calls[1][1].body).id).toBe(googleEventId(event.id));
});
it("keeps failed requests pending for retry instead of falsely marking success", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
  await syncCalendarEvents();
  expect(db.teamCalendarEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ googleSyncStatus: "ERROR" }) }));
});
it("requeues the latest revision when an edit raced the Google request", async () => {
  db.teamCalendarEvent.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 }); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  await syncCalendarEvents();
  expect(db.teamCalendarEvent.updateMany).toHaveBeenLastCalledWith({ where: { id: "event", revision: { gt: 1 } }, data: { googleSyncStatus: "PENDING" } });
});
it("removes a Google-deleted event from the same user's Hub calendar without touching the meeting", async () => {
  db.teamCalendarEvent.findMany.mockResolvedValue([{ ...event, googleEventId: "remote" }]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "cancelled" }))));
  await reconcileGoogleDeletions("org", "u", event.startsAt, event.endsAt);
  expect(db.teamCalendarEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org", userId: "u", googleSyncStatus: "SYNCED" }) }));
  expect(db.teamCalendarEvent.updateMany).toHaveBeenCalledWith({ where: { id: "event", organizationId: "org", userId: "u", revision: 1, googleEventId: "remote" }, data: { status: "CANCELLED", googleSyncStatus: "SYNCED", syncError: null, revision: { increment: 1 } } });
});
it("does not cancel anything when a Google read fails or access is denied", async () => {
  db.teamCalendarEvent.findMany.mockResolvedValue([{ ...event, googleEventId: "remote" }]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
  await expect(reconcileGoogleDeletions("org", "u", event.startsAt, event.endsAt)).rejects.toThrow("conferir");
  expect(db.teamCalendarEvent.updateMany).not.toHaveBeenCalled();
});
it("never recreates a previously synchronized event deleted in Google", async () => {
  db.teamCalendarEvent.findMany.mockResolvedValue([{ ...event, googleEventId: "remote" }]);
  const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 410 }));
  vi.stubGlobal("fetch", fetchMock);
  await syncCalendarEvents();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(db.teamCalendarEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }));
});
