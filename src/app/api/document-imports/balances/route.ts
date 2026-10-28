import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizedCompany, importAccess, importOptions } from "@/modules/document-imports/server";
import { closingAccountBalance } from "@/modules/document-imports/account-balance";
import { validDate } from "@/modules/document-imports/model";
export const maxDuration = 300;
const querySchema = z.object({ clientId: z.string().min(1).max(100), date: z.string().refine(validDate), accountIds: z.array(z.string().uuid()).min(1).max(10) });
export async function POST(request: Request) {
  const access = await importAccess("INVESTMENT");
  if (!access) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!access.permission.canView) return NextResponse.json({ error: "Sem permissão para consultar saldos." }, { status: 403 });
  const body = querySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Selecione contas e uma data válida." }, { status: 400 });
  if (!await authorizedCompany(access.member.organizationId, body.data.clientId)) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
  try {
    const options = await importOptions(body.data.clientId, "INVESTMENT", "", false);
    const accounts = [...new Set(body.data.accountIds)];
    if (accounts.some((id) => !options.financialAccounts.some((item) => item.value === id))) return NextResponse.json({ error: "Conta não pertence à empresa selecionada." }, { status: 400 });
    const balances = [];
    const deadline = Date.now() + 220000;
    for (const id of accounts) balances.push(await closingAccountBalance(body.data.clientId, id, body.data.date, new Date(), deadline));
    return NextResponse.json({ balances });
  } catch { return NextResponse.json({ error: "Não foi possível consultar as contas do CA." }, { status: 502 }); }
}
