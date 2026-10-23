import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ overview: vi.fn(), permission: vi.fn() }));
vi.mock("@/modules/dashboard/operational-overview", () => ({ operationalOverview: mocks.overview }));
vi.mock("@/modules/permissions/permissions", () => ({ getRolePermissions: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: {user:{id:"u"}}, error:null }) } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { organizationMember: { findFirst: async () => ({id:"m",userId:"u",organizationId:"org",role:"OPERATOR",isTeamLeader:false,teamMembers:[],user:{id:"u",name:"User",email:"user@example.com"}}), findMany:async()=>[{userId:"u"}] } } }));
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as reports } from "@/app/api/reports/route";
it.each([dashboard,reports])("rejects requests without module permission before reading indicators", async (handler) => {
 mocks.permission.mockResolvedValue({DASHBOARD:{canView:false},REPORTS:{canView:false}});
 const result=await handler(new Request("https://example.test/api?period=30D"));
 expect(result.status).toBe(403);expect(mocks.overview).not.toHaveBeenCalled();
});
