import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { cancelDisregardNotices } from "./disregard-cancel";
it("closes only approval notices of selected deleted activities in the same organization", async () => {
  const close = vi.fn(), recipients = vi.fn(), now = new Date();
  const tx = { notice: { updateMany: close }, noticeRecipient: { updateMany: recipients } } as never;
  await cancelDisregardNotices(tx, "org", [{ disregardReview: { requestId: "r", status: "PENDING", noticeId: "operation-disregard:r" } }, { disregardReview: { requestId: "old", status: "APPROVED", noticeId: "operation-disregard:old" } }], now);
  expect(close).toHaveBeenCalledWith({ where: { id: { in: ["operation-disregard:r"] }, organizationId: "org", closedAt: null }, data: { closedAt: now } });
  expect(recipients.mock.calls[0][0].where).toEqual({ noticeId: { in: ["operation-disregard:r"] }, notice: { organizationId: "org" } });
});
