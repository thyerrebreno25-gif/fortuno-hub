import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m=vi.hoisted(()=>({request:vi.fn(),validate:vi.fn(),find:vi.fn(),freeze:vi.fn(),draftUpdate:vi.fn(),deliveryFind:vi.fn(),unique:vi.fn(),create:vi.fn(),update:vi.fn(),lease:vi.fn(),leaseFind:vi.fn(),audit:vi.fn()}));
vi.mock("./server",()=>({simulateReview:m.validate}));
vi.mock("@/modules/purchase-invoices/server/conta-azul",()=>({contaAzulRequest:m.request,ContaAzulApiError:class extends Error {status=400;}}));
vi.mock("@/lib/prisma",()=>{const tx={documentImportReview:{findFirst:m.find,updateMany:m.freeze,update:m.draftUpdate},documentImportDelivery:{findFirst:m.deliveryFind,findUnique:m.unique,create:m.create,update:m.update},documentImportDispatchLease:{upsert:vi.fn(),updateMany:m.lease,findFirst:m.leaseFind},auditLog:{create:m.audit}};return {prisma:{...tx,$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)}};});
import { contractBusinessKey, contractPayload, sendContractReview } from "./contract-delivery";
import { parseContract } from "./parsers";
import type { Prisma } from "@/generated/prisma/client";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const review=()=>({...parseContract([]),buyer:"Comprador",buyerDocument:"43541033000151",sellerDocument:"33822179000111",description:"Site e Branding",originalDate:"2026-10-19",startMonth:"2026-11-01",firstDueDate:"2026-11-15",dueDay:15,installments:8,amountCents:225000,totalCents:1800000,paymentMethod:"BOLETO_BANCARIO" as const,customerId:id(1),serviceId:id(2),categoryId:id(3),accountId:id(4)});
type Delivery=Prisma.DocumentImportDeliveryGetPayload<object>;
let delivery: Delivery|null, version:number, visible:boolean;
const send=()=>sendContractReview({organizationId:"org",userId:"user",reviewId:"review",version});
const posts=()=>m.request.mock.calls.filter(call=>call[2]?.method==="POST");
beforeEach(()=>{
  vi.clearAllMocks();delivery=null;version=1;visible=true;
  m.find.mockImplementation(async({where})=>where.version && where.version!==version ? null : {id:"review",clientId:"company",organizationId:"org",kind:"CONTRACT",data:review(),version});
  m.freeze.mockImplementation(async()=>{version++;return {count:1};});
  m.deliveryFind.mockImplementation(async()=>delivery && {...delivery});m.unique.mockResolvedValue(null);
  m.create.mockImplementation(async({data})=>(delivery={id:"delivery",status:"PENDING",contractId:null,contractNumber:null,saleId:null,...data}));
  m.update.mockImplementation(async({data})=>(delivery={...delivery,...data} as Delivery));
  m.lease.mockResolvedValue({count:1});m.leaseFind.mockResolvedValue({});m.validate.mockResolvedValue({errors:[]});
  m.request.mockImplementation(async(_client:string,path:string,init?:RequestInit)=>{
    if(path.endsWith("proximo-numero"))return 851;
    if(init?.method==="POST")return {id:id(10),id_venda:id(11)};
    if(path.startsWith("/v1/contratos?"))return {items:visible?[{id:id(10),numero:851,cliente:{id:id(1)},data_inicio:"2026-11-01"}]:[],itens_totais:visible?1:0};
    throw Error("Unexpected request");
  });
});
describe("Real recurring contracts",()=>{
  it("sends one unsplit item with first-day generation, fifteenth-day due dates and exact month-end termination",async()=>{
    expect(await send()).toEqual({completed:true});expect(posts()).toHaveLength(1);
    const payload=JSON.parse(posts()[0][2].body);
    expect(payload.termos).toEqual({tipo_frequencia:"MENSAL",tipo_expiracao:"DATA",data_inicio:"2026-11-01",data_fim:"2027-06-30",intervalo_frequencia:1,dia_emissao_venda:1,numero:851});
    expect(payload.condicao_pagamento).toMatchObject({dia_vencimento:15,primeira_data_vencimento:"2026-11-15",id_conta_financeira:id(4)});
    expect(payload.itens).toEqual([{id:id(2),descricao:"Site e Branding",quantidade:1,valor:2250}]);
    expect(delivery).toMatchObject({contractId:id(10),contractNumber:851,saleId:id(11),status:"SENT"});
    expect(m.audit.mock.invocationCallOrder[0]).toBeLessThan(m.request.mock.invocationCallOrder.find(order=>order>m.audit.mock.invocationCallOrder[0])!);
    expect(m.request.mock.calls.every(call=>!call[1].includes("baixa"))).toBe(true);
    expect((await send()).completed).toBe(true);expect(posts()).toHaveLength(1);
  });
  it("does not repeat an uncertain POST, even after refreshing the saved review",async()=>{
    m.request.mockImplementation(async(_client,path,init)=>{if(init?.method==="POST")throw Error("timeout");return 851;});
    await expect(send()).rejects.toThrow("incerta");expect(delivery?.status).toBe("UNCERTAIN_CONTRACT");
    await expect(send()).rejects.toThrow("incerta");expect(posts()).toHaveLength(1);
  });
  it("checks a known created ID again without recreating the contract when listing is delayed",async()=>{
    visible=false;expect(await send()).toEqual({completed:false});expect(delivery?.status).toBe("CONTRACT_CREATED");
    visible=true;expect(await send()).toEqual({completed:true});expect(posts()).toHaveLength(1);
  });
  it("requires a valid returned contract ID",async()=>{
    m.request.mockImplementation(async(_client,path,init)=>init?.method==="POST"?{}:851);
    await expect(send()).rejects.toThrow("identificador");expect(delivery?.status).toBe("UNCERTAIN_CONTRACT");
    await expect(send()).rejects.toThrow("incerta");expect(posts()).toHaveLength(1);
  });
  it("blocks unverified catalog links, concurrent sends, stale versions and duplicates before writes",async()=>{
    m.validate.mockResolvedValueOnce({errors:["Outro comprador"]});await expect(send()).rejects.toThrow("Outro comprador");expect(posts()).toHaveLength(0);
    m.lease.mockResolvedValueOnce({count:0});await expect(send()).rejects.toThrow("andamento");
    m.find.mockResolvedValueOnce({id:"review",clientId:"company"}).mockResolvedValueOnce(null);await expect(send()).rejects.toThrow("alterada");
    m.unique.mockResolvedValueOnce({reviewId:"other"});await expect(send()).rejects.toThrow("outro arquivo");expect(posts()).toHaveLength(0);
  });
  it("blocks mismatching CA confirmation instead of marking it sent",async()=>{
    m.request.mockImplementation(async(_client,path,init)=>path.endsWith("proximo-numero")?851:init?.method==="POST"?{id:id(10)}:{items:[{id:id(10),numero:851,cliente:{id:id(99)},data_inicio:"2026-11-01"}]});
    await expect(send()).rejects.toThrow("diverge");expect(delivery?.status).toBe("CONTRACT_CREATED");
  });
  it("deduplicates the same business contract across changed category selections and rejects malformed links",()=>{
    expect(contractBusinessKey("org","company",review())).toBe(contractBusinessKey("org","company",{...review(),categoryId:id(99)}));
    expect(contractBusinessKey("org","other",review())).not.toBe(contractBusinessKey("org","company",review()));
    expect(()=>contractPayload({...review(),serviceId:""},851,"marker")).toThrow("serviço");
    expect(()=>contractPayload({...review(),totalCents:1},851,"marker")).toThrow("total");
  });
});
