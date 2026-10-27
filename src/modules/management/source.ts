import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
import { apiItems } from "@/modules/conta-azul/financial-export";
import { finiteMoney, localDay, overdueItem, record, type AccountSnapshot, type FlowSnapshot, type ManagementSnapshot } from "./model";

function rowsFrom(body: unknown) {
  const value = record(body);
  if (!Array.isArray(body) && ![value.itens, value.items, value.data, value.conteudo].some(Array.isArray)) throw new Error("Resposta financeira incompleta.");
  return apiItems(body);
}

async function flow(clientId: string, kind: string, start: string, end: string, deadline: number): Promise<FlowSnapshot> {
  const result: FlowSnapshot = { count: 0, amount: 0, items: [], complete: false, error: null };
  const seen = new Set<string>();
  try {
    for (let page = 1; page <= 20 && Date.now() < deadline; page++) {
      const query = new URLSearchParams({ pagina: String(page), tamanho_pagina: "1000", data_vencimento_de: start, data_vencimento_ate: end });
      for (const status of ["ATRASADO", "EM_ABERTO", "RECEBIDO_PARCIAL"]) query.append("status", status);
      const body = await contaAzulRequest<unknown>(clientId, `/v1/financeiro/eventos-financeiros/${kind}/buscar?${query}`, { signal: AbortSignal.timeout(12000) });
      const items = rowsFrom(body);
      for (const raw of items) {
        const item = overdueItem(raw, localDay());
        if (!item || !item.id || seen.has(item.id)) continue;
        seen.add(item.id); result.count++; result.amount += item.amount;
        if (result.items.length < 200) result.items.push(item);
      }
      const total = finiteMoney(record(body).itens_totais);
      if (items.length < 1000 || total !== null && page * 1000 >= total) { result.complete = true; break; }
    }
    result.amount = Math.round(result.amount * 100) / 100;
  } catch { result.error = "Não foi possível consultar os títulos no Conta Azul. Tente atualizar novamente."; }
  return result;
}

export async function fetchManagementSnapshot(clientId: string): Promise<ManagementSnapshot> {
  const now = new Date(), today = localDay(now), yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const start = "2000-01-01", end = yesterday.toISOString().slice(0, 10), deadline = Date.now() + 90000;
  // Each client's rotating refresh token must only be used sequentially.
  const accounts: AccountSnapshot[] = [];
  let accountsComplete = false, accountsError: string | null = null;
  try {
    for (let page = 1; page <= 10 && Date.now() < deadline; page++) {
      const body = await contaAzulRequest<unknown>(clientId, `/v1/conta-financeira?pagina=${page}&tamanho_pagina=100&apenas_ativo=true`, { signal: AbortSignal.timeout(12000) });
      const rows = rowsFrom(body);
      for (const row of rows) {
        const id = String(row.id || "");
        if (!id || accounts.some((account) => account.id === id)) continue;
        const account: AccountSnapshot = { id, name: String(row.nome || "Conta sem nome"), bank: String(row.banco || row.tipo || ""), balance: null, queriedAt: new Date().toISOString(), error: null };
        if (Date.now() >= deadline) account.error = "Atualize para consultar o saldo desta conta.";
        else try {
          const response = await contaAzulRequest<Record<string, unknown>>(clientId, `/v1/conta-financeira/${encodeURIComponent(id)}/saldo-atual`, { signal: AbortSignal.timeout(12000) });
          account.balance = finiteMoney(response.saldo_atual);
          account.queriedAt = new Date().toISOString();
          if (account.balance === null) account.error = "Saldo não informado pelo Conta Azul.";
        } catch { account.error = "Saldo indisponível no Conta Azul. Atualize novamente."; }
        accounts.push(account);
      }
      const total = finiteMoney(record(body).itens_totais);
      if (rows.length < 100 || total !== null && page * 100 >= total) { accountsComplete = true; break; }
    }
  } catch { accountsError = "Não foi possível consultar as contas financeiras no Conta Azul."; }
  const payable = await flow(clientId, "contas-a-pagar", start, end, deadline);
  const receivable = await flow(clientId, "contas-a-receber", start, end, deadline);
  return { queriedAt: now.toISOString(), start, end, payable, receivable, accounts, accountsComplete, accountsError };
}
