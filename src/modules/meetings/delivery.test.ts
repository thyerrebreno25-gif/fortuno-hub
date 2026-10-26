import { afterEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ meetingDelivery: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("./google-calendar", () => ({ syncCalendarEvents: vi.fn() }));
import { deliverMeetingEmails } from "./delivery";
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("does not send queued reminders after the delivery is completed, cancelled or reassigned", async () => {
  vi.stubEnv("RESEND_API_KEY", "test"); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  db.meetingDelivery.findMany.mockResolvedValue([
    { id: "done", userId: "a", actionItem: { completedAt: new Date(), responsibleId: "a" }, meeting: { status: "COMPLETED" } },
    { id: "reassigned", userId: "a", actionItem: { completedAt: null, responsibleId: "b" }, meeting: { status: "SCHEDULED" } },
    { id: "cancelled", userId: "a", actionItem: { completedAt: null, responsibleId: "a" }, meeting: { status: "CANCELLED" } },
  ]);
  expect(await deliverMeetingEmails()).toEqual({ sent: 0, configured: true });
  expect(fetchMock).not.toHaveBeenCalled(); expect(db.meetingDelivery.update).toHaveBeenCalledTimes(3);
});
it("only sends an email after claiming its queue row and uses a stable idempotency key", async () => {
  vi.stubEnv("RESEND_API_KEY", "test"); const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetchMock);
  db.meetingDelivery.findMany.mockResolvedValue([{ id: "invite", dedupeKey: "meeting:m:1:a", title: "Convite", body: "Semanal", meetingId: "m", user: { email: "a@example.com" }, actionItem: null, meeting: { status: "SCHEDULED" } }]);
  db.meetingDelivery.updateMany.mockResolvedValue({ count: 0 });
  await deliverMeetingEmails(); expect(fetchMock).not.toHaveBeenCalled();
  db.meetingDelivery.updateMany.mockResolvedValue({ count: 1 });
  await deliverMeetingEmails();
  expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ headers: expect.objectContaining({ "Idempotency-Key": "meeting:m:1:a" }) }));
});
