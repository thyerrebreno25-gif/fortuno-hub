import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { assistantClientAccessWhere, findAssistantClient, getMemberForModule } from "@/modules/assistant/auth";
import { getRolePermissions } from "@/modules/permissions/permissions";
import { accountCheckInput, record, type ManagementSnapshot } from "@/modules/management/model";
import { fetchManagementSnapshot } from "@/modules/management/source";
import { notionFetch, notionToken } from "@/modules/notion/server";
export const maxDuration = 180;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function failure(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Confira os dados." }, { status: 400 });
  return NextResponse.json({ error: "Não foi possível concluir a consulta de gestão. Tente novamente." }, { status: 500 });
}
export async function GET() {
  try {
    const member = await getMemberForModule("MANAGEMENT");
    if (!member || member.role === "CLIENT") return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
    const permission = (await getRolePermissions(member.organizationId, member.role)).MANAGEMENT;
    const clients = await prisma.client.findMany({ where: { organizationId: member.organizationId, active: true, ...assistantClientAccessWhere(member) }, orderBy: { name: "asc" }, select: { id: true, name: true, document: true, cluster: true, operationLeader: { select: { name: true } }, contaAzulConnection: { select: { active: true, status: true } }, management: true } });
    return NextResponse.json({ clients: clients.map(({ management, ...client }) => ({ ...client, management: management ? { ...management, refreshLeaseUntil: undefined } : null })), canEdit: permission.canEdit, canManage: permission.canManage });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const member = await getMemberForModule("MANAGEMENT");
    if (!member || member.role === "CLIENT") return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
    const { clientId } = z.object({ clientId: z.string().min(1).max(100) }).parse(await request.json());
    if (!await findAssistantClient(member, clientId)) return NextResponse.json({ error: "Cliente não encontrado ou fora do seu acesso." }, { status: 404 });
    const connection = await prisma.contaAzulConnection.findFirst({ where: { organizationId: member.organizationId, clientId, active: true, status: "CONNECTED" }, select: { id: true } });
    if (!connection) return NextResponse.json({ error: "Conecte este cliente ao Conta Azul para atualizar os dados." }, { status: 400 });
    await prisma.clientManagement.upsert({ where: { clientId }, create: { clientId, organizationId: member.organizationId }, update: {} });
    const now = new Date();
    const leased = await prisma.clientManagement.updateMany({ where: { clientId, organizationId: member.organizationId, OR: [{ refreshLeaseUntil: null }, { refreshLeaseUntil: { lt: now } }] }, data: { refreshLeaseUntil: new Date(+now + 180000) } });
    if (!leased.count) return NextResponse.json({ error: "Já existe uma atualização em andamento para este cliente." }, { status: 409 });
    try {
      const snapshot = await fetchManagementSnapshot(clientId);
      const errors = [snapshot.payable.error, snapshot.receivable.error, snapshot.accountsError].filter(Boolean);
      await prisma.clientManagement.update({ where: { clientId }, data: { snapshot: json(snapshot), refreshedAt: new Date(), lastError: errors.length ? errors.join(" ") : null, refreshLeaseUntil: null } });
      return NextResponse.json({ ok: true });
    } catch {
      await prisma.clientManagement.update({ where: { clientId }, data: { refreshLeaseUntil: null, lastError: "A atualização falhou. Os dados anteriores foram preservados." } });
      return NextResponse.json({ error: "A atualização falhou. Os dados anteriores foram preservados." }, { status: 502 });
    }
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const member = await getMemberForModule("MANAGEMENT");
    if (!member || member.role === "CLIENT") return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
    const permissions = await getRolePermissions(member.organizationId, member.role);
    if (!permissions.MANAGEMENT.canEdit) return NextResponse.json({ error: "Seu perfil permite apenas consultar a gestão." }, { status: 403 });
    const body = record(await request.json()), clientId = z.string().min(1).max(100).parse(body.clientId);
    if (!await findAssistantClient(member, clientId)) return NextResponse.json({ error: "Cliente não encontrado ou fora do seu acesso." }, { status: 404 });
    if (body.action === "notion") {
      if (!permissions.MANAGEMENT.canManage || !permissions.NOTION.canView) return NextResponse.json({ error: "Apenas gestores com acesso ao Notion podem vincular páginas." }, { status: 403 });
      const pageId = z.string().uuid().nullable().parse(body.pageId);
      if (pageId) await notionFetch(await notionToken(member.organizationId), `/pages/${pageId}`);
      await prisma.$transaction(async (tx) => {
        await tx.clientManagement.upsert({ where: { clientId }, create: { clientId, organizationId: member.organizationId, notionPageId: pageId }, update: { notionPageId: pageId } });
        await tx.auditLog.create({ data: { userId: member.userId, action: "MANAGEMENT_NOTION_LINK", entity: "Client", entityId: clientId, afterData: { pageId } } });
      });
      return NextResponse.json({ ok: true });
    }
    const input = accountCheckInput.parse(body);
    const stored = await prisma.clientManagement.findUnique({ where: { clientId } });
    const snapshot = stored?.snapshot as ManagementSnapshot | null;
    if (!stored || !snapshot?.accounts?.some((account) => account.id === input.accountId)) return NextResponse.json({ error: "Atualize o cliente e selecione uma conta financeira válida." }, { status: 400 });
    const checks = record(stored.checkedAccounts);
    const { accountId, revision, ...values } = input;
    const next = { ...values, checkedAt: new Date().toISOString(), checkedBy: member.user.name || member.user.email };
    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.clientManagement.updateMany({ where: { clientId, organizationId: member.organizationId, revision }, data: { checkedAccounts: json({ ...checks, [accountId]: next }), revision: { increment: 1 } } });
      if (!updated.count) return false;
      await tx.auditLog.create({ data: { userId: member.userId, action: "MANAGEMENT_ACCOUNT_CHECK", entity: "Client", entityId: clientId, beforeData: json({ accountId, check: checks[accountId] ?? null }), afterData: json({ accountId, check: next }) } });
      return true;
    });
    return saved ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "A conferência mudou. Atualize a tela antes de salvar novamente." }, { status: 409 });
  } catch (error) { return failure(error); }
}
