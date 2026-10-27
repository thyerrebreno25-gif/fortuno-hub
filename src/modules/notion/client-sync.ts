import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { NotionError, notionFetch, notionToken } from "./server";
import { rerouteGmailTickets } from "@/modules/atendimento/routing/reprocess";
import { list, notionItem, object, string } from "./model";
import { hasClientSchema, matchClient, readAliases, readRows, resolvePerson } from "./client-sync-model";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function clientSourceOptions(organizationId: string) {
  const token = await notionToken(organizationId);
  const result = await notionFetch(token, "/search", { query: "Gestão de Clientes", page_size: 100, filter: { property: "object", value: "data_source" } });
  const options = [];
  for (const entry of list(result.results)) {
    if (object(entry).archived || object(entry).in_trash) continue;
    const source = await notionFetch(token, `/data_sources/${string(object(entry).id)}`);
    if (hasClientSchema(source)) { const item = notionItem(source); options.push({ id: item.id, name: `${item.title} · ${item.id.slice(0, 8)}` }); }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return options;
}
export async function syncNotionClients(organizationId: string, force = false) {
  const now = new Date(), deadline = Date.now() + 150000;
  const lease = await prisma.notionConnection.updateMany({ where: { organizationId, clientSyncEnabled: true, clientSourceId: { not: null }, AND: [
    { OR: [{ clientSyncLeaseUntil: null }, { clientSyncLeaseUntil: { lt: now } }] },
    ...(force ? [] : [{ OR: [{ clientSyncAt: null }, { clientSyncAt: { lt: new Date(+now - 15 * 60000) } }] }]),
  ] }, data: { clientSyncLeaseUntil: new Date(+now + 240000) } });
  if (!lease.count) return { skipped: true };
  try {
    const connection = await prisma.notionConnection.findUniqueOrThrow({ where: { organizationId } });
    const token = await notionToken(organizationId), source = await notionFetch(token, `/data_sources/${connection.clientSourceId}`);
    if (!hasClientSchema(source)) throw new Error("A base precisa dos campos Contas a Pagar, Contas a Receber e Supervisão.");
    const entries: unknown[] = []; let cursor: string | undefined;
    do {
      if (Date.now() > deadline || entries.length >= 2000) throw new Error("A base excedeu o limite de consulta. Nenhum cadastro foi alterado neste ciclo.");
      const page = await notionFetch(token, `/data_sources/${connection.clientSourceId}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      entries.push(...list(page.results)); cursor = page.has_more ? string(page.next_cursor) : undefined;
      if (cursor) await new Promise((resolve) => setTimeout(resolve, 400));
    } while (cursor);
    const rows = readRows(entries), aliases = readAliases(object(connection.clientSyncConfig).aliases);
    const [clients, memberships] = await Promise.all([
      prisma.client.findMany({ where: { organizationId, active: true }, include: { management: { select: { notionPageId: true } } } }),
      prisma.organizationMember.findMany({ where: { organizationId, role: { not: "CLIENT" } }, select: { user: { select: { id: true, name: true, email: true } } } }),
    ]);
    const people = memberships.map((member) => member.user), previous = object(connection.clientSyncState), next = { ...previous };
    const results: Array<{ clientId: string; client: string; pageId?: string; updated: boolean; issues: string[] }> = [];
    for (const client of clients) {
      const old = object(previous[client.id]), applied = object(old.applied);
      const matched = matchClient(client, rows, string(old.pageId) || client.management?.notionPageId);
      const row = matched.row;
      if (!row) { results.push({ clientId: client.id, client: client.name, updated: false, issues: [matched.issue!] }); continue; }
      const issues: string[] = [], changes: Record<string, string | null> = {}, managed = { ...applied };
      const roles = { payableResponsibleId: row.payable, receivableResponsibleId: row.receivable, operationLeaderId: row.supervisor, generalResponsibleId: row.supervisor } as const;
      const labels = { payableResponsibleId: "Pagar", receivableResponsibleId: "Receber", operationLeaderId: "Supervisão", generalResponsibleId: "Geral" };
      for (const [field, label] of Object.entries(roles) as Array<[keyof typeof roles, string]>) {
        const person = resolvePerson(label, people, aliases);
        if (person.issue) {
          issues.push(`${labels[field]}: ${person.issue}`);
          if (label || !(field in applied)) continue;
        }
        if (field in applied && client[field] !== applied[field]) { issues.push(`${labels[field]}: ajuste manual preservado`); continue; }
        managed[field] = person.id;
        if (client[field] !== person.id) changes[field] = person.id;
      }
      const newAliases = [...new Set([...(client.serviceAliases || "").split(/[,;\n]/).map((name) => name.trim()), row.alias].filter(Boolean))].join("\n") || null;
      if (newAliases !== client.serviceAliases) changes.serviceAliases = newAliases;
      if (row.squad && row.squad !== client.notionSquad) changes.notionSquad = row.squad;
      const cluster = ["A", "B", "C"].includes(row.cluster) ? row.cluster as "A" | "B" | "C" : null;
      if (cluster && client.cluster !== cluster) changes.cluster = cluster;
      let updated = false;
      await prisma.$transaction(async (tx) => {
        const changed = await tx.client.updateMany({ where: { id: client.id, organizationId, updatedAt: client.updatedAt }, data: { ...changes, ...(cluster && changes.cluster ? { cluster } : {}), notionSyncedAt: now } as Prisma.ClientUpdateManyMutationInput });
        if (!changed.count) { issues.push("Cadastro alterado durante a consulta; nova tentativa no próximo ciclo."); return; }
        updated = Object.keys(changes).length > 0;
        await tx.clientManagement.upsert({ where: { clientId: client.id }, create: { clientId: client.id, organizationId, notionPageId: row.id }, update: client.management?.notionPageId ? {} : { notionPageId: row.id } });
        for (const email of row.emails) await tx.clientEmailIdentity.upsert({ where: { clientId_normalizedEmail: { clientId: client.id, normalizedEmail: email } }, create: { clientId: client.id, email, normalizedEmail: email, label: "Notion", active: true }, update: {} });
        next[client.id] = { pageId: row.id, applied: managed };
        await tx.notionConnection.update({ where: { organizationId }, data: { clientSyncState: json(next) } });
        if (updated) await tx.auditLog.create({ data: { userId: connection.connectedById, entity: "Client", entityId: client.id, action: "NOTION_CLIENT_SYNC", beforeData: json(Object.fromEntries(Object.keys(changes).map((field) => [field, client[field as keyof typeof client]]))), afterData: json({ ...changes, notionPageId: row.id }) } });
      });
      results.push({ clientId: client.id, client: client.name, pageId: row.id, updated, issues: [...new Set(issues)] });
    }
    const routing = await rerouteGmailTickets(organizationId).catch(() => ({ error: "Clientes sincronizados; alguns e-mails aguardam nova tentativa de distribuição." }));
    const report = { routing, at: now.toISOString(), total: clients.length, matched: results.filter((r) => r.pageId).length, updated: results.filter((r) => r.updated).length, pending: results.filter((r) => r.issues.length).length, results };
    await prisma.notionConnection.update({ where: { organizationId }, data: { clientSyncAt: new Date(), clientSyncState: json(next), clientSyncReport: json(report) } });
    return report;
  } catch (error) {
    const report = { at: now.toISOString(), error: error instanceof NotionError || error instanceof Error && /^(A base precisa|A base excedeu)/.test(error.message) ? error.message : "Falha ao sincronizar os responsáveis. Nova tentativa no próximo ciclo." };
    await prisma.notionConnection.update({ where: { organizationId }, data: { clientSyncAt: new Date(), clientSyncReport: json(report) } });
    return report;
  } finally { await prisma.notionConnection.update({ where: { organizationId }, data: { clientSyncLeaseUntil: null } }); }
}
export async function runNotionClientSync() {
  const connections = await prisma.notionConnection.findMany({ where: { clientSyncEnabled: true }, select: { organizationId: true } });
  for (const connection of connections) await syncNotionClients(connection.organizationId);
}
