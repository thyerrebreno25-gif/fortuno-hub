import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), history: vi.fn(), transaction: vi.fn(), classify: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { serviceTicket: { findMany: m.find }, $transaction: m.transaction } }));
vi.mock("./classifier", () => ({ classifyAndRouteEmail: m.classify }));
import { rerouteGmailTickets } from "./reprocess";
beforeEach(() => { vi.resetAllMocks(); m.find.mockResolvedValue([]); m.transaction.mockImplementation(async (run) => run({ serviceTicket: { updateMany: m.update }, serviceTicketHistory: { create: m.history } })); });
it("only reprocesses open automatic Gmail tickets, excluding archived, human-edited and replied conversations", async () => {
  await rerouteGmailTickets("org");
  const where = m.find.mock.calls[0][0].where;
  expect(where).toMatchObject({ organizationId: "org", source: "GMAIL", status: { in: ["NEW", "IN_PROGRESS", "SPAM"] }, AND: [{ history: { none: { type: "MAILBOX_ARCHIVED" } } }], history: { none: { userId: { not: null } } }, messages: { none: { direction: "OUTBOUND" } } });
});
it("rechecks manual edits and organization scope atomically before applying the responsible", async () => {
  m.find.mockResolvedValueOnce([{ id: "ticket", status: "NEW", updatedAt: new Date(), assignedToId: null, assignedAt: null, subject: "Boleto", messages: [{ fromEmail: "sender@test.com", subject: "Boleto", textBody: "Abismo", htmlBody: null, toEmails: [], ccEmails: [], attachments: [] }] }]);
  m.classify.mockResolvedValueOnce({ clientId: "client", assignedToId: "ap", area: "ACCOUNTS_PAYABLE", squad: null, confidence: 90, reason: "Boleto do cliente", isSpam: false, spamScore: 0 });
  m.update.mockResolvedValueOnce({ count: 1 });
  expect(await rerouteGmailTickets("org")).toEqual({ checked: 1, changed: 1 });
  expect(m.update.mock.calls[0][0]).toMatchObject({ where: { organizationId: "org", history: { none: { userId: { not: null } } } }, data: { assignedToId: "ap", status: "IN_PROGRESS" } }); expect(m.history).toHaveBeenCalledOnce();
});
