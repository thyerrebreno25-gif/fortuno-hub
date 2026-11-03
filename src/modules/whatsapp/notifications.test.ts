vi.mock("server-only", () => ({}));
import { beforeEach, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({prisma: {$queryRaw: query}}));
import { whatsappNotifications } from "./notifications";
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
