import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({member:vi.fn(),imports:vi.fn(),tickets:vi.fn(),onboardings:vi.fn(),blocked:vi.fn(),preference:vi.fn(),whatsapp:vi.fn(),sound:vi.fn(),risk:vi.fn(),activities:vi.fn(),meetings:vi.fn(),permissions:vi.fn(),reset:vi.fn()}));
vi.mock("@/modules/account/server/account-auth",()=>({getAccountMember:m.member}));
vi.mock("@/lib/prisma",()=>({prisma:{importJob:{findMany:m.imports},supportTicket:{findMany:m.tickets},onboarding:{findMany:m.onboardings},onboardingTask:{findMany:m.blocked},whatsAppOperatorPreference:{findUnique:m.preference}}}));
vi.mock("@/modules/whatsapp/notifications",()=>({whatsappNotifications:m.whatsapp,whatsappSoundEvents:m.sound,whatsappManagerRiskNotifications:m.risk}));
vi.mock("@/modules/operations/notifications",()=>({activityNotifications:m.activities}));
vi.mock("@/modules/meetings/notifications",()=>({meetingNotifications:m.meetings}));
vi.mock("@/modules/atendimento/auth",()=>({SERVICE_CENTER_MANAGER_ROLES:new Set(["MASTER"])}));
vi.mock("@/modules/permissions/permissions",()=>({getRolePermissions:m.permissions}));
vi.mock("@/modules/whatsapp/operation-start",()=>({operationStartedAt:m.reset}));
import {GET} from "./route";
const item=(id:string,href:string)=>({id,href,title:id,description:"Aviso",createdAt:"2026-11-24T12:00:00Z",type:"INFO",popup:true});
beforeEach(()=>{
 vi.resetAllMocks();m.member.mockResolvedValue({userId:"me",organizationId:"org",role:"OPERATOR",notificationsMuted:true});
 for(const source of [m.imports,m.tickets,m.onboardings,m.blocked,m.risk])source.mockResolvedValue([]);
 m.permissions.mockResolvedValue({MEETINGS:{canView:true},OPERATIONS:{canView:true},WHATSAPP:{canView:true,canEdit:true}});m.preference.mockResolvedValue({notificationsMuted:false});m.reset.mockResolvedValue(null);
 m.meetings.mockResolvedValue([item("daily","/reunioes")]);m.activities.mockResolvedValue([item("task","/operacoes")]);m.whatsapp.mockResolvedValue([item("whatsapp","/whatsapp")]);m.sound.mockResolvedValue([{id:"new-sound"}]);
});
it("keeps the complete bell feed and counts while suppressing every popup and sound when muted",async()=>{
 const response=await GET(new Request("https://hub.test/api/notifications"));expect(response.status).toBe(200);const body=await response.json();
 expect(body).toMatchObject({viewerKey:"org:me",total:3,notificationsMuted:true,whatsappNotificationsMuted:true,whatsappSoundEvents:[]});
 expect(body.items.map((row:{id:string})=>row.id)).toEqual(expect.arrayContaining(["daily","task","whatsapp"]));
 expect(body.items.every((row:{popup:boolean})=>row.popup===false)).toBe(true);expect(m.sound).not.toHaveBeenCalled();
 expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("restores popups and sounds after unmuting without changing the bell items",async()=>{
 m.member.mockResolvedValue({userId:"me",organizationId:"org",role:"OPERATOR",notificationsMuted:false});
 const body=await(await GET(new Request("https://hub.test/api/notifications"))).json();expect(body.total).toBe(3);expect(body.items.every((row:{popup:boolean})=>row.popup)).toBe(true);expect(body.whatsappSoundEvents).toEqual([{id:"new-sound"}]);
});
it("keeps import, support, onboarding and manager-risk records available in quiet mode too",async()=>{
 m.member.mockResolvedValue({userId:"me",organizationId:"org",role:"MASTER",notificationsMuted:true});const updatedAt=new Date("2026-11-24T12:00:00Z");
 m.imports.mockResolvedValue([{id:"i",originalName:"Arquivo",status:"REVIEW",updatedAt,client:null}]);m.tickets.mockResolvedValue([{id:"s",subject:"Suporte",status:"OPEN",priority:"NORMAL",updatedAt}]);m.onboardings.mockResolvedValue([{id:"o",companyName:"Cliente",updatedAt}]);m.blocked.mockResolvedValue([{id:"b",title:"Tarefa",updatedAt,onboarding:{companyName:"Cliente"}}]);m.risk.mockResolvedValue([item("risk","/whatsapp")]);
 const body=await(await GET(new Request("https://hub.test/api/notifications"))).json();expect(body.total).toBe(8);expect(body.items.every((row:{popup:boolean})=>row.popup===false)).toBe(true);expect(m.sound).not.toHaveBeenCalled();
});
it("still requires an authenticated viewer before reading the feed",async()=>{m.member.mockResolvedValue(null);expect((await GET(new Request("https://hub.test/api/notifications"))).status).toBe(401);expect(m.imports).not.toHaveBeenCalled();});
