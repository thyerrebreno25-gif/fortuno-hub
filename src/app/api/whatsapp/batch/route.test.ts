import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),account:vi.fn(),tickets:vi.fn(),clients:vi.fn(),count:vi.fn(),create:vi.fn(),deliver:vi.fn(),existing:vi.fn(),lock:vi.fn(),scheduled:vi.fn(),transaction:vi.fn()}));
vi.mock("@/modules/atendimento/auth",()=>({getServiceCenterMember:m.member,getWhatsAppPermission:m.permission,SERVICE_CENTER_MANAGER_ROLES:new Set(['MASTER','ADMIN','MANAGER'])}));
vi.mock("@/modules/whatsapp/account-scope",()=>({currentWhatsAppAccount:m.account}));
vi.mock("@/modules/whatsapp/batch-send",()=>({deliverBatchMessage:m.deliver}));
vi.mock("@/lib/prisma",()=>({prisma:{serviceTicket:{findMany:m.tickets},client:{findMany:m.clients,count:m.count},$transaction:m.transaction}}));
vi.mock("@/modules/whatsapp/broadcast-schedule-guard",()=>({scheduledBatchExists:m.scheduled}));
import {GET,POST} from "./route";
const batchId="2c2f6ab6-e537-4b9e-9038-7415f492381b";
const post=(body:unknown)=>POST(new Request('https://hub.test/api/whatsapp/batch',{method:'POST',body:JSON.stringify(body)}));
const prepare=(ticketIds=['t'])=>post({action:'prepare',batchId,content:'Olá!',ticketIds});
beforeEach(()=>{vi.clearAllMocks();m.scheduled.mockResolvedValue(false);m.member.mockResolvedValue({organizationId:'org',userId:'me',role:'OPERATOR'});m.permission.mockResolvedValue({canView:true,canEdit:true,canManage:false});m.account.mockResolvedValue({recipient:'wa-account:c:5511',where:{organizationId:'org',source:'WHATSAPP_API',recipientEmail:'wa-account:c:5511'}});m.tickets.mockResolvedValue([{id:'t',senderName:'Contato',subject:'Contato',senderEmail:'wa-contact:551111111111',clientId:'client',client:{name:'Cliente'}}]);m.existing.mockResolvedValue([]);m.count.mockResolvedValue(1);m.clients.mockResolvedValue([{id:'client',name:'Cliente',serviceTickets:[{id:'t',subject:'Contato',senderName:'Contato',senderEmail:'wa-contact:551111111111',status:'RESOLVED',lastMessageAt:new Date(),assignedTo:null}]}]);m.transaction.mockImplementation(async fn=>fn({$executeRaw:m.lock,whatsAppBatchDelivery:{findMany:m.existing,createMany:m.create}}));});
it('requires staff membership and edit access before preparing or dispatching',async()=>{m.member.mockResolvedValueOnce(null);expect((await prepare()).status).toBe(403);m.member.mockResolvedValueOnce({role:'CLIENT'});expect((await prepare()).status).toBe(403);m.permission.mockResolvedValueOnce({canView:true,canEdit:false});expect((await prepare()).status).toBe(403);expect(m.tickets).not.toHaveBeenCalled();expect(m.deliver).not.toHaveBeenCalled();});
it('rejects duplicate, empty and oversized recipient lists before any database write',async()=>{for(const ids of [[],['t','t'],Array.from({length:1001},(_,i)=>'t'+i)])expect((await prepare(ids)).status).toBe(400);expect(m.create).not.toHaveBeenCalled();expect(m.tickets).not.toHaveBeenCalled();});
it('prepares atomically only when every requested conversation belongs to the current account and is eligible',async()=>{expect((await prepare(['t','foreign'])).status).toBe(409);expect(m.create).not.toHaveBeenCalled();expect(m.tickets.mock.calls[0][0].where).toMatchObject({organizationId:'org',recipientEmail:'wa-account:c:5511',mergedIntoId:null,isSpam:false,status:{not:'SPAM'}});expect(m.tickets.mock.calls[0][0].where).not.toHaveProperty('assignedToId');});
it('does not prepare more than one outbound message for the same contact',async()=>{m.tickets.mockResolvedValue([{id:'a',senderEmail:'wa-contact:5511',clientId:'c1'},{id:'b',senderEmail:'wa-contact:5511',clientId:'c2'}]);expect((await prepare(['a','b'])).status).toBe(400);expect(m.create).not.toHaveBeenCalled();});
it('preparation persists pending messages without calling the provider',async()=>{expect((await prepare()).status).toBe(200);expect(m.create.mock.calls[0][0].data).toMatchObject([{organizationId:'org',userId:'me',ticketId:'t',body:'Olá!',accountRecipient:'wa-account:c:5511'}]);expect(m.deliver).not.toHaveBeenCalled();});
it('repeated preparation of the same batch never adds another set of deliveries',async()=>{m.existing.mockResolvedValue([{id:'d',status:'SENT',ticketId:'t',body:'Olá!',accountRecipient:'wa-account:c:5511'}]);expect((await prepare()).status).toBe(200);expect(m.create).not.toHaveBeenCalled();});
it('does not dispatch a previous batch with a newly edited message after a lost preparation response',async()=>{m.existing.mockResolvedValue([{id:'d',status:'PENDING',ticketId:'t',body:'Texto anterior',accountRecipient:'wa-account:c:5511'}]);expect((await prepare()).status).toBe(409);expect(m.create).not.toHaveBeenCalled();expect(m.deliver).not.toHaveBeenCalled();});
it('allows managers and operators to prepare calls regardless of their current assignee',async()=>{for(const role of ['MASTER','MANAGER','OPERATOR']){m.member.mockResolvedValueOnce({organizationId:'org',userId:'me',role});expect((await prepare()).status).toBe(200);expect(m.tickets.mock.calls.at(-1)?.[0].where).not.toHaveProperty('assignedToId');expect(m.tickets.mock.calls.at(-1)?.[0].where.OR).toBeUndefined();}});

it('paginates and counts clients once, keeping all linked destinations and including finalized calls',async()=>{
 const response=await GET(new Request('https://hub.test/api/whatsapp/batch?search=cliente&page=2'));expect(response.status).toBe(200);
 const query=m.clients.mock.calls[0][0];expect(query.where).toMatchObject({organizationId:'org',active:true,serviceTickets:{some:{source:'WHATSAPP_API',recipientEmail:'wa-account:c:5511',mergedIntoId:null,isSpam:false,status:{not:'SPAM'}}}});expect(query).toMatchObject({skip:50,take:50,orderBy:[{name:'asc'},{id:'asc'}]});expect(query.select.serviceTickets.where).not.toHaveProperty('assignedToId');expect(m.count).toHaveBeenCalledWith({where:query.where});
 expect((await response.json()).items[0]).toMatchObject({id:'client',name:'Cliente',destinations:[{id:'t',status:'RESOLVED'}]});
});
it('keeps read-only profiles and clients out of both recipient selection and sending',async()=>{
 m.permission.mockResolvedValueOnce({canView:true,canEdit:false});expect((await GET(new Request('https://hub.test/api/whatsapp/batch'))).status).toBe(403);
 m.member.mockResolvedValueOnce({role:'CLIENT'});expect((await GET(new Request('https://hub.test/api/whatsapp/batch'))).status).toBe(403);expect(m.tickets).not.toHaveBeenCalled();
});

it('prepares open and finalized conversations in one batch without changing their state',async()=>{
 m.tickets.mockResolvedValue([{id:'open',senderName:'Grupo aberto',senderEmail:'wa-group:1@g.us',status:'IN_PROGRESS',clientId:'c1',client:{name:'Cliente 1'}},{id:'closed',senderName:'Grupo finalizado',senderEmail:'wa-group:2@g.us',status:'RESOLVED',clientId:'c2',client:{name:'Cliente 2'}}]);
 expect((await prepare(['open','closed'])).status).toBe(200);expect(m.create.mock.calls[0][0].data.map((row:{ticketId:string})=>row.ticketId)).toEqual(['open','closed']);expect(m.tickets.mock.calls[0][0].where.status).toEqual({not:'SPAM'});expect(m.deliver).not.toHaveBeenCalled();
});

it('rejects two different groups of one client even from older browser tabs',async()=>{
 m.tickets.mockResolvedValue([{id:'a',clientId:'client',senderEmail:'wa-group:1@g.us'},{id:'b',clientId:'client',senderEmail:'wa-group:2@g.us'}]);expect((await prepare(['a','b'])).status).toBe(400);expect(m.create).not.toHaveBeenCalled();
});
it('checks that the chosen destination is still linked to the reviewed client',async()=>{
 expect((await post({action:'prepare',batchId,content:'Olá!',recipients:[{clientId:'another',ticketId:'t'}]})).status).toBe(409);expect(m.create).not.toHaveBeenCalled();
 expect((await post({action:'prepare',batchId,content:'Olá!',recipients:[{clientId:'client',ticketId:'t'}]})).status).toBe(200);
});
it('rejects duplicate clients before querying tickets and excludes unlinked conversations',async()=>{
 expect((await post({action:'prepare',batchId,content:'Olá!',recipients:[{clientId:'client',ticketId:'a'},{clientId:'client',ticketId:'b'}]})).status).toBe(400);expect(m.tickets).not.toHaveBeenCalled();m.tickets.mockResolvedValue([{id:'t',clientId:null,senderEmail:'wa-contact:5511'}]);expect((await prepare()).status).toBe(400);expect(m.create).not.toHaveBeenCalled();
});

it('prepares more than 50 distinct linked clients and supports selecting all filtered clients',async()=>{
 const rows=Array.from({length:75},(_,i)=>({id:'t'+i,senderName:'Client '+i,subject:'Chat',senderEmail:'wa-contact:5511'+String(i).padStart(6,'0'),clientId:'c'+i,client:{name:'Client '+i}}));m.tickets.mockResolvedValueOnce(rows);
 expect((await prepare(rows.map(r=>r.id))).status).toBe(200);expect(m.create.mock.calls[0][0].data).toHaveLength(75);
 await GET(new Request('https://hub.test/api/whatsapp/batch?all=1&search=cliente'));expect(m.clients.mock.calls[0][0]).toMatchObject({skip:0,take:1000});
});
it('never converts a server-scheduled batch into a manual preparation',async()=>{
 m.scheduled.mockResolvedValueOnce(true);expect((await prepare()).status).toBe(409);expect(m.create).not.toHaveBeenCalled();
});
