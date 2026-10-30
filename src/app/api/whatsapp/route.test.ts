import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),find:vi.fn(),history:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{serviceTicket:{findMany:m.find},serviceTicketHistory:{findMany:m.history}}}));
vi.mock("@/modules/atendimento/auth",()=>({getServiceCenterMember:m.member,getWhatsAppPermission:m.permission}));
vi.mock("@/modules/whatsapp/server",()=>({resolveWhatsappRouting:vi.fn()}));
import {GET} from "./route";
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({organizationId:"org",userId:"user"});m.permission.mockResolvedValue({canView:true});m.find.mockResolvedValue([]);});
it("loads the lightweight inbox without message joins or satisfaction history",async()=>{
  const response=await GET(new Request("https://example.test/api/whatsapp?light=1&view=GENERAL&kind=ALL&status=OPEN"));expect(response.status).toBe(200);expect(m.find).toHaveBeenCalledTimes(2);expect(m.history).not.toHaveBeenCalled();
  for(const [query] of m.find.mock.calls){expect(query.where.organizationId).toBe("org");expect(query.select.messages).toBeUndefined();}
  expect((await response.json()).stats.facets.status.OPEN).toBe(0);
});
it("enforces permissions before loading the inbox",async()=>{m.permission.mockResolvedValue({canView:false});expect((await GET(new Request("https://example.test/api/whatsapp?light=1"))).status).toBe(403);expect(m.find).not.toHaveBeenCalled();});
