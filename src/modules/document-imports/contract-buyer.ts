import "server-only";
import { prisma } from "@/lib/prisma";
import { contaAzulRequest, ContaAzulApiError } from "@/modules/purchase-invoices/server/conta-azul";
import { apiItems } from "@/modules/conta-azul/financial-export";
import { digits, normalize, type ContractReview } from "./model";
const object = (v: unknown): Record<string,unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string,unknown> : {};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(v);
const documentOf = (person: Record<string,unknown>) => digits(String(person.documento || person.cnpj || person.cpf || ""));
const isCustomer = (person: Record<string,unknown>) => Array.isArray(person.perfis) && person.perfis.some(p=>normalize(typeof p === "string" ? p : String(object(p).tipo_perfil || "")) === "cliente");
export function buyerPayload(review: ContractReview) {
  const document = digits(review.buyerDocument);
  if (!review.buyer.trim() || ![11,14].includes(document.length) || /^(\d)\1+$/.test(document)) throw new Error("Confira nome e CPF/CNPJ do comprador antes de cadastrar.");
  return { nome: review.buyer.trim(), tipo_pessoa: document.length === 14 ? "Jurídica" : "Física", ativo: true,
    ...(document.length === 14 ? {cnpj:document} : {cpf:document}), perfis:[{tipo_perfil:"Cliente"}],
    ...(review.buyerEmail ? {email:review.buyerEmail} : {}), ...(review.buyerPhone ? {telefone_celular:digits(review.buyerPhone)} : {}),
    observacao: "Comprador cadastrado a partir da revisão de contrato no Fortuno Hub.",
  };
}
// Called only while the contract sender holds the company dispatch lease.
export async function ensureContractBuyer(organizationId: string, clientId: string, review: ContractReview, userId: string) {
  const payload = buyerPayload(review), document=digits(review.buyerDocument);
  const key={organizationId,clientId,document};
  const state = await prisma.documentImportBuyer.upsert({where:{organizationId_clientId_document:key},create:key,update:{}});
  const matches=new Map<string,Record<string,unknown>>();
  // Include other business profiles so a supplier is never duplicated as a new person.
  for (const profile of ["Cliente","Fornecedor","Transportadora"]) {
    const query=new URLSearchParams({pagina:"1",tamanho_pagina:"1000",documentos:document,tipos_pessoa:document.length===14?"Jurídica":"Física",tipo_perfil:profile,com_endereco:"false"});
    const body=await contaAzulRequest(clientId,"/v1/pessoas?"+query);
    if (!Array.isArray(body) && !Array.isArray(object(body).items) && !Array.isArray(object(body).itens)) throw new Error("Não foi possível confirmar a busca do CPF/CNPJ no CA. Nenhum comprador foi cadastrado.");
    const rows=apiItems(body);
    if (rows.length>=1000 || Number(object(body).totalItems)>1000) throw new Error("A busca do CPF/CNPJ ficou incompleta. Confira os cadastros no CA.");
    for(const row of rows) if(documentOf(row)===document && uuid(row.id)) matches.set(row.id,row);
  }
  if(matches.size>1) throw new Error("Há mais de um cadastro para este CPF/CNPJ no CA. Confira antes de enviar o contrato.");
  if(matches.size===1) {
    const [id,person]=[...matches][0];
    if(person.ativo===false || !isCustomer(person)) throw new Error("O CPF/CNPJ já existe no CA, mas está inativo ou sem perfil de Cliente. Ajuste esse cadastro no CA; não será criada outra pessoa.");
    await prisma.documentImportBuyer.update({where:{id:state.id},data:{status:"CREATED",personId:id,lastError:null}});
    return id;
  }
  if(!["PENDING","FAILED"].includes(state.status)) throw new Error("O cadastro do comprador está com resultado incerto ou não foi localizado. Confira no CA; o cadastro não será repetido automaticamente.");
  const claimed=await prisma.documentImportBuyer.updateMany({where:{id:state.id,status:state.status},data:{status:"CREATING",lastError:null}});
  if(!claimed.count) throw new Error("O cadastro deste comprador já está em andamento. Atualize antes de retomar.");
  await prisma.auditLog.create({data:{userId,action:"CONTRACT_BUYER_CREATE_CONFIRMED",entity:"DocumentImportBuyer",entityId:state.id,afterData:{clientId}}});
  let response: Record<string,unknown>;
  try { response=object(await contaAzulRequest(clientId,"/v1/pessoas",{method:"POST",body:JSON.stringify(payload)})); }
  catch(error) {
    const rejected=error instanceof ContaAzulApiError && [400,401,403,404,405,422].includes(error.status);
    await prisma.documentImportBuyer.update({where:{id:state.id},data:{status:rejected?"FAILED":"UNCERTAIN",lastError:rejected?"O CA rejeitou o cadastro do comprador.":"Criação não confirmada. Uma nova tentativa consultará o CPF/CNPJ sem repetir o cadastro incerto."}});
    throw new Error(rejected?"O CA rejeitou o cadastro do comprador. Confira os dados da revisão.":"O cadastro do comprador não foi confirmado. Atualize o envio para consultar o resultado antes de continuar.");
  }
  if(!uuid(response.id)) {
    await prisma.documentImportBuyer.update({where:{id:state.id},data:{status:"UNCERTAIN",lastError:"O CA não retornou um ID válido para o comprador."}});
    throw new Error("O CA não confirmou o identificador do comprador. Confira o cadastro no CA.");
  }
  // Persist the returned identity before verification so an interrupted GET never repeats POST.
  await prisma.documentImportBuyer.update({where:{id:state.id},data:{status:"VERIFYING",personId:response.id}});
  const person=object(await contaAzulRequest(clientId,"/v1/pessoas/"+response.id));
  if(documentOf(person)!==document || person.ativo===false || !isCustomer(person)) throw new Error("O cadastro retornado pelo CA não confere com o comprador revisado. O contrato não foi enviado.");
  await prisma.documentImportBuyer.update({where:{id:state.id},data:{status:"CREATED",personId:response.id,lastError:null}});
  return response.id;
}
