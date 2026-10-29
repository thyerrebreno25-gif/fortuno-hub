import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorizedCompany, importAccess } from "@/modules/document-imports/server";
import { sendInvestmentReview, deliverySummary } from "@/modules/document-imports/delivery";
import { sendContractReview } from "@/modules/document-imports/contract-delivery";
export const maxDuration = 300;
const schema = z.object({ kind: z.enum(["INVESTMENT", "CONTRACT"]).default("INVESTMENT"), version: z.number().int().positive(), confirmation: z.literal("ENVIAR AO CA") });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Confirme os valores e o envio real ao CA." }, { status: 400 });
  const access = await importAccess(body.data.kind);
  if (!access) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!access.permission.canView || !access.permission.canExport || !access.permission.canEdit) return NextResponse.json({ error: "Sem permissão para enviar ao CA." }, { status: 403 });
  const { id } = await context.params;
  const draft = await prisma.documentImportReview.findFirst({ where: { id, organizationId: access.member.organizationId, kind: body.data.kind } });
  if (!draft || !await authorizedCompany(access.member.organizationId, draft.clientId)) return NextResponse.json({ error: "Revisão não encontrada." }, { status: 404 });
  try {
    const send = body.data.kind === "CONTRACT" ? sendContractReview : sendInvestmentReview;
    const result = await send({ organizationId: access.member.organizationId, userId: access.member.userId, reviewId: id, version: body.data.version });
    return NextResponse.json({ mode: "LIVE", completed: result.completed, draft: await prisma.documentImportReview.findFirst({ where: { id, organizationId: access.member.organizationId }, include: { deliveries: { select: deliverySummary, orderBy: { createdAt: "asc" } } } }) });
  } catch (error) {
    const message = error instanceof Error && !/token|bearer|postgres|prisma|https?:|invalid.*invocation/i.test(error.message) ? error.message.slice(0, 500) : "Não foi possível concluir o envio. Atualize o andamento antes de retomar.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
