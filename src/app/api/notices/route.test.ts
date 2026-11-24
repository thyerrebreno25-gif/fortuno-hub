import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permissions:vi.fn(),notices:vi.fn(),members:vi.fn(),broad:false}));
vi.mock("@/lib/prisma",()=>({prisma:{notice:{findMany:m.notices},organizationMember:{findMany:m.members}}}));
vi.mock("@/modules/permissions/permissions",()=>({getRolePermissions:m.permissions}));
vi.mock("@/modules/operations/disregard-notices",()=>({attachDisregardNotices:async(value:unknown)=>value}));
vi.mock("@/modules/notices/server/notice-auth",()=>({getNoticeMember:m.member,canManageNotices:()=>true,canBroadcastToOrganization:()=>m.broad}));
vi.mock("@/modules/notices/server/notice-targeting",()=>({targetableNoticeMemberWhere:()=>({})}));
import {GET} from "./route";
beforeEach(()=>{vi.resetAllMocks();m.broad=false;m.member.mockResolvedValue({id:"manager",userId:"me",organizationId:"org",role:"MANAGER",isTeamLeader:true});m.permissions.mockResolvedValue({NOTICES:{canView:true,canManage:true}});m.notices.mockResolvedValue([]);m.members.mockResolvedValue([{id:"manager"},{id:"operator"}]);});
it("filters approval notices before the limit without replacing recipient, organization or expiry restrictions",async()=>{
 const response=await GET(new Request("https://hub.test/api/notices?origin=disregard&limit=5"));expect(response.status).toBe(200);
 expect(m.notices.mock.calls[0][0]).toMatchObject({where:{organizationId:"org",recipients:{some:{memberId:"manager",completedAt:null}},closedAt:null,AND:[{id:{startsWith:"operation-disregard:"}}],OR:[{expiresAt:null},{expiresAt:{gte:expect.any(Date)}}]},take:5});
});
it("combines Daily origin with management team visibility instead of expanding access",async()=>{
 expect((await GET(new Request("https://hub.test/api/notices?view=management&origin=daily"))).status).toBe(200);
 expect(m.notices.mock.calls[0][0].where).toMatchObject({organizationId:"org",scope:{not:"PERSONAL"},OR:[{authorMemberId:"manager"},{recipients:{some:{memberId:{in:["manager","operator"]}}}}],AND:[{OR:expect.any(Array)}]});
});
it("preserves completion filtering and rejects unknown origins before reading notice contents",async()=>{
 expect((await GET(new Request("https://hub.test/api/notices?origin=other&status=completed"))).status).toBe(200);expect(m.notices.mock.calls[0][0].where).toMatchObject({recipients:{some:{completedAt:{not:null}}},AND:[{NOT:expect.any(Object)}]});
 m.notices.mockClear();expect((await GET(new Request("https://hub.test/api/notices?origin=unknown"))).status).toBe(400);expect(m.notices).not.toHaveBeenCalled();
});
it("denies anonymous and revoked profiles before filtering any records",async()=>{
 m.member.mockResolvedValueOnce(null);expect((await GET(new Request("https://hub.test/api/notices?origin=daily"))).status).toBe(401);
 m.permissions.mockResolvedValueOnce({NOTICES:{canView:false}});expect((await GET(new Request("https://hub.test/api/notices?origin=operations"))).status).toBe(403);expect(m.notices).not.toHaveBeenCalled();
});
