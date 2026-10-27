import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), lease: vi.fn(), previous: vi.fn(), save: vi.fn(), clients: vi.fn(), source: vi.fn(), workerUpsert: vi.fn(), workerLease: vi.fn(), workerSave: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { clientManagement: { upsert: mocks.upsert, updateMany: mocks.lease, findUnique: mocks.previous, update: mocks.save }, client: { findMany: mocks.clients }, managementSyncState: { upsert: mocks.workerUpsert, updateMany: mocks.workerLease, update: mocks.workerSave } } }));
vi.mock("./source", () => ({ fetchManagementSnapshot: mocks.source }));
import { refreshManagementClient, runManagementSync, runScheduledManagementSync } from "./sync";
const old = { queriedAt: "2026-10-27T12:00:00Z", payable: { count: 1, amount: 50, items: [], complete: true, error: null }, receivable: { count: 0, amount: 0, items: [], complete: true, error: null }, accounts: [{ id: "a", name: "Banco", bank: "INTER", balance: 50, queriedAt: "2026-10-27T12:00:00Z", error: null }], accountsComplete: true, accountsError: null };
beforeEach(() => { vi.resetAllMocks(); mocks.lease.mockResolvedValue({ count: 1 }); mocks.previous.mockResolvedValue(null); mocks.source.mockResolvedValue(structuredClone(old)); mocks.workerLease.mockResolvedValue({ count: 1 }); });
it("does not consult fresh or already leased clients and enforces the 15-minute cutoff", async () => {
  mocks.lease.mockResolvedValue({ count: 0 });
  expect(await refreshManagementClient("c", "org")).toEqual({ status: "skipped" });
  expect(mocks.source).not.toHaveBeenCalled();
  expect(mocks.lease.mock.calls[0][0].where).toMatchObject({ clientId: "c", organizationId: "org", AND: expect.arrayContaining([expect.objectContaining({ OR: expect.arrayContaining([{ refreshedAt: null }]) })]) });
});
it("preserves previous balances and amounts with explicit failure markers on provider errors", async () => {
  mocks.previous.mockResolvedValue({ snapshot: old });
  mocks.source.mockResolvedValue({ ...structuredClone(old), payable: { count: 0, amount: 0, items: [], complete: false, error: "Falha" }, accounts: [], accountsError: "Falha no saldo" });
  expect((await refreshManagementClient("c", "org")).status).toBe("partial");
  const snapshot = mocks.save.mock.calls[0][0].data.snapshot;
  expect(snapshot.payable.amount).toBe(50); expect(snapshot.payable.error).toBeTruthy();
  expect(snapshot.accounts[0]).toMatchObject({ balance: 50, queriedAt: old.queriedAt, error: "Falha no saldo" });
});
it("retains client responsibility filters inside the automatic batch", async () => {
  mocks.clients.mockResolvedValue([{ id: "a", organizationId: "org" }, { id: "b", organizationId: "org" }]);
  const scope = { organizationId: "org", OR: [{ generalResponsibleId: "u" }] };
  const result = await runManagementSync(scope);
  expect(mocks.clients.mock.calls[0][0].where.AND[0]).toEqual(scope);
  expect(result.processed).toBe(2); expect(mocks.source).toHaveBeenCalledTimes(2);
});
it("does not run duplicate scheduled batches and records completion", async () => {
  mocks.workerLease.mockResolvedValueOnce({ count: 0 });
  expect(await runScheduledManagementSync()).toEqual({ alreadyRunning: true });
  expect(mocks.clients).not.toHaveBeenCalled();
  mocks.clients.mockResolvedValue([]);
  await runScheduledManagementSync();
  expect(mocks.workerSave).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ leaseUntil: null, lastFinishedAt: expect.any(Date) }) }));
});
