import { NextResponse } from "next/server";
import { findAuthorizedClient, getPurchaseInvoiceMember, getPurchaseInvoicePermission } from "@/modules/purchase-invoices/server/auth";
import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";

type ApiItem = Record<string, unknown>;

function itemsFrom(body: unknown): ApiItem[] {
  if (Array.isArray(body)) return body.filter((item): item is ApiItem => Boolean(item && typeof item === "object"));
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const candidates = [record.itens, record.items, record.data, record.conteudo];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item): item is ApiItem => Boolean(item && typeof item === "object"));
  }
  if (typeof record.uuid === "string" || typeof record.id === "string") return [record];
  return [];
}

function optionFrom(item: ApiItem) {
  const id = [item.id, item.uuid, item.id_categoria, item.id_centro_custo, item.id_conta_financeira].find((value) => typeof value === "string") as string | undefined;
  const label = [item.nome, item.descricao, item.name, item.razao_social].find((value) => typeof value === "string") as string | undefined;
  if (!id || !label) return null;
  const rawType = typeof item.tipo === "string" ? item.tipo.toUpperCase() : "";
  const type = rawType === "RECEITA" || rawType === "DESPESA" ? rawType : undefined;
  return {
    value: id,
    label,
    document: typeof item.documento === "string" ? item.documento : null,
    ...(type ? { type } : {}),
  };
}

export async function GET(request: Request) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.json({ error: "Sua sessão expirou." }, { status: 401 });
  const permission = await getPurchaseInvoicePermission(member);
  if (!permission.canView) return NextResponse.json({ error: "Sem permissão para consultar a Conta Azul." }, { status: 403 });
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  const scope = url.searchParams.get("scope") || "all";
  const supplierTerm = url.searchParams.get("supplier")?.trim() || "";
  const client = await findAuthorizedClient(member, clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });

  try {
    const normalize = (body: unknown) => itemsFrom(body).map(optionFrom).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (scope === "financial-accounts") {
      const accountsBody = await contaAzulRequest<unknown>(clientId, "/v1/conta-financeira?pagina=1&tamanho_pagina=1000&apenas_ativo=true");
      return NextResponse.json({ financialAccounts: normalize(itemsFrom(accountsBody).filter((item) => item.ativo !== false)) });
    }
    const supplierParams = new URLSearchParams({ pagina: "1", tamanho_pagina: "1000", tipo_perfil: "FORNECEDOR", status: "ATIVO" });
    if (supplierTerm) supplierParams.set("termo_busca", supplierTerm);
    // A Conta Azul rotaciona o refresh_token a cada renovação. As chamadas são
    // sequenciais para impedir que quatro requisições tentem renovar o mesmo
    // token simultaneamente quando a conexão estiver expirada.
    const categoriesBody = await contaAzulRequest<unknown>(clientId, "/v1/categorias?pagina=1&tamanho_pagina=1000");
    if (scope === "categories") {
      return NextResponse.json({ categories: normalize(categoriesBody) });
    }
    const costCentersBody = await contaAzulRequest<unknown>(clientId, "/v1/centro-de-custo?pagina=1&tamanho_pagina=1000");
    const accountsBody = await contaAzulRequest<unknown>(clientId, "/v1/conta-financeira?pagina=1&tamanho_pagina=1000&apenas_ativo=true");
    if (scope === "financial-export") {
      return NextResponse.json({
        categories: normalize(categoriesBody),
        costCenters: normalize(costCentersBody),
        financialAccounts: normalize(accountsBody),
      });
    }
    const suppliersBody = await contaAzulRequest<unknown>(clientId, `/v1/pessoa?${supplierParams.toString()}`);

    return NextResponse.json({
      categories: normalize(categoriesBody),
      costCenters: normalize(costCentersBody),
      financialAccounts: normalize(accountsBody),
      suppliers: normalize(suppliersBody),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível consultar a Conta Azul." }, { status: 502 });
  }
}
