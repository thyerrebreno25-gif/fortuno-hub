import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({unstable_cache:(fn:()=>unknown)=>fn}));
const m=vi.hoisted(()=>({first:vi.fn(),find:vi.fn(),query:vi.fn(),update:vi.fn(),ticket:vi.fn(),request:vi.fn(),enqueue:vi.fn()}));
vi.mock("@/lib/prisma",()=>{const tx={$queryRaw:m.query,serviceMessage:{update:m.update},serviceTicket:{updateMany:m.ticket}};return {prisma:{serviceMessage:{findFirst:m.first,findMany:m.find},$transaction:(fn:(tx:unknown)=>unknown)=>fn(tx),whatsAppWebhookInbox:{upsert:m.enqueue}}};});
vi.mock("./server",()=>({resolveWhatsappRouting:vi.fn()}));
vi.mock("./uazapi-server",()=>({checkConnection:vi.fn()}));
vi.mock("@/modules/purchase-invoices/server/crypto",()=>({decryptIntegrationSecret:()=>"secret"}));
vi.mock("./uazapi",async original=>({...await original<typeof import("./uazapi")>(),uazapiRequest:m.request}));
import {receiveMessage,repairCallPlaceholders,enqueueUazapiEvent} from "./uazapi-events";
const connection={id:"conn",organizationId:"org",instanceId:"inst",phone:"5511",serverUrl:"https://fortunohub.uazapi.com",tokenEncrypted:"encrypted"} as never;
const timestamp=Date.parse("2026-11-11T13:20:00Z"),call={id:"call-id",media:"voice" as const,status:"missed" as const,timestamp,final:true};
beforeEach(()=>{vi.clearAllMocks();m.first.mockResolvedValue({id:"same",ticketId:"ticket",providerMetadata:{accountPhone:"5511"}});m.query.mockResolvedValue([{id:"same",ticketId:"ticket",receivedAt:new Date(timestamp),providerMetadata:{accountPhone:"5511",apiMessageId:"owner:log"}}]);});
it("repairs an existing empty call in place and scopes the locked row to tenant and physical phone",async()=>{
 await receiveMessage(connection,{kind:"messages",id:"log",apiId:"owner:log",chatId:"123@lid",group:false,fromMe:true,wasSentByApi:false,senderName:"",chatName:"",sender:"",body:"Chamada",timestamp,media:null,call});
 expect(m.update.mock.calls[0][0]).toMatchObject({where:{id:"same"},data:{textBody:expect.stringContaining("realizada · não atendida"),providerMetadata:{accountPhone:"5511",call:{id:"call-id",status:"missed"}}}});
 const sql=m.query.mock.calls[0][0];expect(sql.sql).toContain("FOR UPDATE OF m");expect(sql.values).toContain("org");expect(sql.values).toContain("wa-account:conn:5511");
 expect(m.ticket.mock.calls[0][0]).toMatchObject({where:{id:"ticket",lastMessageAt:new Date(timestamp)},data:{snippet:expect.stringContaining("Chamada")}});
});
it("looks up only exact provider ids before replacing old placeholders; does not label arbitrary blank messages as calls",async()=>{
 m.find.mockResolvedValue([{id:"same",direction:"INBOUND",providerMetadata:{accountPhone:"5511",apiMessageId:"owner:log",messageId:"log"}}]);
 m.request.mockResolvedValueOnce({messages:[{id:"owner:log",messageid:"log",chatid:"123@lid",messageType:"call",messageTimestamp:timestamp,content:{callResult:4}}]});
 await repairCallPlaceholders(connection,"ticket");expect(m.request.mock.calls[0][3]).toEqual({id:"owner:log"});expect(m.update.mock.calls[0][0].data.textBody).toBe("Chamada de voz perdida em 11/11/2026 10:20");
 m.update.mockClear();m.request.mockResolvedValueOnce({messages:[{id:"owner:log",messageid:"log",chatid:"123@lid",messageType:"Conversation",text:""}]});await repairCallPlaceholders(connection,"ticket");expect(m.update).not.toHaveBeenCalled();
});
it("queues call transitions separately while identical redeliveries keep the same id",async()=>{
 const event={kind:"call" as const,id:"call-id",chatId:"123@lid",fromMe:false,senderName:"",call};await enqueueUazapiEvent(connection,event);await enqueueUazapiEvent(connection,event);await enqueueUazapiEvent(connection,{...event,call:{...call,status:"offered" as const,final:false}});
 expect(m.enqueue.mock.calls[0][0].where.id).toBe(m.enqueue.mock.calls[1][0].where.id);expect(m.enqueue.mock.calls[0][0].where.id).not.toBe(m.enqueue.mock.calls[2][0].where.id);
});
