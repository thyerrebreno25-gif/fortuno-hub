import { NextResponse } from "next/server";
import { z } from "zod";
import { getInvoiceHistoryMember } from "@/modules/assistant/auth";
import { CategoryHistoryError, confirmCategoryHistory, continueCategoryHistory, getInvoiceHistoryAccounts, startInvoiceCategoryHistory } from "@/modules/assistant/category-history-server";

export const maxDuration = 300;
const id = z.string().min(1).max(200);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), clientId: id, accountId: id, start: z.string(), end: z.string() }).strict(),
  z.object({ action: z.literal("continue"), clientId: id, conversationId: id, messageId: id }).strict(),
  z.object({ action: z.literal("confirm"), clientId: id, conversationId: id, messageId: id,
    selections: z.array(z.object({ key: z.string().min(1).max(1000), categoryId: id }).strict()).min(1).max(5000) }).strict(),
]);
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível consultar o histórico." },
    { status: error instanceof CategoryHistoryError ? error.status : 400 });
}
export async function GET(request: Request) {
  const member = await getInvoiceHistoryMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida ou acesso não autorizado." }, { status: 401 });
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!clientId || clientId.length > 200) return NextResponse.json({ error: "Selecione um cliente." }, { status: 400 });
  try { return NextResponse.json({ accounts: await getInvoiceHistoryAccounts(member, clientId) }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const member = await getInvoiceHistoryMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida ou acesso não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitação de aprendizado inválida." }, { status: 400 });
  try {
    const body = parsed.data;
    if (body.action === "preview") return NextResponse.json(await startInvoiceCategoryHistory({ member, ...body }));
    if (body.action === "continue") return NextResponse.json(await continueCategoryHistory(member, body.conversationId, body.messageId, "INVOICE", body.clientId));
    return NextResponse.json(await confirmCategoryHistory({ member, ...body, surface: "INVOICE" }));
  } catch (error) { return failure(error); }
}
