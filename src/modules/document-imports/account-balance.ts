import "server-only";
import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
import { validDate } from "./model";
import type { AccountClosingBalance } from "./balance-model";
type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const reais = (value: unknown) => { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Valor financeiro não informado pela API."); return Math.round(value * 100); };
const day = (value: unknown) => { const result = typeof value === "string" ? value.slice(0, 10) : ""; if (!validDate(result)) throw new Error("Data de movimento não informada pela API."); return result; };
const account = (value: unknown) => typeof value === "string" ? value : String(record(value).id || "");
export function brazilToday(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function nextDay(value: string) { const date = new Date(value + "T12:00:00Z"); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }

async function pages(clientId: string, path: string, filters: Record<string, string>, deadline: number) {
  const rows: Row[] = [];
  let expectedTotal: number | null = null;
  const seenPages = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    if (Date.now() > deadline) throw new Error("Consulta de fechamento excedeu o tempo disponível.");
    const query = new URLSearchParams({ ...filters, pagina: String(page), tamanho_pagina: "100" });
    const body = record(await contaAzulRequest(clientId, `${path}?${query}`));
    if (!Array.isArray(body.itens) || typeof body.itens_totais !== "number") throw new Error("A API não confirmou a paginação completa dos movimentos.");
    if (!Number.isInteger(body.itens_totais) || body.itens_totais < 0 || expectedTotal !== null && body.itens_totais !== expectedTotal) throw new Error("A consulta de movimentos mudou durante a paginação.");
    expectedTotal = body.itens_totais;
    const signature = JSON.stringify(body.itens);
    if (seenPages.has(signature)) throw new Error("A consulta de movimentos repetiu uma página e ficou incompleta.");
    seenPages.add(signature);
    rows.push(...body.itens.map(record));
    if (rows.length >= body.itens_totais) return rows;
    if (!body.itens.length) throw new Error("A consulta de movimentos retornou uma página incompleta.");
  }
  throw new Error("Volume de movimentos excedeu o limite de validação automática.");
}

// Public CA only exposes current balance. Roll back every known subsequent cash
// movement; missing pages/fields or a moving current balance invalidate the result.
export async function closingAccountBalance(clientId: string, accountId: string, date: string, now = new Date(), sharedDeadline = Infinity): Promise<AccountClosingBalance> {
  const base = { accountId, date, checkedAt: now.toISOString() };
  const today = brazilToday(now);
  if (!validDate(date) || date > today) return { ...base, balanceCents: null, method: "UNAVAILABLE", reason: "A data final é inválida ou está no futuro." };
  const deadline = Math.min(Date.now() + 90000, sharedDeadline);
  try {
    if (Date.now() > deadline) throw new Error("Consulta de fechamento excedeu o tempo disponível.");
    const balancePath = `/v1/conta-financeira/${encodeURIComponent(accountId)}/saldo-atual`;
    const initialCurrent = reais(record(await contaAzulRequest(clientId, balancePath)).saldo_atual);
    if (date === today) return { ...base, balanceCents: initialCurrent, method: "CURRENT" };
    const start = nextDay(date);
    let subsequentCents = 0;
    const settledIds = new Set<string>();
    for (const [flow, sign] of [["contas-a-receber", 1], ["contas-a-pagar", -1]] as const) {
      // No account filter: a settlement can use a different account from its installment.
      const installments = await pages(clientId, `/v1/financeiro/eventos-financeiros/${flow}/buscar`, { data_vencimento_de: "1900-01-01", data_vencimento_ate: "2199-12-31", data_pagamento_de: start, data_pagamento_ate: today }, deadline);
      if (installments.length > 150) throw new Error("Muitas parcelas após o fechamento para validar automaticamente.");
      const seen = new Set<string>();
      for (const installment of installments) {
        if (Date.now() > deadline) throw new Error("Consulta de fechamento excedeu o tempo disponível.");
        if (typeof installment.id !== "string" || !installment.id) throw new Error("Parcela sem identificador na consulta.");
        if (seen.has(installment.id)) continue;
        seen.add(installment.id);
        const settlements = await contaAzulRequest<unknown>(clientId, `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(installment.id)}/baixa`);
        if (!Array.isArray(settlements) || !settlements.length) throw new Error("As baixas de uma parcela paga não puderam ser confirmadas.");
        for (const value of settlements) {
          const settlement = record(value);
          const settlementAccount = account(settlement.conta_financeira);
          if (!settlementAccount) throw new Error("Baixa sem conta financeira na API.");
          if (settlementAccount !== accountId) continue;
          const paidDate = day(settlement.data_pagamento);
          if (paidDate < start || paidDate > today) continue;
          if (settlement.origem === "TRANSFERENCIA" || settlement.origem === "SALDO_CONTA_BANCARIA") continue;
          if (typeof settlement.id !== "string") throw new Error("Baixa sem identificador na API.");
          if (settledIds.has(settlement.id)) continue;
          settledIds.add(settlement.id);
          const composition = record(settlement.valor_composicao);
          subsequentCents += sign * reais(composition.valor_liquido);
        }
      }
    }
    const transfers = await pages(clientId, "/v1/financeiro/transferencias", { ids_conta_financeira: accountId, data_inicio: start, data_fim: today }, deadline);
    const transferIds = new Set<string>();
    for (const transfer of transfers) {
      if (typeof transfer.id !== "string") throw new Error("Transferência sem identificador na API.");
      if (transferIds.has(transfer.id)) continue;
      transferIds.add(transfer.id);
      for (const [name, sign] of [["origem", -1], ["destino", 1]] as const) {
        const leg = record(transfer[name]);
        if (!account(leg.conta_financeira)) throw new Error("Transferência sem conta de origem ou destino.");
        if (account(leg.conta_financeira) !== accountId) continue;
        const legDate = day(leg.data);
        if (legDate >= start && legDate <= today) subsequentCents += sign * reais(record(leg.composicao_valor).valor_liquido);
      }
    }
    const openings = await pages(clientId, "/v1/financeiro/eventos-financeiros/saldo-inicial", { data_inicio: start + "T00:00:00", data_fim: today + "T23:59:59" }, deadline);
    for (const opening of openings) {
      if (opening.id_conta_financeira !== accountId) continue;
      const openingDate = day(opening.data_competencia);
      if (openingDate >= start && openingDate <= today) {
        if (opening.tipo !== "RECEITA" && opening.tipo !== "DESPESA") throw new Error("Saldo inicial sem sinal reconhecido.");
        subsequentCents += (opening.tipo === "DESPESA" ? -1 : 1) * Math.abs(reais(opening.saldo_inicial));
      }
    }
    const finalCurrent = reais(record(await contaAzulRequest(clientId, balancePath)).saldo_atual);
    if (finalCurrent !== initialCurrent || brazilToday() !== today) throw new Error("O saldo mudou durante a consulta. Atualize para conferir novamente.");
    return { ...base, balanceCents: finalCurrent - subsequentCents, method: "RECONSTRUCTED" };
  } catch (error) {
    return { ...base, balanceCents: null, method: "UNAVAILABLE", reason: error instanceof Error && /^(Valor financeiro|Data de movimento|Consulta de fechamento|A API não confirmou|A consulta de movimentos|Volume de movimentos|Muitas parcelas|Parcela sem|As baixas de uma|Baixa sem|Transferência sem|Saldo inicial sem|O saldo mudou)/.test(error.message) ? error.message : "Não foi possível obter todos os movimentos do fechamento." };
  }
}
