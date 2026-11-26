import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({delivery:vi.fn(),claim:vi.fn(),update:vi.fn(),account:vi.fn(),ticket:vi.fn(),send:vi.fn(),message:vi.fn(),history:vi.fn(),ticketUpdate:vi.fn(),batchUpdate:vi.fn(),transaction:vi.fn(),previous:vi.fn(),guard:vi.fn(),lock:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{whatsAppBatchDelivery:{findFirst:m.delivery,updateMany:m.claim},$transaction:m.transaction}}));
vi.mock("./account-scope",()=>({currentWhatsAppAccount:m.account}));
vi.mock("./server",()=>({getWhatsappTicket:m.ticket,resolveWhatsappTicketId:async(id:string)=>id}));
vi.mock("./uazapi-server",()=>({whatsappConnection:async()=>({id:"c",instanceId:"i",phone:"5511"}),sendUazapiText:m.send}));
vi.mock("./outgoing-context",()=>({outgoingContext:()=>({to:"group@g.us",instanceId:"i"})}));
vi.mock("./broadcast-schedule-guard",()=>({guardScheduledDelivery:m.guard}));
import {deliverBatchMessage} from "./batch-send";
const actor={organizationId:"org",userId:"me",user:{name:"Operadora",email:"me@test"}};
const transaction=()=>({$executeRaw:m.lock,$queryRaw:m.previous,serviceTicket:{update:m.ticketUpdate},serviceMessage:{upsert:m.message},serviceTicketHistory:{create:m.history},whatsAppBatchDelivery:{update:m.batchUpdate,updateMany:m.claim}});
beforeEach(()=>{vi.clearAllMocks();m.guard.mockResolvedValue(null);m.delivery.mockResolvedValue({id:"d",ticketId:"t",accountRecipient:"wa-account:c:5511",body:"Bom dia!",batchId:"b",status:"PENDING"});m.account.mockResolvedValue({recipient:"wa-account:c:5511"});m.ticket.mockResolvedValue({id:"t",clientId:"client",status:"IN_PROGRESS",assignedToId:"me",senderEmail:"wa-group:group@g.us",recipientEmail:"wa-account:c:5511",messages:[]});m.claim.mockResolvedValue({count:1});m.send.mockResolvedValue({messageId:"uazapi:5511:m",instanceId:"i",connectionId:"c",accountPhone:"5511"});m.previous.mockResolvedValue([]);m.transaction.mockImplementation(async fn=>fn(transaction()));});
it("checks organization, author and the current physical account before dispatch",async()=>{m.account.mockResolvedValue({recipient:"wa-account:c:other"});expect((await deliverBatchMessage("d",actor)).status).toBe(409);expect(m.delivery).toHaveBeenCalledWith({where:{id:"d",organizationId:"org",userId:"me"}});expect(m.send).not.toHaveBeenCalled();});
it("never resends a delivery that is already sent, sending or uncertain",async()=>{for(const status of ["SENT","SENDING","UNKNOWN"]){m.delivery.mockResolvedValue({id:"d",accountRecipient:"wa-account:c:5511",status});expect((await(await deliverBatchMessage("d",actor)).json()).status).toBe(status);}expect(m.send).not.toHaveBeenCalled();expect(m.claim).not.toHaveBeenCalled();});
it("sends to another operator's call without transferring or changing its workflow",async()=>{m.ticket.mockResolvedValue({id:"t",clientId:"client",status:"WAITING_CUSTOMER",assignedToId:"other",senderEmail:"wa-group:group@g.us",recipientEmail:"wa-account:c:5511",messages:[]});expect((await(await deliverBatchMessage("d",actor)).json()).status).toBe("SENT");expect(m.send).toHaveBeenCalledOnce();expect(m.ticketUpdate.mock.calls[0][0].data).toEqual({lastMessageAt:expect.any(Date),snippet:"Bom dia!"});expect(m.history.mock.calls[0][0].data).toMatchObject({userId:"me",type:"WHATSAPP_REPLIED"});});
it("sends to a queued call without assuming it or ending its queue SLA",async()=>{m.ticket.mockResolvedValue({id:"t",clientId:"client",status:"NEW",assignedToId:null,assignedAt:null,firstResponseAt:null,senderEmail:"wa-contact:5522",recipientEmail:"wa-account:c:5511",messages:[]});expect((await(await deliverBatchMessage("d",actor)).json()).status).toBe("SENT");expect(m.send).toHaveBeenCalledOnce();expect(m.ticketUpdate.mock.calls[0][0].data).toEqual({lastMessageAt:expect.any(Date),snippet:"Bom dia!"});});
it("sends only once after an atomic claim and records the signed outgoing message",async()=>{expect((await(await deliverBatchMessage("d",actor)).json()).status).toBe("SENT");expect(m.send).toHaveBeenCalledTimes(1);expect(m.send.mock.calls[0][0].body).toBe("*Fortuno | Equipe de Suporte*\nBom dia!");expect(m.claim.mock.calls[0][0]).toMatchObject({where:{status:"PENDING",userId:"me",organizationId:"org"},data:{status:"SENDING"}});expect(m.message.mock.calls[0][0].create).toMatchObject({direction:"OUTBOUND",textBody:"Bom dia!",providerMetadata:{accountPhone:"5511",batchId:"b"}});expect(m.batchUpdate.mock.calls[0][0].data.status).toBe("SENT");});
it("a losing concurrent request cannot dispatch another copy",async()=>{m.claim.mockResolvedValue({count:0});expect((await(await deliverBatchMessage("d",actor)).json()).status).toBe("SENDING");expect(m.send).not.toHaveBeenCalled();});
it("marks a provider timeout as uncertain instead of retryable",async()=>{m.send.mockRejectedValue(new Error("timeout"));expect((await(await deliverBatchMessage("d",actor)).json()).status).toBe("UNKNOWN");expect(m.claim.mock.calls.at(-1)?.[0]).toMatchObject({data:{status:"UNKNOWN"}});expect(m.send).toHaveBeenCalledTimes(1);});
it("retains the accepted provider ID if local persistence fails",async()=>{m.transaction.mockImplementationOnce(async fn=>fn(transaction())).mockRejectedValueOnce(new Error("database unavailable"));expect((await(await deliverBatchMessage("d",actor)).json()).status).toBe("UNKNOWN");expect(m.claim.mock.calls.at(-1)?.[0].data.externalMessageId).toBe("uazapi:5511:m");});

it.each([{status:"SPAM"},{isSpam:true},{recipientEmail:"wa-account:c:other"}])("cancels unavailable recipients before claiming or sending: %j",async change=>{
 m.ticket.mockResolvedValue({id:"t",clientId:"client",status:"IN_PROGRESS",assignedToId:"other",senderEmail:"wa-contact:5522",recipientEmail:"wa-account:c:5511",messages:[],...change});expect((await(await deliverBatchMessage("d",actor)).json()).status).toBe("CANCELLED");expect(m.send).not.toHaveBeenCalled();expect(m.ticketUpdate).not.toHaveBeenCalled();
});
it("allows the current assignee to change after preparation while still preserving the current assignment",async()=>{
 m.ticket.mockResolvedValue({id:"t",clientId:"client",status:"IN_PROGRESS",assignedToId:"new-owner",senderEmail:"wa-contact:5522",recipientEmail:"wa-account:c:5511",messages:[]});expect((await(await deliverBatchMessage("d",actor)).json()).status).toBe("SENT");expect(m.ticketUpdate.mock.calls[0][0].data).not.toHaveProperty('assignedToId');expect(m.ticketUpdate.mock.calls[0][0].data).not.toHaveProperty('assignedAt');
});

it.each(['other',null])('sends to a finalized conversation without reopening it or changing its owner: %s',async assignedToId=>{
 const resolvedAt=new Date('2026-11-18T18:00:00Z');
 const ticket={id:'t',clientId:'client',status:'RESOLVED',assignedToId,resolvedAt,senderEmail:'wa-contact:5522',recipientEmail:'wa-account:c:5511',messages:[]};m.ticket.mockResolvedValue(ticket);
 expect((await(await deliverBatchMessage('d',actor)).json()).status).toBe('SENT');expect(m.send).toHaveBeenCalledOnce();
 const data=m.ticketUpdate.mock.calls[0][0].data;expect(data).toEqual({lastMessageAt:expect.any(Date),snippet:'Bom dia!'});for(const key of ['status','resolvedAt','resolvedById','assignedToId','assignedAt','firstResponseAt','receivedAt'])expect(data).not.toHaveProperty(key);
 expect(m.message.mock.calls[0][0].create).toMatchObject({ticketId:'t',direction:'OUTBOUND',textBody:'Bom dia!'});expect(ticket).toMatchObject({status:'RESOLVED',assignedToId,resolvedAt});
});

it('cancels a duplicate client in an older lot before the provider can send twice',async()=>{
 m.previous.mockResolvedValue([{id:'other-delivery'}]);expect((await(await deliverBatchMessage('d',actor)).json()).status).toBe('CANCELLED');expect(m.send).not.toHaveBeenCalled();expect(m.claim.mock.calls.at(-1)?.[0].data.status).toBe('CANCELLED');expect(m.lock.mock.calls[0][1]).toBe('batch-client:org:me:b:client');const query=m.previous.mock.calls[0][0];expect(query.values).toContain('client');expect(query.sql).toContain("d.status IN ('SENDING','SENT','UNKNOWN')");
});

it('uses the Fortuno signature externally while retaining the original user in internal metadata',async()=>{
 await deliverBatchMessage('d',actor);expect(m.send.mock.calls[0][0].body).toBe('*Fortuno | Equipe de Suporte*\nBom dia!');expect(m.send.mock.calls[0][0].body).not.toContain('Operadora');
 expect(m.message.mock.calls[0][0].create).toMatchObject({fromName:'Fortuno | Equipe de Suporte',fromEmail:'me@test',providerMetadata:{userId:'me',broadcast:true}});
});
it('cannot manually bypass the scheduled time or a cancellation guard',async()=>{
 m.guard.mockResolvedValueOnce({blocked:'Agendamento'});expect((await deliverBatchMessage('d',actor)).status).toBe(409);expect(m.send).not.toHaveBeenCalled();expect(m.claim).not.toHaveBeenCalled();
});
