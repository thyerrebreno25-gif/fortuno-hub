import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({member:vi.fn(),imports:vi.fn(),whatsapp:vi.fn(),activities:vi.fn(),meetings:vi.fn()}));
vi.mock("@/modules/account/server/account-auth",()=>({getAccountMember:m.member}));
vi.mock("@/lib/prisma",()=>({prisma:{importJob:{findMany:m.imports}}}));
vi.mock("@/modules/whatsapp/notifications",()=>({whatsappNotifications:m.whatsapp,whatsappSoundEvents:m.whatsapp,whatsappManagerRiskNotifications:m.whatsapp}));
vi.mock("@/modules/operations/notifications",()=>({activityNotifications:m.activities}));
vi.mock("@/modules/meetings/notifications",()=>({meetingNotifications:m.meetings}));
vi.mock("@/modules/atendimento/auth",()=>({SERVICE_CENTER_MANAGER_ROLES:new Set(["MASTER"])}));
vi.mock("@/modules/permissions/permissions",()=>({getRolePermissions:vi.fn()}));
vi.mock("@/modules/whatsapp/operation-start",()=>({operationStartedAt:vi.fn()}));
import {GET} from "./route";
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({userId:"me",organizationId:"org",notificationsMuted:true});});
it("stops all feed and sound delivery in the server for globally muted accounts",async()=>{
 const response=await GET(new Request("https://hub.test/api/notifications"));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({viewerKey:"org:me",items:[],total:0,notificationsMuted:true,whatsappNotificationsMuted:true,whatsappSoundEvents:[]});
 for(const source of [m.imports,m.whatsapp,m.activities,m.meetings])expect(source).not.toHaveBeenCalled();
 expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("still requires an authenticated viewer before applying the preference",async()=>{m.member.mockResolvedValue(null);expect((await GET(new Request("https://hub.test/api/notifications"))).status).toBe(401);expect(m.imports).not.toHaveBeenCalled();});
