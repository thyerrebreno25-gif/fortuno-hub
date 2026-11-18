import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),account:vi.fn(),find:vi.fn(),create:vi.fn(),lock:vi.fn(),transaction:vi.fn(),invalidate:vi.fn()}));
vi.mock("@/modules/atendimento/auth",()=>({getServiceCenterMember:m.member,getWhatsAppPermission:m.permission}));
vi.mock("@/modules/whatsapp/account-scope",()=>({currentWhatsAppAccount:m.account}));
vi.mock("next/cache",()=>({revalidateTag:m.invalidate}));
vi.mock("@/lib/prisma",()=>({prisma:{$transaction:m.transaction}}));
import {POST} from "./route";
const body={accountRecipient:"wa-account:c:5511",requestId:"dcb521a3-cc71-4003-b7e0-0acbf3e675f0"};
const post=(input:unknown=body)=>POST(new Request("https://hub.test/api/whatsapp/monitoring/reset-attention",{method:"POST",body:JSON.stringify(input)}));
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({organizationId:"org",userId:"manager",role:"MASTER"});m.permission.mockResolvedValue({canView:true,canEdit:true});m.account.mockResolvedValue({recipient:body.accountRecipient});m.find.mockResolvedValue(null);m.transaction.mockImplementation(fn=>fn({$executeRaw:m.lock,auditLog:{findFirst:m.find,create:m.create}}));});
it("only permits managers with WhatsApp view and edit access",async()=>{m.member.mockResolvedValueOnce(null);expect((await post()).status).toBe(401);m.member.mockResolvedValueOnce({role:"OPERATOR",organizationId:"org"});expect((await post()).status).toBe(403);m.permission.mockResolvedValueOnce({canView:true,canEdit:false});expect((await post()).status).toBe(403);expect(m.transaction).not.toHaveBeenCalled();});
it("refuses changed accounts and invalid request IDs without writes",async()=>{m.account.mockResolvedValueOnce({recipient:"other"});expect((await post()).status).toBe(409);expect((await post({...body,requestId:"invalid"})).status).toBe(400);expect(m.transaction).not.toHaveBeenCalled();});
it("records an account-scoped reference in one transaction without touching calls, messages or surveys",async()=>{
 const previous=new Date("2026-11-17T00:00:00Z");m.find.mockResolvedValueOnce(null).mockResolvedValueOnce({createdAt:previous});const r=await post();expect(r.status).toBe(200);
 expect(m.lock).toHaveBeenCalledTimes(1);expect(m.find.mock.calls[1][0].where).toMatchObject({entity:"Organization",entityId:"org",action:"WHATSAPP_ATTENTION_RESET",afterData:{path:["accountRecipient"],equals:body.accountRecipient}});
 const audit=m.create.mock.calls[0][0].data;expect(audit).toMatchObject({userId:"manager",entityId:"org",action:"WHATSAPP_ATTENTION_RESET",beforeData:{startedAt:previous.toISOString()},afterData:body});expect((await r.json()).startedAt).toBe(audit.createdAt.toISOString());expect(m.invalidate).toHaveBeenCalledWith(`wa-live-monitor:org:${body.accountRecipient}`,{expire:0});
});
it("retries the same request without moving the reference or creating duplicate resets",async()=>{const createdAt=new Date("2026-11-18T15:00:00Z");m.find.mockResolvedValueOnce({createdAt});expect(await (await post()).json()).toEqual({startedAt:createdAt.toISOString()});expect(m.create).not.toHaveBeenCalled();expect(m.find).toHaveBeenCalledTimes(1);});
