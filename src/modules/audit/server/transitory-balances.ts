import "server-only";
import {contaAzulRequest} from "@/modules/purchase-invoices/server/conta-azul";
import {closingAccountBalance} from "@/modules/document-imports/account-balance";
import {isTransitoryAccount,type AuditAccountBalance} from "../transitory-accounts";
export async function auditTransitoryBalances(clientId:string,date:string,deadline=Date.now()+180000){
 const accounts:Array<{id:string;name:string;type:string}>=[],seen=new Set<string>();let complete=false,expectedTotal:number|null=null,received=0;
 for(let page=1;page<=20&&Date.now()<deadline;page++){
  const body=await contaAzulRequest<unknown>(clientId,`/v1/financeiro/contas-financeiras?pagina=${page}&tamanho_pagina=100`,{signal:AbortSignal.timeout(Math.max(1,Math.min(15000,deadline-Date.now())))});
  const root=body&&typeof body==="object"&&!Array.isArray(body)?body as Record<string,unknown>:{};
  const rows=Array.isArray(body)?body:Array.isArray(root.itens)?root.itens:Array.isArray(root.items)?root.items:null;
  if(!rows)throw new Error("Não foi possível confirmar as contas transitórias no CA.");
  const signature=JSON.stringify(rows);if(seen.has(signature))throw new Error("A consulta de contas repetiu uma página.");seen.add(signature);
  for(const value of rows){const row=value as Record<string,unknown>;if(typeof row.id!=="string"||typeof row.nome!=="string")throw new Error("Uma conta financeira não informou identificação válida.");const type=String(row.tipo||row.tipo_conta||"");if(isTransitoryAccount(row.nome,type)&&!accounts.some(a=>a.id===row.id))accounts.push({id:row.id,name:row.nome,type});}
  received+=rows.length;
  if(!Array.isArray(body)){const total=root.itens_totais;if(typeof total!=="number"||!Number.isInteger(total)||total<0||expectedTotal!==null&&total!==expectedTotal)throw new Error("A API não confirmou a lista completa de contas.");expectedTotal=total;}
  if(expectedTotal!==null?received>=expectedTotal:rows.length<100){complete=true;break;}
  if(!rows.length)throw new Error("A lista de contas está incompleta.");
 }
 if(!complete)throw new Error("A lista de contas está incompleta; confira as contas transitórias manualmente.");
 const balances:AuditAccountBalance[]=[];
 for(const account of accounts){const result=date===new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())?{balanceCents:null,method:"UNAVAILABLE",reason:"O dia ainda não encerrou; o saldo atual não é um saldo de fechamento."}:await closingAccountBalance(clientId,account.id,date,new Date(),deadline,auditBalanceRequest);balances.push({...account,...result,date});}
 return balances;
}

// Adapt only audit reads to the current public API; other import flows keep their contract.
export const auditBalanceRequest:typeof contaAzulRequest=async <T>(clientId:string,path:string,init?:Parameters<typeof contaAzulRequest>[2]):Promise<T>=>{
 const url=new URL(path,"https://api-v2.contaazul.com");
 const parcel=url.pathname.match(/^\/v1\/financeiro\/eventos-financeiros\/parcelas\/([^/]+)\/baixa$/);
 if(parcel){url.pathname="/v1/financeiro/baixas";url.searchParams.set("id_parcela",decodeURIComponent(parcel[1]));}
 else if(url.pathname.includes("/eventos-financeiros/contas-a-")){
  url.pathname=url.pathname.replace("/eventos-financeiros","").replace(/\/buscar$/,"");
  const start=url.searchParams.get("data_pagamento_de")!,end=url.searchParams.get("data_pagamento_ate")!;
  if(!start||!end||new Date(end).getTime()-new Date(start).getTime()>364*86400000)throw new Error("Período de reconstrução excede o limite da API.");
  url.searchParams.delete("data_vencimento_de");url.searchParams.delete("data_vencimento_ate");
  url.searchParams.set("data_alteracao_de",start+"T00:00:00");url.searchParams.set("data_alteracao_ate",end+"T23:59:59");
 }else if(url.pathname.startsWith("/v1/conta-financeira/"))url.pathname=url.pathname.replace("/v1/conta-financeira/","/v1/financeiro/contas-financeiras/");
 else if(url.pathname==="/v1/financeiro/eventos-financeiros/saldo-inicial")url.pathname="/v1/financeiro/contas-financeiras/saldo-inicial";
 return contaAzulRequest<T>(clientId,url.pathname+url.search,{...init,signal:AbortSignal.timeout(15000)});
};
