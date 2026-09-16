import { NextResponse } from "next/server";
import { z } from "zod";
import { getAssistantMember } from "@/modules/assistant/auth";
import { CategoryHistoryError, confirmCategoryHistory, continueCategoryHistory, getHistoryAccounts, startCategoryHistory } from "@/modules/assistant/category-history-server";

export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
const idField = z.string().min(1).max(200);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), clientId: idField, accountId: idField, start: z.string(), end: z.string() }).strict(),
  z.object({ action: z.literal("continue"), messageId: idField }).strict(),
  z.object({ action: z.literal("confirm"), messageId: idField, selections: z.array(z.object({ key: z.string().min(1).max(1000), categoryId: idField }).strict()).min(1).max(5000) }).strict(),
]);
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível consultar o histórico." },
    { status: error instanceof CategoryHistoryError ? error.status : 400 });
}

export async function GET(request: Request, context: Context) {
  const member = await getAssistantMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida ou acesso não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!clientId) return NextResponse.json({ error: "Selecione um cliente." }, { status: 400 });
  try { return NextResponse.json({ accounts: await getHistoryAccounts(member, id, clientId) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  const member = await getAssistantMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida ou acesso não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitação de aprendizado inválida." }, { status: 400 });
  try {
    const body = parsed.data;
    if (body.action === "preview") return NextResponse.json(await startCategoryHistory({ member, conversationId: id, ...body }));
    if (body.action === "continue") return NextResponse.json(await continueCategoryHistory(member, id, body.messageId));
    return NextResponse.json(await confirmCategoryHistory({ member, conversationId: id, messageId: body.messageId, selections: body.selections }));
  } catch (error) { return failure(error); }
}
