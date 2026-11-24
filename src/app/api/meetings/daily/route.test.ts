import {beforeEach, expect, it, vi} from "vitest";
const m = vi.hoisted(() => ({visible:vi.fn(),access: vi.fn(), find: vi.fn(), actions: vi.fn(), count: vi.fn(), process: vi.fn(), save: vi.fn(), contexts:vi.fn()}));
vi.mock("@/lib/prisma", () => ({prisma: {teamMeeting:{findMany:m.contexts},meetingActionItem: {findFirst:m.visible,findMany: m.actions, count: m.count}}}));
vi.mock("@/modules/meetings/auth", () => ({meetingAccess: m.access, meetingScope:(member:{organizationId:string;userId:string})=>({organizationId:member.organizationId,deletedAt:null,participants:{some:{userId:member.userId}}}), findMeeting: m.find, meetingFailure: (error: Error & {status?: number}) => Response.json({error: error.message}, {status: error.status || 400}), MeetingError: class extends Error {constructor(message: string, public status = 400) {super(message);}}}));
vi.mock("@/modules/meetings/daily-server", () => ({processDailyActivities: m.process}));
vi.mock("@/modules/meetings/service", () => ({saveAction: m.save}));
vi.mock("@/modules/meetings/delivery", () => ({processMeetingBackground: vi.fn()}));
vi.mock("next/server", async () => ({...await vi.importActual("next/server"), after: vi.fn()}));
import {GET, PATCH} from "./route";
const member = {id:"membership",userId: "me", organizationId: "tenant", role: "OPERATOR"};
beforeEach(() => {
  vi.clearAllMocks();m.visible.mockResolvedValue({id:"task"}); m.contexts.mockResolvedValue([]); m.access.mockResolvedValue({member, permissions: {canView: true, canEdit: true}, modulePermissions: {MEETINGS: {canView: false}}});
  m.actions.mockResolvedValue([]); m.count.mockResolvedValue(0); m.find.mockResolvedValue({type: "Daily"});
  m.save.mockResolvedValue({id: "task", completedAt: new Date(), revision: 3});
});
it("uses independent Daily permissions, keeps operators in their own scope and hides inaccessible meeting links", async () => {
  const result = await GET(new Request("https://hub.test/api/meetings/daily?scope=all")); const body = await result.json();
  expect(result.status).toBe(200); expect(m.access).toHaveBeenCalledWith("DAILY_ACTIVITIES");
  expect(m.actions.mock.calls[0][0].where).toMatchObject({responsibleId: "me", meeting: {organizationId: "tenant"}});
  expect(body).toMatchObject({canViewMeetings: false, canEdit: true});
});
it("completes the shared action without granting access to the meeting module", async () => {
  const body = {meetingId: "meeting", id: "task", revision: 2, completed: true};
  const result = await PATCH(new Request("https://hub.test/api/meetings/daily", {method: "PATCH", body: JSON.stringify(body)}));
  expect(result.status).toBe(200); expect(m.access).toHaveBeenCalledWith("DAILY_ACTIVITIES", "canEdit");
  expect(m.save).toHaveBeenCalledWith(member, "meeting", body, "task");
});
it("denies a revoked profile before reading or writing data", async () => {
  m.access.mockRejectedValue(Object.assign(new Error("Seu perfil não permite esta ação."), {status: 403}));
  expect((await GET(new Request("https://hub.test/api/meetings/daily"))).status).toBe(403);
  expect(m.actions).not.toHaveBeenCalled(); expect(m.process).not.toHaveBeenCalled();
});
it("does not turn Daily permission into access to other meeting types or task assignment", async () => {
  m.find.mockResolvedValue({type: "Planejamento"});
  const request = (extra = {}) => new Request("https://hub.test/api/meetings/daily", {method: "PATCH", body: JSON.stringify({meetingId: "m", id: "t", revision: 1, completed: true, ...extra})});
  expect((await PATCH(request())).status).toBe(403);
  expect((await PATCH(request({responsibleId: "other"}))).status).toBe(400);
  expect(m.save).not.toHaveBeenCalled();
});

it("keeps carried work completable from Daily for a new participant using an accessible current occurrence",async()=>{
 const meeting={id:"original",title:"Daily",type:"Daily",creationKey:"series",startsAt:new Date("2026-11-17T12:00:00Z")};m.actions.mockResolvedValue([{id:"task",createdAt:new Date("2026-11-17T12:10:00Z"),completedAt:null,meeting}]);m.contexts.mockResolvedValue([{id:"current",creationKey:"series",startsAt:new Date("2026-11-18T12:00:00Z")}]);
 const response=await GET(new Request("https://hub.test/api/meetings/daily"));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({actions:[{id:"task",contextMeetingId:"current",meeting:{id:"original"}}]});expect(m.contexts.mock.calls[0][0].where).toMatchObject({organizationId:"tenant",participants:{some:{userId:"me"}},creationKey:{in:["series"]}});
 const body={meetingId:"original",contextMeetingId:"current",id:"task",revision:2,completed:true};expect((await PATCH(new Request("https://hub.test/api/meetings/daily",{method:"PATCH",body:JSON.stringify(body)}))).status).toBe(200);expect(m.find).toHaveBeenCalledWith(member,"current");expect(m.save).toHaveBeenCalledWith(member,"current",body,"task");
});
it("uses the original meeting when reopening work completed before the current Daily",async()=>{
 m.actions.mockResolvedValue([{id:"task",createdAt:new Date("2026-11-17T12:10:00Z"),completedAt:new Date("2026-11-17T18:00:00Z"),meeting:{id:"original",type:"Daily",creationKey:"series",startsAt:new Date("2026-11-17T12:00:00Z")}}]);m.contexts.mockResolvedValue([{id:"current",creationKey:"series",startsAt:new Date("2026-11-18T12:00:00Z")}]);const response=await GET(new Request("https://hub.test/api/meetings/daily?status=completed"));expect(await response.json()).toMatchObject({actions:[{contextMeetingId:"original"}]});
});
it("applies the named team filter to both tasks and all summary counters",async()=>{
 const response=await GET(new Request("https://hub.test/api/meetings/daily?team=Elite%20do%20Fluxo&type=Daily"));expect(response.status).toBe(200);
 for(const [args] of [...m.actions.mock.calls,...m.count.mock.calls])expect(args.where).toMatchObject({responsibleId:"me",meeting:{organizationId:"tenant",type:"Daily",AND:[{title:{contains:"Elite",mode:"insensitive"}},{title:{contains:"Fluxo",mode:"insensitive"}}]}});
 expect(await response.json()).toMatchObject({teams:expect.arrayContaining(["Elite do Fluxo","Força Tática Financeira"])});
});
it("keeps a manager's collaborator restriction when combining search, team, status and all-scope",async()=>{
 m.access.mockResolvedValue({member:{...member,role:"MANAGER"},permissions:{canView:true,canEdit:true},modulePermissions:{MEETINGS:{canView:true}}});
 const response=await GET(new Request("https://hub.test/api/meetings/daily?scope=all&team=For%C3%A7a%20T%C3%A1tica%20Financeira&q=fechamento&status=all"));expect(response.status).toBe(200);
 for(const [args] of [...m.actions.mock.calls,...m.count.mock.calls])expect(args.where).toMatchObject({responsible:{memberships:{some:{organizationId:"tenant",OR:[{userId:"me"},{teamLeaderId:"membership"}]}}},meeting:{organizationId:"tenant",AND:expect.any(Array)},OR:expect.any(Array)});
 expect(await response.json()).toMatchObject({teamRestricted:true});
});
it("does not restrict master and administrator views to a manager's membership",async()=>{
 for(const role of ["MASTER","ADMIN"]){m.access.mockResolvedValue({member:{...member,role},permissions:{canView:true,canEdit:true},modulePermissions:{MEETINGS:{canView:true}}});expect((await GET(new Request("https://hub.test/api/meetings/daily?scope=all"))).status).toBe(200);expect(m.actions.mock.calls.at(-1)![0].where).not.toHaveProperty("responsible");expect(m.actions.mock.calls.at(-1)![0].where).not.toHaveProperty("responsibleId");}
});
it("rejects unknown team filters and does not mutate an assignment outside the visible team",async()=>{
 expect((await GET(new Request("https://hub.test/api/meetings/daily?team=unknown"))).status).toBe(400);expect(m.actions).not.toHaveBeenCalled();
 m.access.mockResolvedValue({member:{...member,role:"MANAGER"},permissions:{canView:true,canEdit:true},modulePermissions:{MEETINGS:{canView:true}}});m.visible.mockResolvedValue(null);const response=await PATCH(new Request("https://hub.test/api/meetings/daily",{method:"PATCH",body:JSON.stringify({meetingId:"meeting",id:"foreign",revision:1,completed:true})}));expect(response.status).toBe(404);expect(m.save).not.toHaveBeenCalled();
 expect(m.visible.mock.calls[0][0].where).toMatchObject({id:"foreign",responsible:{memberships:{some:{organizationId:"tenant",OR:[{userId:"me"},{teamLeaderId:"membership"}]}}},meeting:{organizationId:"tenant"}});
});
