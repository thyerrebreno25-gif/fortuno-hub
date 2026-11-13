import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({find:vi.fn(),update:vi.fn(),create:vi.fn(),history:vi.fn(),message:vi.fn(),member:vi.fn(),permission:vi.fn()}));
vi.mock("@/modules/atendimento/auth",()=>({getWhatsAppPermission:m.permission}));
vi.mock("./server",()=>({resolveWhatsappRouting:async()=>({clientId:"client",assignedToId:"operator",routingSquad:null,reason:"Matched",ambiguous:false})}));
vi.mock("./uazapi-server",()=>({checkConnection:vi.fn()}));
vi.mock("@/lib/prisma",()=>{const tx={organizationMember:{findFirst:m.member},$queryRaw:async()=>[{id:"conn"}],$executeRaw:async()=>1,serviceMessage:{findFirst:async()=>null,create:m.message},serviceTicket:{findFirst:m.find,update:m.update,create:m.create},serviceTicketHistory:{create:m.history}};return {prisma:{serviceMessage:{findFirst:async()=>null},$transaction:(fn:(tx:unknown)=>unknown)=>fn(tx)}};});
import {receiveMessage} from "./uazapi-events";
const now=new Date("2026-11-11T15:00:00Z"),closed={id:"same",status:"RESOLVED",resolvedAt:new Date(now.getTime()-60000),receivedAt:new Date(now.getTime()-3600000),firstResponseAt:new Date(now.getTime()-3000000),lastMessageAt:new Date(now.getTime()-120000),senderName:"Client",assignedToId:"old",clientId:"client"};
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({role:"OPERATOR"});m.permission.mockResolvedValue({canView:true,canEdit:true});m.find.mockResolvedValueOnce(null).mockResolvedValueOnce(closed);m.update.mockResolvedValue({id:"same"});m.create.mockResolvedValue({id:"new"});m.message.mockResolvedValue({id:"message"});});
it("returns a new customer message to the queue using the same finalized conversation",async()=>{
 await receiveMessage({id:"conn",organizationId:"org",instanceId:"instance",phone:"5511"} as never,{kind:"messages",id:"incoming",apiId:"api:incoming",chatId:"5522@s.whatsapp.net",group:false,fromMe:false,wasSentByApi:false,senderName:"Client",chatName:"",sender:"5522",body:"New request",timestamp:now.getTime(),media:null});
 expect(m.create).not.toHaveBeenCalled();expect(m.update.mock.calls[0][0]).toMatchObject({where:{id:"same"},data:{status:"NEW",assignedToId:null,firstResponseAt:null,resolvedAt:null}});expect(m.message.mock.calls[0][0].data.ticketId).toBe("same");expect(m.history.mock.calls[0][0].data.metadata.previousResolvedAt).toBe(closed.resolvedAt.toISOString());
});
it("attaches a delayed old message without reopening a resolved conversation",async()=>{
 await receiveMessage({id:"conn",organizationId:"org",instanceId:"instance",phone:"5511"} as never,{kind:"messages",id:"delayed",apiId:"api:delayed",chatId:"5522@s.whatsapp.net",group:false,fromMe:false,wasSentByApi:false,senderName:"Client",chatName:"",sender:"5522",body:"Delayed",timestamp:closed.resolvedAt.getTime()-10000,media:null});
 expect(m.create).not.toHaveBeenCalled();expect(m.update.mock.calls[0][0].data).not.toHaveProperty("status");expect(m.history).not.toHaveBeenCalled();
});

const receive=(timestamp:number)=>receiveMessage({id:"conn",organizationId:"org",instanceId:"instance",phone:"5511"} as never,{kind:"messages",id:"new",apiId:"api:new",chatId:"5522@s.whatsapp.net",group:false,fromMe:false,wasSentByApi:false,senderName:"Client",chatName:"",sender:"5522",body:"Novo pedido",timestamp,media:null});
it.each([1,600000])("returns to the actual finisher after %s milliseconds, preserving the same conversation",async delta=>{
 const resolvedAt=new Date(now.getTime()-delta);m.find.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce({...closed,resolvedAt,resolvedById:"finisher"});await receive(now.getTime());expect(m.update.mock.calls[0][0].data).toMatchObject({status:"IN_PROGRESS",assignedToId:"finisher",resolvedAt:null});expect(m.member.mock.calls[0][0].where).toMatchObject({organizationId:"org",userId:"finisher",role:{not:"CLIENT"}});expect(m.create).not.toHaveBeenCalled();
});
it("puts a response after ten minutes into the queue even when the old owner is known",async()=>{m.find.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce({...closed,resolvedAt:new Date(now.getTime()-600001),resolvedById:"finisher"});await receive(now.getTime());expect(m.update.mock.calls[0][0].data).toMatchObject({status:"NEW",assignedToId:null});expect(m.member).not.toHaveBeenCalled();});
it.each([null,{role:"OPERATOR"}])("keeps the response in the queue if the finisher is missing or no longer has attendance permission",async membership=>{m.find.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce({...closed,resolvedById:"finisher"});m.member.mockResolvedValue(membership);m.permission.mockResolvedValue({canView:true,canEdit:false});await receive(now.getTime());expect(m.update.mock.calls[0][0].data).toMatchObject({status:"NEW",assignedToId:null});});
it("puts a brand-new chat in the queue even when client routing suggests an owner",async()=>{m.find.mockReset().mockResolvedValue(null);await receive(now.getTime());expect(m.create.mock.calls[0][0].data).toMatchObject({status:"NEW",assignedToId:null,assignedAt:null,clientId:"client"});});
