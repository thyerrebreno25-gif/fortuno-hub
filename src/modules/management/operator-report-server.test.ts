import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({members:vi.fn(),permissions:vi.fn(),account:vi.fn(),usage:vi.fn(),raw:vi.fn(),events:vi.fn(),pending:vi.fn(),entries:vi.fn(),daily:vi.fn(),details:vi.fn(),snapshot:vi.fn(),service:vi.fn(),surveys:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{whatsAppSurvey:{findMany:m.surveys},organizationMember:{findMany:m.members},$queryRaw:m.raw,operationEvent:{groupBy:m.events},operationActivity:{groupBy:m.pending,findMany:m.details},operationTimeEntry:{findMany:m.entries},meetingActionItem:{groupBy:m.daily,findMany:m.details}}}));
vi.mock("@/modules/permissions/permissions",()=>({getRolePermissions:m.permissions}));
vi.mock("@/modules/whatsapp/account-scope",()=>({currentWhatsAppAccount:m.account}));
vi.mock("@/modules/whatsapp/usage-server",()=>({whatsappUsage:m.usage}));
vi.mock("./operator-service-attention-server",()=>({operatorServiceAttention:m.service}));
vi.mock("./service-report-snapshot",()=>({buildServiceSnapshot:m.snapshot}));
import {summarizeOperatorService} from "./operator-service-attention";
import {buildOperatorDayReport} from "./operator-report-server";
const member={id:"manager",userId:"gestor",organizationId:"org",role:"MANAGER"};
beforeEach(()=>{vi.clearAllMocks();m.surveys.mockResolvedValue([]);m.details.mockResolvedValue([]);m.snapshot.mockResolvedValue(undefined);m.permissions.mockResolvedValue(Object.fromEntries(["MANAGEMENT","WHATSAPP","OPERATIONS","DAILY_ACTIVITIES"].map(key=>[key,{canView:true}])));m.members.mockResolvedValue([{userId:"ana",user:{name:"Ana",email:"ana@example.test"},teamLeader:{user:{name:"Gestor"}}}]);m.account.mockResolvedValue({accountKey:"wa-account:current:5511",connection:{phone:"5511"}});m.usage.mockResolvedValue({rows:[{userId:"ana",messages:5,conversations:2,clients:1},{userId:"outside",messages:999}]});m.raw.mockResolvedValue([{userId:"ana",resolved:2}]);m.service.mockResolvedValue(summarizeOperatorService([{userId:"ana",name:"Ana",messages:5,resolved:2}],[{id:"open",userId:"ana",client:"Cliente",contact:"Grupo",status:"IN_PROGRESS",openedAt:new Date("2026-11-23T12:00Z"),pendingSince:null,lastOutboundAt:null}],[],new Date("2026-11-24T11:00Z")));m.events.mockResolvedValue([{userId:"ana",activityId:"a"}]);m.pending.mockResolvedValue([{responsibleId:"ana",_count:{_all:3}}]);m.entries.mockResolvedValue([{userId:"ana",startedAt:new Date("2026-11-23T12:00:00Z"),endedAt:new Date("2026-11-23T13:00:00Z"),seconds:3600,source:"TIMER"},{userId:"ana",startedAt:new Date("2026-11-23T14:00:00Z"),endedAt:null,seconds:0}]);m.daily.mockResolvedValue([{responsibleId:"ana",_count:{_all:2}}]);});
it("scopes managers to linked operators and attributes completed work to its actual actor",async()=>{
 const result=await buildOperatorDayReport(member,"2026-11-23",new Date("2026-11-24T11:00:00Z"));
 expect(m.members.mock.calls[0][0].where).toMatchObject({organizationId:"org",role:"OPERATOR",OR:[{userId:"gestor"},{teamLeaderId:"manager"}]});expect(result.rows).toHaveLength(1);expect(m.service.mock.calls[0][3].map((row:{userId:string})=>row.userId)).toEqual(["ana","QUEUE"]);expect(result.serviceAttention).toBeDefined();expect(result.rows[0]).toMatchObject({messages:5,tasksCompleted:1,seconds:3600,openTimers:1,tasksPending:3,dailyPending:2});
 expect(m.events.mock.calls[0][0].where).toMatchObject({userId:{in:["ana"]},activity:{organizationId:"org",deletedAt:null},createdAt:{gte:new Date("2026-11-23T03:00:00Z"),lt:new Date("2026-11-24T03:00:00Z")}});
 expect(m.raw.mock.calls[0][0].values).toContain("wa-account:current:5511");
});
it("does not query metrics of restricted modules and rejects operators",async()=>{
 m.permissions.mockResolvedValue({MANAGEMENT:{canView:true},WHATSAPP:{canView:false},OPERATIONS:{canView:false},DAILY_ACTIVITIES:{canView:false}});
 const result=await buildOperatorDayReport({...member,role:"MASTER"},"2026-11-23",new Date("2026-11-24T11:00:00Z"));expect(result.available).toEqual({whatsapp:false,operations:false,daily:false});expect(m.account).not.toHaveBeenCalled();expect(m.events).not.toHaveBeenCalled();expect(m.daily).not.toHaveBeenCalled();expect(m.service).not.toHaveBeenCalled();
 await expect(buildOperatorDayReport({...member,role:"OPERATOR"})).rejects.toThrow("Sem permissão");
});
it("counts only the overlapping part of a closed entry and preserves manual duration entries",async()=>{
 m.entries.mockResolvedValue([{userId:"ana",startedAt:new Date("2026-11-23T02:30:00Z"),endedAt:new Date("2026-11-23T03:30:00Z"),seconds:3600,source:"TIMER"},{userId:"ana",startedAt:new Date("2026-11-23T16:00:00Z"),endedAt:new Date("2026-11-23T16:00:00Z"),seconds:2700,source:"MANUAL_DURATION"}]);
 const result=await buildOperatorDayReport(member,"2026-11-23",new Date("2026-11-24T11:00:00Z"));expect(result.rows[0].seconds).toBe(4500);
});

it("builds today's service-only report without querying tasks and includes every non-client attendant",async()=>{
 const result=await buildOperatorDayReport({...member,role:"MASTER"},"2026-11-26",new Date("2026-11-26T16:00Z"),"SERVICE");
 expect(result.kind).toBe("SERVICE");expect(result.day).toBe("2026-11-26");expect(m.members.mock.calls[0][0].where.role).toEqual({not:"CLIENT"});
 expect(result.available).toEqual({whatsapp:true,operations:false,daily:false});expect(m.events).not.toHaveBeenCalled();expect(m.daily).not.toHaveBeenCalled();expect(m.details).not.toHaveBeenCalled();
 expect(m.service.mock.calls[0][4]).toMatchObject({from:"2026-11-26",to:"2026-11-26"});
});
