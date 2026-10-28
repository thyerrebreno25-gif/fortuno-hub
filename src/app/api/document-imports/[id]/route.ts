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
  const draft = await prisma.documentImportReview.findFirst({ where: { id, organizationId: access.member.organizationId, kind: body.data.data.kind } });
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
