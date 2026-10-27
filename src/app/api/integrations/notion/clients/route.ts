import { after, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getRolePermissions } from "@/modules/permissions/permissions";
import { notionAccess, notionFailure, NotionError } from "@/modules/notion/server";
import { clientSourceOptions, syncNotionClients } from "@/modules/notion/client-sync";
export const maxDuration = 300;
async function access() {
  const context = await notionAccess(true);
  if (!(await getRolePermissions(context.member.organizationId, context.member.role)).CLIENTS.canEdit) throw new NotionError("Sem permissão para atualizar clientes.", 403);
  return context;
}
export async function GET(request: Request) {
  try {
    const { member } = await access();
    const connection = await prisma.notionConnection.findUnique({ where: { organizationId: member.organizationId }, select: { clientSourceId: true, clientSyncConfig: true, clientSyncAt: true, clientSyncEnabled: true, clientSyncLeaseUntil: true, clientSyncReport: true } });
    const sources = new URL(request.url).searchParams.get("sources") === "1" ? await clientSourceOptions(member.organizationId) : undefined;
    return NextResponse.json({ connection, sources, running: Boolean(connection?.clientSyncLeaseUntil && connection.clientSyncLeaseUntil > new Date()) });
  } catch (error) { return notionFailure(error); }
}
export async function POST(request: Request) {
  try {
    const { member } = await access();
    const input = z.object({ sourceId: z.string().uuid(), enabled: z.boolean().default(true), aliases: z.record(z.string().max(100), z.string().min(1).max(150)).default({}) }).parse(await request.json());
    const existing = await prisma.notionConnection.findUnique({ where: { organizationId: member.organizationId }, select: { clientSyncLeaseUntil: true } });
    if (!existing) throw new NotionError("Conecte o Notion primeiro.");
    if (existing.clientSyncLeaseUntil && existing.clientSyncLeaseUntil > new Date()) throw new NotionError("Já existe uma sincronização em andamento.", 409);
    await prisma.notionConnection.update({ where: { organizationId: member.organizationId }, data: { clientSourceId: input.sourceId, clientSyncConfig: { aliases: input.aliases }, clientSyncEnabled: input.enabled, clientSyncAt: null } });
    if (input.enabled) after(async () => { await syncNotionClients(member.organizationId, true); });
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) { return notionFailure(error); }
}
