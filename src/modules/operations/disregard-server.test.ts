import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ tx: vi.fn(), lock: vi.fn(), find: vi.fn(), update: vi.fn(), author: vi.fn(), managers: vi.fn(), notice: vi.fn(), closeNotice: vi.fn(), recipients: vi.fn(), entries: vi.fn(), stop: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.tx } }));
vi.mock("./auth", () => ({ canManageOperations: (role: string) => ["MASTER", "ADMIN", "MANAGER"].includes(role) }));
import { decideDisregard, requestDisregard } from "./disregard-server";
const member = { userId: "operator", organizationId: "org", role: "OPERATOR", canEdit: true, user: { name: "Operadora", email: "o@test" } } as never;
const review = { requestId: "request", status: "PENDING", reason: "Atividade não se aplica ao cliente", requestedById: "operator", requestedAt: new Date().toISOString(), noticeId: "operation-disregard:request" };
beforeEach(() => {
  vi.resetAllMocks();
  m.tx.mockImplementation(async run => run({ $queryRaw: m.lock, operationActivity: { findFirst: m.find, update: m.update }, organizationMember: { findFirst: m.author, findMany: m.managers }, notice: { create: m.notice, updateMany: m.closeNotice }, noticeRecipient: { updateMany: m.recipients }, operationTimeEntry: { findMany: m.entries, updateMany: m.stop }, operationEvent: { create: m.event } }));
  m.find.mockResolvedValue({ id: "a", responsibleId: "operator", status: "IN_PROGRESS", title: "Pagamentos", client: { name: "Cliente" } });
  m.author.mockResolvedValue({ id: "member" }); m.managers.mockResolvedValue([{ id: "manager-member" }]); m.notice.mockResolvedValue({ id: "notice" }); m.entries.mockResolvedValue([{ id: "entry", startedAt: new Date(Date.now() - 60000) }]);
});
it("creates one approval notice for managers, stops the timer and waits without disregarding", async () => {
  await expect(requestDisregard(member, "a", review.reason)).resolves.toEqual({ pending: true });
  expect(m.find.mock.calls[0][0].where).toEqual({ id: "a", organizationId: "org", deletedAt: null });
  expect(m.notice.mock.calls[0][0].data).toMatchObject({ organizationId: "org", scope: "MEMBERS", recipients: { create: [{ memberId: "manager-member" }] } });
  expect(m.update.mock.calls[0][0].data).toMatchObject({ status: "PAUSED", disregardReview: { status: "PENDING", reason: review.reason } });
  expect(m.stop).toHaveBeenCalledOnce();
});
it("requires a justification and ownership before creating an approval", async () => {
  await expect(requestDisregard(member, "a", "")).rejects.toMatchObject({ status: 400 });
  m.find.mockResolvedValue({ responsibleId: "other", status: "OPEN" });
  await expect(requestDisregard(member, "a", review.reason)).rejects.toMatchObject({ status: 403 });
  expect(m.notice).not.toHaveBeenCalled();
});
it("does not create a second notice when the operator retries a pending request", async () => {
  m.find.mockResolvedValue({ responsibleId: "operator", status: "PAUSED", disregardReview: review });
  await requestDisregard(member, "a", review.reason);
  expect(m.notice).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
it.each([true, false])("manager decision (%s) finalizes the notice and sets the requested task state", async approve => {
  m.find.mockResolvedValue({ id: "a", status: "PAUSED", disregardReview: review });
  await expect(decideDisregard({ ...member as object, role: "MANAGER" } as never, "a", "request", approve)).resolves.toEqual({ status: approve ? "APPROVED" : "REJECTED" });
  expect(m.update.mock.calls[0][0].data).toMatchObject({ status: approve ? "DISREGARDED" : "OPEN", disregardReview: { status: approve ? "APPROVED" : "REJECTED" } });
  expect(m.closeNotice.mock.calls[0][0].where).toEqual({ id: review.noticeId, organizationId: "org" });
});
it("refuses operator decisions, foreign or replaced requests, and never reverses a prior decision", async () => {
  await expect(decideDisregard(member, "a", "request", true)).rejects.toMatchObject({ status: 403 });
  const manager = { ...member as object, role: "MANAGER" } as never;
  m.find.mockResolvedValue(null); await expect(decideDisregard(manager, "a", "request", true)).rejects.toMatchObject({ status: 409 });
  m.find.mockResolvedValue({ id: "a", status: "PAUSED", disregardReview: review }); await expect(decideDisregard(manager, "a", "replaced", true)).rejects.toMatchObject({ status: 409 });
  m.find.mockResolvedValue({ id: "a", status: "DISREGARDED", disregardReview: { ...review, status: "APPROVED" } });
  await expect(decideDisregard(manager, "a", "request", false)).resolves.toEqual({ status: "APPROVED" }); expect(m.update).not.toHaveBeenCalled();
});
