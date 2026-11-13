vi.mock("./payment-requests",()=>({paymentRequestNotifications:async()=>[]}));
vi.mock("server-only", () => ({}));
import { beforeEach, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({prisma: { whatsAppConnection: { findUnique: vi.fn(async (query: { where: { organizationId: string } }) => ({ id: "conn", organizationId: query.where.organizationId, phone: "5511888888888", instanceId: "instance", status: "CONNECTED", expiresAt: null, webhookConfiguredAt: new Date() })) },$queryRaw: query}}));
import { whatsappNotifications,whatsappSoundEvents } from "./notifications";
beforeEach(() => {vi.clearAllMocks();query.mockResolvedValue([]);});
it("restricts live unread messages to the organization, operator and optional manager queue", async () => {
 await whatsappNotifications("org-a", "operator-a", false, new Date("2026-11-03T12:00:00Z"));
 const sql = query.mock.calls[0][0];
 expect(sql.values).toContain("org-a");expect(sql.values).toContain("operator-a");expect(sql.values).toContain(false);
 expect(sql.sql).toContain("m.direction::text = 'INBOUND'");expect(sql.sql).toContain("'historical'");
 expect(sql.sql).toContain('m."receivedAt", m.id');expect(sql.sql).toContain('t."assignedToId" IS NULL');
 expect(sql.sql).toContain("'WHATSAPP_API'");expect(sql.sql).toContain('t."mergedIntoId" IS NULL');
});
it("uses stable message ids and opens the precise conversation without exposing message contents", async () => {
 query.mockResolvedValue([{id:"message-1",ticketId:"ticket-1",senderName:"Cliente",receivedAt:new Date("2026-11-03T12:00:00Z")}]);
 const result = await whatsappNotifications("org", "manager", true);
 expect(query.mock.calls[0][0].values).toContain(true);
 expect(result[0]).toMatchObject({id:"whatsapp-message-message-1",href:"/whatsapp?ticket=ticket-1",popup:true,description:"Cliente"});
});

it("detects live arrival sounds independently of read markers, including the operator queue",async()=>{query.mockResolvedValue([{id:"new",arrivedAt:new Date("2026-11-13T12:00:00Z")}]);expect(await whatsappSoundEvents("org","operator",true,"2026-11-13T11:59:55Z",new Date("2026-11-13T12:00:01Z"))).toEqual([{id:"whatsapp-message-new",createdAt:"2026-11-13T12:00:00.000Z"}]);const sql=query.mock.calls[0][0];expect(sql.sql).not.toContain("WhatsAppReadState");expect(sql.sql).toContain('m."createdAt"');expect(sql.sql).toContain("m.direction::text='INBOUND'");expect(sql.sql).toContain("'historical'");expect(sql.values).toContain("operator");expect(sql.values).toContain("org");expect(sql.values).toContain(true);});
it("does not replay a backlog on first load and limits sound lookups to two minutes",async()=>{await whatsappSoundEvents("org","operator",true,"initial");expect(query).not.toHaveBeenCalled();const now=new Date("2026-11-13T12:00:00Z");await whatsappSoundEvents("org","operator",false,"2025-01-01T00:00:00Z",now);expect(query.mock.calls[0][0].values).toContainEqual(new Date("2026-11-13T11:58:00Z"));});
