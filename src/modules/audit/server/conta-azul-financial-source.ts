import {auditDate} from "../period";
import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
import type { ContaAzulAuditEntry } from "../financial-history-engine";

type ApiRecord = Record<string, unknown>;

function apiItems(body: unknown): ApiRecord[] {
  if (Array.isArray(body)) {if(!body.every(isRecord))throw new Error("O CA retornou um lançamento inválido.");return body;}
  if (!isRecord(body)) throw new Error("O CA retornou uma consulta financeira inválida.");
  for (const value of [body.itens, body.items, body.data, body.conteudo]) {
    if (Array.isArray(value)) {if(!value.every(isRecord))throw new Error("O CA retornou um lançamento inválido.");return value;}
  }
  throw new Error("O CA não retornou a lista completa de lançamentos.");
}

function isRecord(value: unknown): value is ApiRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstString(record: ApiRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const cleaned = value.replace(/[^0-9,.-]/g, "");
  const parsed = Number(cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function names(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (!isRecord(item)) return [];
    const name = firstString(item, ["nome", "descricao", "name"]);
    return name ? [name] : [];
  });
}

function contactName(item: ApiRecord, flow: ContaAzulAuditEntry["flow"]) {
  const contact = flow === "PAYABLE" ? item.fornecedor : item.cliente;
  if (!isRecord(contact)) return firstString(item, ["nome_contato", "contato", "fornecedor", "cliente"]);
  return firstString(contact, ["nome", "razao_social", "nome_fantasia", "name"]);
}

export function financialEntry(item: ApiRecord, flow: ContaAzulAuditEntry["flow"], fallbackId: string): ContaAzulAuditEntry | null {
  const dueDate = firstString(item, ["data_vencimento", "vencimento"]);
  if (!dueDate || !auditDate(dueDate.slice(0,10))) return null;
  if(!firstString(item,["id","uuid","id_parcela","id_evento"])||item.total==null&&item.valor==null&&item.valor_bruto==null)return null;
  const total = numberValue(item.total ?? item.valor ?? item.valor_bruto);
  const paid = numberValue(item.pago ?? item.valor_pago ?? item.recebido);
  const outstandingSource = item.nao_pago ?? item.valor_em_aberto ?? item.saldo;
  const outstanding = outstandingSource == null
    ? Math.max(0, total - paid)
    : numberValue(outstandingSource);
  return {
    id: firstString(item, ["id", "uuid", "id_parcela", "id_evento"]) || fallbackId,
    flow,
    description: firstString(item, ["descricao", "nome", "observacao", "referencia"]) || "Sem descrição",
    counterparty: contactName(item, flow),
    categories: names(item.categorias ?? item.categorias_rateio ?? item.rateio),
    costCenters: names(item.centros_custo ?? item.centros_de_custo),
    dueDate: dueDate.slice(0, 10),
    paymentDate:auditDate(firstString(item,["data_pagamento","data_ultimo_pagamento","data_ultimo_recebimento","data_baixa"])?.slice(0,10)),
    competenceDate: firstString(item, ["data_competencia", "competencia"])?.slice(0, 10) || null,
    status: firstString(item, ["status_traduzido", "status", "situacao"]) || "NÃO INFORMADO",
    total,
    paid,
    outstanding,
  };
}

async function fetchFlow(
  clientId: string,
  flow: ContaAzulAuditEntry["flow"],
  start: string,
  end: string,
  statuses:string[]=[],
  deadline=Date.now()+240000,
) {
  const entries: ContaAzulAuditEntry[] = [];
  const kind = flow === "PAYABLE" ? "contas-a-pagar" : "contas-a-receber";
  const pageSize = 1000;

  const seenPages=new Set<string>();let expectedTotal:number|null=null;
  for (let page = 1; page <= 25; page += 1) {
    const params = new URLSearchParams({
      pagina: String(page),
      tamanho_pagina: String(pageSize),
      data_vencimento_de: start,
      data_vencimento_ate: end,
    });
    statuses.forEach(status=>params.append("status",status));
    if(Date.now()>=deadline)throw new Error("A consulta excedeu o tempo disponível. Reduza o período e tente novamente.");
    const body = await contaAzulRequest<unknown>(
      clientId,
      `/v1/financeiro/${kind}?${params.toString()}`,
      {signal:AbortSignal.timeout(Math.max(1,Math.min(20000,deadline-Date.now())))},
    );
    const items = apiItems(body);
    const signature=JSON.stringify(items);if(seenPages.has(signature))throw new Error("O CA repetiu uma página de lançamentos; a auditoria não foi concluída.");seenPages.add(signature);
    items.forEach((item, index) => {
      const entry = financialEntry(item, flow, `${flow}-${page}-${index}`);
      if (!entry) throw new Error("Um lançamento do CA não informou vencimento válido. A auditoria não foi concluída.");
      entries.push(entry);
    });
    const total=isRecord(body)?body.itens_totais:null;
    if(typeof total!=="number"||!Number.isInteger(total)||total<0||expectedTotal!==null&&expectedTotal!==total)throw new Error("O CA não confirmou uma paginação financeira estável.");
    expectedTotal=total;
    if(entries.length>=total){const unique=[...new Map(entries.map(entry=>[entry.id,entry])).values()];if(unique.length!==total)throw new Error("A consulta retornou parcelas duplicadas ou incompletas.");return unique;}
    if(!items.length)throw new Error("O CA retornou uma página incompleta.");
  }

  throw new Error("O histórico excedeu o limite de consulta; reduza o período para obter uma auditoria completa.");
}

export async function fetchContaAzulAuditPeriod(
  clientId: string,
  start: string,
  end: string,
  deadline=Date.now()+240000,
) {
  // CA accepts date windows up to 365 days; keep refresh-token requests sequential.
  const payable:ContaAzulAuditEntry[]=[],receivable:ContaAzulAuditEntry[]=[];
  for(const [from,to] of dateWindows(start,end)){
    payable.push(...await fetchFlow(clientId,"PAYABLE",from,to,[],deadline));
    receivable.push(...await fetchFlow(clientId,"RECEIVABLE",from,to,[],deadline));
  }
  return {payable,receivable,all:[...payable,...receivable]};
}
function dateWindows(start:string,end:string){
 const windows:Array<[string,string]>=[];let cursor=start;
 while(cursor<=end){const date=new Date(cursor+"T12:00:00Z");date.setUTCDate(date.getUTCDate()+364);const to=date.toISOString().slice(0,10)<end?date.toISOString().slice(0,10):end;windows.push([cursor,to]);const next=new Date(to+"T12:00:00Z");next.setUTCDate(next.getUTCDate()+1);cursor=next.toISOString().slice(0,10);}
 return windows;
}
export async function fetchContaAzulAuditOverdue(clientId:string,start:string,end:string,deadline=Date.now()+240000){
 const entries:ContaAzulAuditEntry[]=[];for(const [from,to] of dateWindows(start,end))entries.push(...await fetchFlow(clientId,"PAYABLE",from,to,["ATRASADO","EM_ABERTO","RECEBIDO_PARCIAL","RENEGOCIADO"],deadline));
 return entries.filter(entry=>entry.outstanding>0.009&&!/CANCELADO|PERDIDO|QUITADO|^PAGO$/.test(entry.status.toUpperCase()));
}

export async function enrichAuditPaymentDates(clientId:string,entries:ContaAzulAuditEntry[],deadline:number){
 let queried=0;
 for(const entry of entries){
  if(entry.flow!=="PAYABLE"||entry.paymentDate||entry.paid<=0||queried>=60||Date.now()>deadline)continue;
  queried++;
  try{const body=await contaAzulRequest<unknown>(clientId,`/v1/financeiro/baixas?id_parcela=${encodeURIComponent(entry.id)}`,{signal:AbortSignal.timeout(Math.max(1,Math.min(15000,deadline-Date.now())))});
   if(!Array.isArray(body)||!body.length)continue;
   const dates=body.map(row=>isRecord(row)?auditDate(typeof row.data_pagamento==="string"?row.data_pagamento.slice(0,10):null):null);
   // Several payment days require document review rather than inventing a single date.
   if(dates.every(Boolean)&&new Set(dates).size===1)entry.paymentDate=dates[0];
  }catch{/* Keep the explicit manual-review fallback when a settlement is unavailable. */}
 }
}
