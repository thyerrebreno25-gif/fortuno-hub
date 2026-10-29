import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({request:vi.fn(),upsert:vi.fn(),update:vi.fn(),claim:vi.fn(),audit:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{documentImportBuyer:{upsert:m.upsert,update:m.update,updateMany:m.claim},auditLog:{create:m.audit}}}));
vi.mock("@/modules/purchase-invoices/server/conta-azul",()=>({contaAzulRequest:m.request,ContaAzulApiError:class extends Error {status=400;}}));
import { buyerPayload, ensureContractBuyer, peoplePage } from "./contract-buyer";
import { parseContract } from "./parsers";
const personId="00000000-0000-4000-8000-000000000001";
const review=()=>({...parseContract([]),buyer:"MHS SOLUCOES AMBIENTAIS LTDA",buyerDocument:"43541033000151",buyerEmail:"comprador@example.test",buyerPhone:"61999998888"});
let state:{id:string;status:string;personId:string|null;lastError?:string|null};
const person=()=>({id:personId,documento:review().buyerDocument,ativo:true,perfis:["CLIENTE","FORNECEDOR"]});
const ensure=()=>ensureContractBuyer("org","company",review(),"user");
const posts=()=>m.request.mock.calls.filter(call=>call[2]?.method==="POST");
beforeEach(()=>{
  vi.clearAllMocks();state={id:"buyer",status:"PENDING",personId:null};
  m.upsert.mockImplementation(async()=>({...state}));
  m.update.mockImplementation(async({data})=>{Object.assign(state,data);return {...state};});
  m.claim.mockImplementation(async({data})=>{Object.assign(state,data);return {count:1};});
  m.request.mockImplementation(async(_client:string,path:string,init?:RequestInit)=>init?.method==="POST"?{id:personId}:path.includes("/pessoas/")?person():{items:[],totalItems:0});
});
describe("Contract buyer registration",()=>{
  it("accepts omitted or null item arrays only with an explicit zero result total",async()=>{
    expect(peoplePage({totalItems:0})).toEqual([]);expect(peoplePage({items:null,totalItems:0})).toEqual([]);
    expect(()=>peoplePage({})).toThrow("busca");expect(()=>peoplePage({items:null,totalItems:1})).toThrow("busca");
    m.request.mockImplementation(async(_client,path,init)=>init?.method==="POST"?{id:personId}:path.includes("/pessoas/")?person():{totalItems:0});
    expect(await ensure()).toBe(personId);expect(posts()).toHaveLength(1);
  });
  it("creates a legal-person customer from reviewed contract data and verifies it before returning",async()=>{
    expect(await ensure()).toBe(personId);expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0][2].body)).toMatchObject({nome:review().buyer,tipo_pessoa:"Jurídica",cnpj:review().buyerDocument,email:"comprador@example.test",telefone_celular:"61999998888",perfis:[{tipo_perfil:"Cliente"}]});
    expect(state).toMatchObject({status:"CREATED",personId});
    expect(m.upsert.mock.calls[0][0].where).toEqual({organizationId_clientId_document:{organizationId:"org",clientId:"company",document:review().buyerDocument}});
    expect(m.request.mock.calls.filter(call=>call[1].includes("?")).every(call=>new URL("https://example.test"+call[1]).searchParams.get("tipos_pessoa")==="Jurídica")).toBe(true);
    expect(m.audit.mock.invocationCallOrder[0]).toBeLessThan(m.request.mock.invocationCallOrder[3]);
  });
  it("reuses the exact CPF/CNPJ instead of duplicating a customer found in more than one profile search",async()=>{
    m.request.mockResolvedValue({items:[person()],totalItems:1});
    expect(await ensure()).toBe(personId);expect(posts()).toHaveLength(0);
  });
  it("refuses inactive, wrong-profile and duplicate records without creating another person",async()=>{
    m.request.mockResolvedValue({items:[{...person(),ativo:false}]});await expect(ensure()).rejects.toThrow("inativo");
    m.request.mockResolvedValue({items:[{...person(),perfis:["FORNECEDOR"]}]});await expect(ensure()).rejects.toThrow("perfil de Cliente");
    m.request.mockResolvedValue({items:[person(),{...person(),id:"00000000-0000-4000-8000-000000000002"}]});await expect(ensure()).rejects.toThrow("mais de um");expect(posts()).toHaveLength(0);
  });
  it("never repeats an uncertain creation, and recovers it by exact document lookup",async()=>{
    m.request.mockImplementation(async(_client,path,init)=>{if(init?.method==="POST")throw Error("timeout");return {items:[]};});
    await expect(ensure()).rejects.toThrow("não foi confirmado");expect(state.status).toBe("UNCERTAIN");
    await expect(ensure()).rejects.toThrow("incerto");expect(posts()).toHaveLength(1);
    m.request.mockResolvedValue({items:[person()]});expect(await ensure()).toBe(personId);expect(posts()).toHaveLength(1);
  });
  it("blocks incomplete searches and invalid API responses before a create",async()=>{
    m.request.mockResolvedValue({});await expect(ensure()).rejects.toThrow("busca");
    m.request.mockResolvedValue({items:[],totalItems:2000});await expect(ensure()).rejects.toThrow("incompleta");expect(posts()).toHaveLength(0);
  });
  it("preserves the returned identity after a failed verification and refuses to recreate it",async()=>{
    m.request.mockImplementation(async(_client,path,init)=>init?.method==="POST"?{id:personId}:path.includes("/pessoas/")?{...person(),documento:"11111111111"}:{items:[]});
    await expect(ensure()).rejects.toThrow("não confere");expect(state).toMatchObject({status:"VERIFYING",personId});
    await expect(ensure()).rejects.toThrow("incerto");expect(posts()).toHaveLength(1);
  });
  it("creates individuals with CPF and omits absent contacts rather than inventing data",()=>{
    const body=buyerPayload({...review(),buyerDocument:"12345678909",buyerEmail:"",buyerPhone:""});
    expect(body).toMatchObject({tipo_pessoa:"Física",cpf:"12345678909"});expect(body).not.toHaveProperty("cnpj");expect(body).not.toHaveProperty("email");expect(body).not.toHaveProperty("telefone_celular");
    expect(()=>buyerPayload({...review(),buyerDocument:"00000000000000"})).toThrow("CPF/CNPJ");
  });
});
