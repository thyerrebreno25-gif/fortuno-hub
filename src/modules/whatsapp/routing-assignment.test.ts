import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({clients:vi.fn(),identities:vi.fn(),member:vi.fn(),permission:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{client:{findMany:m.clients},clientWhatsAppIdentity:{findMany:m.identities},organizationMember:{findFirst:m.member}}}));
vi.mock("@/modules/atendimento/auth",()=>({getWhatsAppPermission:m.permission}));
import { resolveWhatsappRouting } from "./server";
const client={id:"client",name:"GREGORIO E MAGALHAES ADVOCACIA",document:null,serviceAliases:"Gregorio",serviceSquad:"SQUAD_1",generalResponsibleId:"general",operationLeaderId:"leader",payableResponsibleId:"payable",receivableResponsibleId:"receivable"};
beforeEach(()=>{vi.clearAllMocks();m.identities.mockResolvedValue([]);m.clients.mockResolvedValue([client]);m.member.mockResolvedValue({role:"OPERATOR"});m.permission.mockResolvedValue({canView:true,canEdit:true});});
const input={organizationId:"org",kind:"GROUP" as const,identifier:"123@g.us",displayName:"BPO Fortuno | Gregório"};
it.each([["ACCOUNTS_PAYABLE","payable"],["ACCOUNTS_RECEIVABLE","receivable"],["GENERAL","general"]] as const)("assigns %s to the matching client's configured owner",async(area,owner)=>{
 const routing=await resolveWhatsappRouting({...input,routingArea:area});expect(routing).toMatchObject({clientId:"client",assignedToId:owner});expect(m.member).toHaveBeenCalledWith({where:{organizationId:"org",userId:owner,role:{not:"CLIENT"}},select:{role:true}});
});
it("does not substitute the general owner when the financial area has no responsible person",async()=>{m.clients.mockResolvedValue([{...client,payableResponsibleId:null}]);expect((await resolveWhatsappRouting({...input,routingArea:"ACCOUNTS_PAYABLE"})).assignedToId).toBeNull();});
it("keeps ambiguous messages and ambiguous group names in triage",async()=>{
 expect((await resolveWhatsappRouting({...input,routingArea:"UNKNOWN"})).assignedToId).toBeNull();m.clients.mockResolvedValue([client,{...client,id:"other"}]);expect(await resolveWhatsappRouting({...input,routingArea:"ACCOUNTS_PAYABLE"})).toMatchObject({clientId:null,assignedToId:null,ambiguous:true});
});
it("does not assign a former employee or a profile without WhatsApp attendance access",async()=>{
 m.member.mockResolvedValueOnce(null);expect((await resolveWhatsappRouting({...input,routingArea:"ACCOUNTS_PAYABLE"})).assignedToId).toBeNull();m.permission.mockResolvedValue({canView:true,canEdit:false});expect((await resolveWhatsappRouting({...input,routingArea:"ACCOUNTS_RECEIVABLE"})).assignedToId).toBeNull();
});
