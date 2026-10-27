import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { fetchManagementSnapshot } from "./source";
import type { ManagementSnapshot } from "./model";
export const MANAGEMENT_REFRESH_MS = 15 * 60 * 1000;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function refreshManagementClient(clientId: string, organizationId: string, force = false) {
  await prisma.clientManagement.upsert({ where: { clientId }, create: { clientId, organizationId }, update: {} });
  const now = new Date(), cutoff = new Date(+now - MANAGEMENT_REFRESH_MS);
  const leased = await prisma.clientManagement.updateMany({ where: { clientId, organizationId, AND: [
    { OR: [{ refreshLeaseUntil: null }, { refreshLeaseUntil: { lt: now } }] },
    ...(force ? [] : [{ OR: [{ refreshedAt: null }, { refreshedAt: { lt: cutoff } }] }]),
  ] }, data: { refreshLeaseUntil: new Date(+now + 180000) } });
  if (!leased.count) return { status: "skipped" as const };
  try {
    const previous = await prisma.clientManagement.findUnique({ where: { clientId }, select: { snapshot: true } });
    const snapshot = await fetchManagementSnapshot(clientId), old = previous?.snapshot as ManagementSnapshot | null;
    const errors = [snapshot.payable.error, snapshot.receivable.error, snapshot.accountsError, ...snapshot.accounts.map((account) => account.error)].filter(Boolean);
    // Preserve known values during provider failures, retaining their original timestamps.
    if (old) {
      if (snapshot.payable.error) snapshot.payable = { ...old.payable, complete: false, error: snapshot.payable.error };
      if (snapshot.receivable.error) snapshot.receivable = { ...old.receivable, complete: false, error: snapshot.receivable.error };
      if (snapshot.accountsError) snapshot.accounts = old.accounts.map((account) => ({ ...account, error: snapshot.accountsError }));
      else snapshot.accounts = snapshot.accounts.map((account) => {
        const previousAccount = old.accounts.find((item) => item.id === account.id);
        return account.error && previousAccount ? { ...previousAccount, error: account.error } : account;
      });
    }
    await prisma.clientManagement.update({ where: { clientId }, data: { snapshot: json(snapshot), refreshedAt: new Date(), lastError: errors.length ? [...new Set(errors)].join(" ") : null, refreshLeaseUntil: null } });
    return { status: errors.length ? "partial" as const : "updated" as const };
  } catch {
    await prisma.clientManagement.update({ where: { clientId }, data: { refreshedAt: new Date(), refreshLeaseUntil: null, lastError: "A atualização falhou. Os dados anteriores foram preservados; nova tentativa no próximo ciclo automático." } });
    return { status: "failed" as const };
  }
}

export async function runManagementSync(scope: Prisma.ClientWhereInput = {}) {
  const cutoff = new Date(Date.now() - MANAGEMENT_REFRESH_MS), stopStartingAt = Date.now() + 150000;
  const clients = await prisma.client.findMany({ where: { active: true, contaAzulConnection: { is: { active: true, status: "CONNECTED" } }, AND: [scope, { OR: [{ management: { is: null } }, { management: { is: { refreshedAt: null } } }, { management: { is: { refreshedAt: { lt: cutoff } } } }] }] }, orderBy: [{ management: { refreshedAt: { sort: "asc", nulls: "first" } } }, { id: "asc" }], select: { id: true, organizationId: true }, take: 1000 });
  let index = 0, processed = 0, failed = 0, skipped = 0;
  const worker = async () => {
    while (Date.now() < stopStartingAt) {
      const client = clients[index++]; if (!client) return;
      try {
        const result = await refreshManagementClient(client.id, client.organizationId);
        if (result.status === "skipped") skipped++;
        else { processed++; if (result.status !== "updated") failed++; }
      } catch { failed++; }
    }
  };
  // Parallelism is only across different clients; calls inside each tenant stay sequential.
  await Promise.all([worker(), worker(), worker()]);
  return { processed, failed, skipped, remaining: Math.max(0, clients.length - Math.min(index, clients.length)) };
}

export async function runScheduledManagementSync() {
  const id = "worker", now = new Date();
  await prisma.managementSyncState.upsert({ where: { id }, create: { id, origin: "worker" }, update: {} });
  const lease = await prisma.managementSyncState.updateMany({ where: { id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseUntil: new Date(+now + 300000), lastStartedAt: now } });
  if (!lease.count) return { alreadyRunning: true };
  try {
    const result = await runManagementSync();
    await prisma.managementSyncState.update({ where: { id }, data: { leaseUntil: null, lastFinishedAt: new Date(), processed: result.processed, failed: result.failed, lastError: result.remaining ? `${result.remaining} clientes aguardam o próximo ciclo.` : result.failed ? "Alguns clientes precisam de nova tentativa; consulte o erro em cada cliente." : null } });
    return result;
  } catch {
    await prisma.managementSyncState.update({ where: { id }, data: { leaseUntil: null, lastFinishedAt: new Date(), lastError: "Falha no ciclo automático. Nova tentativa no próximo agendamento." } });
    return { failed: true };
  }
}
