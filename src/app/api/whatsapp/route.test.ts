vi.mock("@/modules/whatsapp/read-state",()=>({latestConversationDirections:vi.fn(async()=>new Map()),unreadCounts:vi.fn(async()=>new Map([["ticket",3]]))}));
import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),find:vi.fn(),history:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma: { whatsAppConnection: { findUnique: vi.fn(async () => ({ id: "conn", organizationId: "org", phone: "5511888888888", instanceId: "instance", status: "CONNECTED", expiresAt: null, webhookConfiguredAt: new Date() })) },serviceTicket:{findMany:m.find},serviceTicketHistory:{findMany:m.history}}}));
vi.mock("@/modules/atendimento/auth",()=>({getServiceCenterMember:m.member,getWhatsAppPermission:m.permission}));
vi.mock("@/modules/whatsapp/server",()=>({resolveWhatsappRouting:vi.fn()}));
import {GET,POST} from "./route";
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({organizationId:"org",userId:"user"});m.permission.mockResolvedValue({canView:true});m.find.mockResolvedValue([]);});
it("loads the lightweight inbox without message joins or satisfaction history",async()=>{
  const response=await GET(new Request("https://example.test/api/whatsapp?light=1&view=GENERAL&kind=ALL&status=OPEN"));expect(response.status).toBe(200);expect(m.find).toHaveBeenCalledTimes(2);expect(m.history).not.toHaveBeenCalled();
  for(const [query] of m.find.mock.calls){expect(query.where.organizationId).toBe("org");expect(query.select.messages).toBeUndefined();}
  expect((await response.json()).stats.facets.status.OPEN).toBe(0);
});
it("enforces permissions before loading the inbox",async()=>{m.permission.mockResolvedValue({canView:false});expect((await GET(new Request("https://example.test/api/whatsapp?light=1"))).status).toBe(403);expect(m.find).not.toHaveBeenCalled();});

it("includes per-operator unread counts without loading message histories",async()=>{m.find.mockResolvedValueOnce([{id:"ticket",senderEmail:"wa-contact:5511999999999"}]).mockResolvedValueOnce([]);const body=await(await GET(new Request("https://example.test/api/whatsapp?light=1"))).json();expect(body.tickets[0].unreadCount).toBe(3);});

it("filters unread conversations before applying the list limit",async()=>{await GET(new Request("https://example.test/api/whatsapp?light=1&unread=1"));expect(m.find.mock.calls[0][0].where.AND).toEqual([{AND:[]},{id:{in:["ticket"]}}]);});

it("filters conversations and all counters by the currently connected physical phone",async()=>{
 await GET(new Request("https://hub.test/api/whatsapp?light=1"));
 for(const [query] of m.find.mock.calls) expect(query.where).toMatchObject({source:"WHATSAPP_API",recipientEmail:"wa-account:conn:5511888888888"});
});
it("does not create simulated calls through the retired endpoint",async()=>{expect((await POST()).status).toBe(410);expect(m.find).not.toHaveBeenCalled();});

it("preserves personal ownership and open-state filters when filtering unread calls",async()=>{await GET(new Request("https://example.test/api/whatsapp?light=1&unread=1&view=MINE&status=OPEN"));expect(m.find.mock.calls[0][0].where.AND[0].AND).toContainEqual({assignedToId:"user",status:{notIn:["RESOLVED","SPAM"]}});});

it("searches all statuses and owners even when the caller has active inbox filters",async()=>{await GET(new Request("https://hub/api/whatsapp?light=1&search=cliente&view=MINE&kind=GROUP&status=OPEN&unread=1"));const query=m.find.mock.calls[0][0];expect(query.where.AND).toEqual([]);expect(query.where.OR).toContainEqual({client:{name:{contains:"cliente",mode:"insensitive"}}});expect(query.where).toMatchObject({organizationId:"org",recipientEmail:"wa-account:conn:5511888888888",isSpam:false});});
