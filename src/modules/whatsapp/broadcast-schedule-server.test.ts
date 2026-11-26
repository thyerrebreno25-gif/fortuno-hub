import {beforeEach,afterEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({account:vi.fn(),raw:vi.fn(),execute:vi.fn(),count:vi.fn(),tickets:vi.fn(),create:vi.fn(),update:vi.fn(),deliveries:vi.fn()}));
vi.mock("./account-scope",()=>({currentWhatsAppAccount:m.account}));
vi.mock("@/lib/prisma",()=>{const tx={$queryRaw:m.raw,$executeRaw:m.execute,serviceTicket:{findMany:m.tickets},whatsAppBatchDelivery:{count:m.count,createMany:m.create,updateMany:m.update,findMany:m.deliveries}};return {prisma:{...tx,$transaction:(fn:(tx:unknown)=>unknown)=>fn(tx)}};});
import {scheduleBroadcast,changeBroadcastSchedule,listBroadcastSchedules,broadcastScheduleDetails} from "./broadcast-schedule-server";
const actor={organizationId:"org",userId:"operator",role:"OPERATOR"},id="5d28aa69-d6a3-48ba-a1dd-384084f33a9a";
const input={id,name:"Todos os clientes",content:"Aviso da equipe",scheduledAt:"2026-11-26T18:00:00.000Z",recipients:Array.from({length:75},(_,i)=>({clientId:"c"+i,ticketId:"t"+i}))};
const job=()=>({...input,body:input.content,organizationId:"org",userId:"operator",accountRecipient:"account",status:"SCHEDULED",scheduledAt:new Date(input.scheduledAt),recipients:input.recipients.map(r=>({...r,address:"wa-contact:"+r.ticketId})),acknowledgedIds:[]});
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-26T15:00Z"));m.account.mockResolvedValue({recipient:"account",where:{organizationId:"org",recipientEmail:"account",source:"WHATSAPP_API"}});m.raw.mockResolvedValue([]);m.count.mockResolvedValue(0);m.execute.mockResolvedValue(1);m.tickets.mockResolvedValue(input.recipients.map(r=>({id:r.ticketId,clientId:r.clientId,senderEmail:"wa-contact:"+r.ticketId,senderName:r.clientId,subject:r.clientId,client:{name:r.clientId}})));m.deliveries.mockResolvedValue([]);});
afterEach(()=>vi.useRealTimers());
it("persists 75 recipients, a frozen message and future time without dispatching anything",async()=>{
 const result=await scheduleBroadcast(actor,input);expect(result.status).toBe("SCHEDULED");expect(m.create.mock.calls[0][0].data).toHaveLength(75);expect(m.create.mock.calls[0][0].data[0]).toMatchObject({organizationId:"org",userId:"operator",batchId:id,body:input.content,accountRecipient:"account"});
 expect(m.tickets.mock.calls[0][0].where).toMatchObject({organizationId:"org",recipientEmail:"account",client:{active:true}});expect(m.tickets.mock.calls[0][0].where).not.toHaveProperty("assignedToId");
 const insert=m.execute.mock.calls.find(c=>c[0].sql?.includes("INSERT INTO"))![0];expect(insert.sql).toContain('"WhatsAppBroadcastSchedule"');expect(insert.values).toContain(input.content);expect(insert.values.some((v:unknown)=>typeof v==="string"&&v.includes('"address"'))).toBe(true);
});
it("returns the same scheduled intent after a lost response, including after its due time",async()=>{
 m.raw.mockResolvedValueOnce([job()]);vi.setSystemTime(new Date("2026-11-26T19:00Z"));expect((await scheduleBroadcast(actor,input)).id).toBe(id);expect(m.create).not.toHaveBeenCalled();
 m.raw.mockResolvedValueOnce([job()]);await expect(scheduleBroadcast(actor,{...input,content:"Changed"})).rejects.toMatchObject({status:409});
});
it("deduplicates identical scheduling intents even if a retry uses a different request ID",async()=>{
 m.raw.mockResolvedValueOnce([]).mockResolvedValueOnce([job()]);expect((await scheduleBroadcast(actor,{...input,id:"another-id"})).id).toBe(id);expect(m.create).not.toHaveBeenCalled();
});
it("rejects past times, unavailable accounts, changed client links and duplicate physical destinations atomically",async()=>{
 await expect(scheduleBroadcast(actor,{...input,scheduledAt:"2026-11-26T14:00Z"})).rejects.toMatchObject({status:400});
 m.account.mockResolvedValueOnce({recipient:null});await expect(scheduleBroadcast(actor,input)).rejects.toMatchObject({status:409});
 m.tickets.mockResolvedValueOnce([]);await expect(scheduleBroadcast(actor,input)).rejects.toMatchObject({status:409});
 const tickets=input.recipients.map(r=>({id:r.ticketId,clientId:r.clientId,senderEmail:"wa-contact:same"}));m.tickets.mockResolvedValueOnce(tickets);await expect(scheduleBroadcast(actor,input)).rejects.toMatchObject({status:409});expect(m.create).not.toHaveBeenCalled();
});
it("cancels only pending recipients while preserving sent and uncertain outcomes",async()=>{
 m.raw.mockResolvedValueOnce([{...job(),status:"RUNNING"}]);expect(await changeBroadcastSchedule(actor,id,"cancel")).toEqual({status:"CANCELLED"});expect(m.update.mock.calls[0][0]).toMatchObject({where:{organizationId:"org",userId:"operator",batchId:id,status:"PENDING"},data:{status:"CANCELLED"}});expect(m.execute.mock.calls[0][0].sql).toContain('"leaseId"=NULL');
});
it("acknowledges uncertain recipients on resume and never makes them pending again",async()=>{
 m.raw.mockResolvedValueOnce([{...job(),status:"PAUSED"}]);m.deliveries.mockResolvedValue([{id:"unknown"},{id:"orphaned-sending"}]);await changeBroadcastSchedule(actor,id,"resume");expect(m.update.mock.calls[0][0]).toMatchObject({where:{status:"SENDING"},data:{status:"UNKNOWN"}});expect(m.execute.mock.calls[0][0].values).toContain('["unknown","orphaned-sending"]');
});
it("scopes list, cancellation and delivery details to this organization and the author or management",async()=>{
 await listBroadcastSchedules(actor);expect(m.raw.mock.calls[0][0].values).toEqual(expect.arrayContaining(["org","operator",false]));
 m.raw.mockResolvedValueOnce([]);await expect(changeBroadcastSchedule(actor,id,"cancel")).rejects.toMatchObject({status:404});expect(m.update).not.toHaveBeenCalled();
 m.raw.mockResolvedValueOnce([]);await expect(broadcastScheduleDetails(actor,id)).rejects.toMatchObject({status:404});expect(m.deliveries).not.toHaveBeenCalled();
});
