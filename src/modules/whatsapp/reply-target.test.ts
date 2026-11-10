import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({find:vi.fn(),account:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{serviceMessage:{findFirst:m.find}}}));
vi.mock("./account-scope",async original=>({...await original<typeof import("./account-scope")>(),currentWhatsAppAccount:m.account}));
import {findReplyTarget} from "./reply-target";
const current={id:"active",organizationId:"org",senderEmail:"wa-group:123@g.us",recipientEmail:"wa-account:c:5511",createdAt:new Date("2026-11-10T12:00:00Z")};
beforeEach(()=>{vi.clearAllMocks();m.account.mockResolvedValue({recipient:current.recipientEmail,connection:{phone:"5511"},where:{organizationId:"org",source:"WHATSAPP_API",recipientEmail:current.recipientEmail}});m.find.mockResolvedValue({id:"old",ticketId:"closed",fromName:"Cliente",textBody:"Mensagem de ontem",receivedAt:new Date("2026-11-09T12:00:00Z"),externalMessageId:"uazapi:5511:raw-old",providerMetadata:{messageId:"raw-old",token:"never-return"},attachments:[]});});
it("resolves the actual provider id and returns a safe public quote for an older call",async()=>{
 const target=await findReplyTarget(current,"old");expect(target.providerId).toBe("raw-old");expect(target.quote).toMatchObject({id:"old",sourceTicketId:"closed",textBody:"Mensagem de ontem"});expect(JSON.stringify(target.quote)).not.toContain("never-return");
 const where=m.find.mock.calls[0][0].where;expect(where.direction).toEqual({not:"INTERNAL"});expect(where.ticket).toMatchObject({organizationId:"org",source:"WHATSAPP_API",senderEmail:current.senderEmail,recipientEmail:current.recipientEmail,isSpam:false,mergedIntoId:null,OR:[{id:"active"},{status:"RESOLVED",createdAt:{lte:current.createdAt}}]});
});
it("rejects another physical account before looking up its messages",async()=>{await expect(findReplyTarget({...current,recipientEmail:"old-number"},"old")).rejects.toMatchObject({status:404});expect(m.find).not.toHaveBeenCalled();});
it("rejects nonexistent or out-of-conversation ids and never trusts a client-supplied quote body",async()=>{m.find.mockResolvedValueOnce(null);await expect(findReplyTarget(current,"foreign")).rejects.toMatchObject({status:404});await expect(findReplyTarget(current,{id:"old",textBody:"injected"})).rejects.toMatchObject({status:400});});
