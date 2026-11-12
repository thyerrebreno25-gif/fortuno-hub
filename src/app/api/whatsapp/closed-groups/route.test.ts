import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),query:vi.fn()}));
vi.mock("@/modules/atendimento/auth",()=>({getServiceCenterMember:m.member,getWhatsAppPermission:m.permission}));
vi.mock("@/lib/prisma",()=>({prisma:{$queryRaw:m.query,whatsAppConnection:{findUnique:async()=>({id:"c",organizationId:"org",phone:"5511",status:"CONNECTED"})}}}));
import {GET} from "./route";
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({organizationId:"org",role:"MASTER"});m.permission.mockResolvedValue({canView:true});m.query.mockResolvedValue([{identifier:"wa-group:g@g.us",name:"Grupo",closed:2,open:1,messages:20,emptyClosed:0}]);});
it("audits closed groups using an exact tenant and physical account without any mutations",async()=>{const r=await GET();expect(r.status).toBe(200);expect((await r.json()).groups[0]).toMatchObject({closed:2,messages:20});const sql=m.query.mock.calls[0][0];expect(sql.values).toEqual(["org","wa-account:c:5511"]);expect(sql.sql).toContain('t."mergedIntoId" IS NULL');expect(sql.sql).toContain("HAVING COUNT(*) FILTER(WHERE status::text='RESOLVED')>1");});
it.each(["OPERATOR","CLIENT","UNKNOWN"])("denies %s even with canManage granted",async role=>{m.member.mockResolvedValue({organizationId:"org",role});m.permission.mockResolvedValue({canView:true,canManage:true});expect((await GET()).status).toBe(403);expect(m.query).not.toHaveBeenCalled();});
