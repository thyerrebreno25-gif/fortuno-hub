import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/prisma", () => { const tx = { $queryRaw: m.query, $executeRaw: m.execute, auditLog: { create: m.audit } }; return { prisma: { ...tx, $transaction: (fn: (tx: unknown) => unknown) => fn(tx) } }; });
import { clearPaymentAlerts, paymentCleanupPeriod, previewPaymentCleanup, restorePaymentCleanup } from "./payment-cleanup";
const scope = { organizationId: "org", userId: "manager", recipient: "wa-account:current" };
const range = { mode: "PERIOD" as const, from: "2026-10-01", to: "2026-10-31" };
const row = { messageId: "message", status: "PENDING", checkedAt: null, createdAt: new Date("2026-10-15T12:00Z") };
beforeEach(() => { vi.clearAllMocks(); m.query.mockResolvedValue([row]); m.execute.mockResolvedValue(1); });
it("uses inclusive Brazilian local dates for a period and an exclusive cutoff for older alerts", () => {
  expect(paymentCleanupPeriod(range)).toEqual({ start: new Date("2026-10-01T03:00Z"), end: new Date("2026-11-01T03:00Z") });
  expect(paymentCleanupPeriod({ mode: "BEFORE", to: "2026-10-01" })).toEqual({ start: null, end: new Date("2026-10-01T03:00Z") });
  for (const invalid of [{ ...range, from: "2026-11-01" }, { ...range, to: "2026-02-30" }, { ...range, to: "2199-01-01" }]) expect(() => paymentCleanupPeriod(invalid)).toThrow();
});
it("previews the full scoped selection without changing alerts", async () => {
  expect(await previewPaymentCleanup(scope, range)).toMatchObject({ count: 1, pending: 1, checked: 0 });
  const query = m.query.mock.calls[0][0]; expect(query.values).toEqual(expect.arrayContaining(["org", "wa-account:current"]));
  expect(query.sql).toContain('p."clearedAt" IS NULL'); expect(query.sql).toContain('t."organizationId"'); expect(query.sql).not.toContain("FOR UPDATE"); expect(m.execute).not.toHaveBeenCalled();
});
it("archives only the locked previewed IDs and keeps original status, messages and financial references", async () => {
  const preview = await previewPaymentCleanup(scope, range); const result = await clearPaymentAlerts(scope, range, preview.fingerprint);
  expect(result.count).toBe(1); expect(m.query.mock.calls[1][0].sql).toContain("FOR UPDATE OF p");
  const query = m.execute.mock.calls[0][0]; expect(query.values).toEqual(expect.arrayContaining(["org", "manager", "message", "wa-account:current"]));
  expect(query.sql).not.toMatch(/DELETE|SET status|exportId|ServiceMessage/); expect(m.audit).toHaveBeenCalledOnce();
});
it("refuses a stale preview or more than 5000 alerts before any write", async () => {
  const preview = await previewPaymentCleanup(scope, range); m.query.mockResolvedValue([{ ...row, status: "REVIEWED", checkedAt: new Date() }]);
  await expect(clearPaymentAlerts(scope, range, preview.fingerprint)).rejects.toMatchObject({ status: 409 }); expect(m.execute).not.toHaveBeenCalled();
  m.query.mockResolvedValue(Array.from({ length: 5001 }, () => row)); await expect(previewPaymentCleanup(scope, range)).rejects.toThrow("período menor");
});
it("undoes only this manager's own cleanup in the same account and organization", async () => {
  await restorePaymentCleanup(scope, "batch"); const query = m.execute.mock.calls[0][0];
  expect(query.values).toEqual(expect.arrayContaining(["org", "manager", "wa-account:current", "batch"])); expect(query.sql).toContain('"clearedAt"=NULL'); expect(query.sql).not.toContain("status=");
});
