import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({unstable_cache:(fn:()=>unknown)=>fn}));
const m=vi.hoisted(()=>({raw:vi.fn(),members:vi.fn()}));vi.mock("@/lib/prisma",()=>({prisma:{$queryRaw:m.raw,organizationMember:{findMany:m.members}}}));
import {whatsappUsage} from "./usage-server";
it("uses actual human actor events, isolates current account, excludes sync and includes zero-use team members",async()=>{
 m.raw.mockResolvedValue([{userId:"u",messages:5,comments:1,actions:8,conversations:3,clients:2,activeDays:2,lastAt:new Date("2026-11-16T12:00:00Z")}]);m.members.mockResolvedValue([{user:{id:"u",name:"Ana",email:"ana@test"}},{user:{id:"v",name:"Bia",email:"bia@test"}}]);
 const result=await whatsappUsage("org","wa-account:c:5511","5511",new Date("2026-11-01"),new Date("2026-11-17"));
 expect(result.summary).toEqual({messages:5,actions:8,activeUsers:1,totalUsers:2});expect(result.rows[1]).toMatchObject({name:"Bia",messages:0,actions:0,share:0});
 const query=m.raw.mock.calls[0][0];expect(query.values).toContain("org");expect(query.values).toContain("wa-account:c:5511");expect(query.sql).toContain('h."userId"');expect(query.sql).toContain("WHATSAPP_REPLIED");expect(query.sql).toContain("h.metadata->>'state'='SENT'");expect(query.sql).toContain("'failed','unconfirmed'");expect(query.sql).toContain('b."startedAt"');expect(query.sql).not.toContain('assignedToId');expect(m.members.mock.calls[0][0].where.organizationId).toBe("org");
});
