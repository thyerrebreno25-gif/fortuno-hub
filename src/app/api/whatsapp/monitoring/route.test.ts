import {beforeEach,expect,it,vi} from "vitest";
vi.mock("@/modules/whatsapp/operation-start",()=>({operationStartedAt:async()=>null}));
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),tickets:vi.fn(),history:vi.fn()}));
vi.mock('@/modules/atendimento/auth',()=>({getServiceCenterMember:m.member,getWhatsAppPermission:m.permission}));
vi.mock('@/lib/prisma',()=>({prisma:{whatsAppConnection:{findUnique:async()=>({id:'c',organizationId:'org',phone:'5511',status:'CONNECTED',expiresAt:null})},organizationMember:{findMany:async()=>[]},serviceTicket:{findMany:m.tickets},whatsAppSurvey:{findMany:m.history}}}));
import {GET} from './route';
const get=()=>GET(new Request('https://hub.test/api/whatsapp/monitoring?from=2026-11-01&to=2026-11-06'));
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({organizationId:'org',role:'MASTER'});m.permission.mockResolvedValue({canView:true});m.tickets.mockResolvedValue([]);m.history.mockResolvedValue([]);});
it('returns zero real activity instead of sample customers when the database is empty',async()=>{const r=await get();expect(r.status).toBe(200);const data=await r.json();expect(data.summary.conversations).toBe(0);expect(data.clients).toEqual([]);expect(data.attention).toEqual([]);});
it('scopes all metrics to real messages on the connected phone and excludes internal comments',async()=>{await get();const query=m.tickets.mock.calls[0][0];expect(query.where).toMatchObject({organizationId:'org',source:'WHATSAPP_API',recipientEmail:'wa-account:c:5511',mergedIntoId:null});expect(query.select.messages.where).toMatchObject({direction:{not:'INTERNAL'}});expect(m.history.mock.calls[0][0].where).toMatchObject({organizationId:'org',accountRecipient:'wa-account:c:5511',status:'ANSWERED'});});
it('requires authenticated WhatsApp viewing permission',async()=>{m.member.mockResolvedValueOnce(null);expect((await get()).status).toBe(401);m.permission.mockResolvedValue({canView:false});expect((await get()).status).toBe(403);expect(m.tickets).not.toHaveBeenCalled();});

it('uses only actual customer responses in the response period, even for calls opened earlier',async()=>{m.history.mockResolvedValue([{ticketId:'old-call',score:5,clientId:'cl',clientName:'Cliente',operatorId:'op',operatorName:'Operador'}]);const data=await (await get()).json();expect(data.summary.satisfaction).toBe(5);expect(data.clients[0]).toMatchObject({id:'cl',satisfaction:5});expect(data.agents[0]).toMatchObject({id:'op',satisfaction:5});expect(m.history.mock.calls[0][0].where).toHaveProperty('answeredAt');});

it.each(['OPERATOR','CLIENT','UNKNOWN'])('denies monitoring data to %s even when WhatsApp canManage is granted',async role=>{m.member.mockResolvedValue({organizationId:'org',role});m.permission.mockResolvedValue({canView:true,canManage:true});expect((await get()).status).toBe(403);expect(m.tickets).not.toHaveBeenCalled();expect(m.history).not.toHaveBeenCalled();});
it.each(['MASTER','ADMIN','MANAGER'])('allows %s to monitor with WhatsApp viewing permission',async role=>{m.member.mockResolvedValue({organizationId:'org',role});expect((await get()).status).toBe(200);});
