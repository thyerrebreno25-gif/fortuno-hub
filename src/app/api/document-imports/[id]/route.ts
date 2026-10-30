import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { reviewSchema } from "@/modules/document-imports/model";
import { authorizedCompany, importAccess, simulateReview } from "@/modules/document-imports/server";
export const maxDuration = 300;
const bodySchema = z.object({ version: z.number().int().positive(), data: reviewSchema, action: z.enum(["save", "simulate"]) });
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const access = await importAccess(body.data.data.kind);
  if (!access) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!access.permission.canEdit) return NextResponse.json({ error: "Sem permissão para revisar." }, { status: 403 });
  const { id } = await context.params;
  const draft = await prisma.documentImportReview.findFirst({ where: { id, organizationId: access.member.organizationId, kind: body.data.data.kind, status: { not: "DELETED" } } });
  if (!draft || !await authorizedCompany(access.member.organizationId, draft.clientId)) return NextResponse.json({ error: "Revisão não encontrada." }, { status: 404 });
  if (draft.version !== body.data.version) return NextResponse.json({ error: "A revisão foi alterada em outra aba. Recarregue antes de salvar." }, { status: 409 });
  let simulation: Awaited<ReturnType<typeof simulateReview>> | null = null;
  if (body.data.action === "simulate") {
    try { simulation = await simulateReview(draft.clientId, body.data.data); }
    catch { return NextResponse.json({ error: "A consulta ao Conta Azul falhou. Nenhum lançamento foi criado." }, { status: 502 }); }
  }
  const result = await prisma.documentImportReview.updateMany({ where: { id, organizationId: access.member.organizationId, version: body.data.version, deliveries: { none: {} } }, data: { data: body.data.data as Prisma.InputJsonValue, version: { increment: 1 }, simulation: simulation ? simulation as unknown as Prisma.InputJsonValue : Prisma.DbNull, status: simulation && !simulation.errors.length ? "TESTED" : "REVIEW" } });
  if (!result.count) return NextResponse.json({ error: "A revisão foi alterada ou já possui envio iniciado. Recarregue a tela; envios iniciados não podem ser editados." }, { status: 409 });
  return NextResponse.json({ draft: await prisma.documentImportReview.findFirst({ where: { id, organizationId: access.member.organizationId } }), mode: "SIMULATION" });
}

// Removing a review from the Hub never removes its CA contract or deduplication history.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = z.object({ version: z.number().int().positive() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Revisão inválida." }, { status: 400 });
  const access = await importAccess("CONTRACT");
  if (!access) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!access.permission.canDelete) return NextResponse.json({ error: "Sem permissão para excluir." }, { status: 403 });
  const { id } = await context.params;
  const organizationId = access.member.organizationId;
  const draft = await prisma.documentImportReview.findFirst({ where: { id, organizationId, kind: "CONTRACT", status: { not: "DELETED" } } });
  if (!draft || !await authorizedCompany(organizationId, draft.clientId)) return NextResponse.json({ error: "Revisão não encontrada." }, { status: 404 });
  const token = crypto.randomUUID();
  await prisma.documentImportDispatchLease.upsert({ where: { clientId: draft.clientId }, create: { clientId: draft.clientId, organizationId, token: "", expiresAt: new Date(0) }, update: {} });
  const locked = await prisma.documentImportDispatchLease.updateMany({ where: { clientId: draft.clientId, organizationId, expiresAt: { lte: new Date() } }, data: { token, expiresAt: new Date(Date.now() + 60000) } });
  if (!locked.count) return NextResponse.json({ error: "Há um envio em andamento. Aguarde antes de excluir." }, { status: 409 });
  try {
    const removed = await prisma.$transaction(async tx => {
      const result = await tx.documentImportReview.updateMany({ where: { id, organizationId, version: body.data.version, status: { not: "DELETED" } }, data: { status: "DELETED", version: { increment: 1 } } });
      if (result.count) await tx.auditLog.create({ data: { userId: access.member.userId, action: "CONTRACT_REVIEW_REMOVED", entity: "DocumentImportReview", entityId: id, beforeData: { status: draft.status, fileName: draft.fileName }, afterData: { status: "DELETED", caContractPreserved: true } } });
      return result.count;
    });
    return removed ? NextResponse.json({ removed: true }) : NextResponse.json({ error: "A revisão mudou. Recarregue antes de excluir." }, { status: 409 });
  } finally { await prisma.documentImportDispatchLease.updateMany({ where: { clientId: draft.clientId, token }, data: { expiresAt: new Date(0) } }); }
}
