import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ operationalMapping: { findMany: vi.fn() }, operationActivity: { groupBy: vi.fn() }, serviceTicket: { groupBy: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/operational-mapping/server", () => ({ mappingScope: (member: { organizationId: string; userId: string }) => ({ organizationId: member.organizationId, createdById: member.userId }) }));
import { operationalOverview, summarizeMappings } from "./operational-overview";
const member = { id: "m", userId: "u", organizationId: "org", role: "OPERATOR", isTeamLeader: false, teamMemberUserIds: [], user: { id: "u", name: "User", email: "user@example.com" } };
beforeEach(() => { vi.clearAllMocks(); db.operationalMapping.findMany.mockResolvedValue([]); db.operationActivity.groupBy.mockResolvedValue([]); db.serviceTicket.groupBy.mockResolvedValue([]); });
it("counts saved GUT assessments without treating pending items as assessed", () => {
 const gut = [{ id: "a", title: "A", gravity: 5, urgency: 5, tendency: 5 }, { id: "b", title: "B", gravity: 2, urgency: null, tendency: 3 }];
 expect(summarizeMappings([{ status: "VALIDATED", data: { gut } }, {status: "DRAFT", data: {}}])).toEqual({ total: 2, validated: 1, activities: 2, assessed: 1, highestImpact: 100 });
});
it("does not query modules the user cannot view", async () => {
 await operationalOverview(member, {}, new Date(0), new Date(), ["u"]);
 expect(db.operationalMapping.findMany).not.toHaveBeenCalled(); expect(db.serviceTicket.groupBy).not.toHaveBeenCalled(); expect(db.operationActivity.groupBy).not.toHaveBeenCalled();
});
it("keeps simulations separate and scopes queries to the organization, user and period", async () => {
 const start = new Date("2026-10-01"), end = new Date("2026-10-23");
 db.serviceTicket.groupBy.mockResolvedValue([{source:"WHATSAPP_API",status:"RESOLVED",_count:{_all:2}}, {source:"WHATSAPP_SIMULATOR",status:"NEW",_count:{_all:9}}]);
 const result = await operationalOverview(member, {WHATSAPP:true,OPERATIONS:true,OPERATIONAL_MAPPING:true}, start, end, ["u"]);
 expect(result.whatsapp).toEqual({received:2,resolved:2,simulated:9});
 expect(db.serviceTicket.groupBy).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({organizationId:"org",assignedToId:{in:["u"]},receivedAt:{gte:start,lte:end}})}));
 expect(db.operationalMapping.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{organizationId:"org",createdById:"u"}}));
 expect(db.operationActivity.groupBy).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({organizationId:"org",responsibleId:{in:["u"]},scheduledDate:{gte:start,lte:end},deletedAt:null})}));
});
