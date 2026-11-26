import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ assignments:vi.fn(),bulkUpdate:vi.fn(),running:vi.fn(),stop:vi.fn(),events:vi.fn(),tx: vi.fn(), lock: vi.fn(), config: vi.fn(), others: vi.fn(), updateConfig: vi.fn(), activities: vi.fn(), update: vi.fn(), create: vi.fn(), holidays: vi.fn(), event: vi.fn(), member: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.tx, organizationMember: { findFirst: m.member } } }));
vi.mock("./auth", () => ({ canManageOperations: (role: string) => ["MASTER", "ADMIN", "MANAGER"].includes(role) }));
vi.mock("./team-catalog", () => ({ operationTeamCatalog: async () => ({ options: ["Equipe A"] }) }));
import { editRoutine } from "./routine-edit-server";
import { ROUTINE_EDIT_REMOVAL } from "./routine-edit-plan";
import type { RoutineEdit } from "./edit-model";
const member = { userId: "manager", organizationId: "org", role: "MANAGER", canEdit: true, user: { name: "Gestora", email: "m@test" } } as never;
const input: RoutineEdit = { expectedUpdatedAt: "2026-11-23T12:00:00.000Z", responsibleId: null, team: null, priority: "MEDIUM", notifyClient: true, auditEnabled: false, recurrenceType: "ONCE", recurrenceData: { startDate: "2026-11-24", endDate: null, dueTime: "18:00", interval: 1, weekdays: [], monthDays: [], dailyMode: "ALL_DAYS", holidayBehavior: "KEEP" } };
const row = (id: string, day = "2026-11-23") => ({ id, scheduledDate: new Date(day + "T00:00:00Z"), status: "OPEN", deletedAt: null, deletionReason: null, disregardReview: null, timeEntries: [], comments: [], attachments: [], checklistItems: [] });
beforeEach(() => {
  vi.resetAllMocks(); m.lock.mockResolvedValue([]); m.assignments.mockResolvedValue([]);m.running.mockResolvedValue([]);m.stop.mockResolvedValue({count:1});m.bulkUpdate.mockResolvedValue({count:0});vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-23T15:00:00Z"));
  m.config.mockResolvedValue({ id: "routine", responsibleId:null, updatedAt: new Date(input.expectedUpdatedAt), clientId: "client", processId: "process", client: { cluster: "A" }, process: { name: "Conciliação", department: "Financeiro", description: null, subjectToFine: false, checklistTemplates: [] } });
  m.others.mockResolvedValue([]); m.activities.mockResolvedValue([]); m.holidays.mockResolvedValue([]); m.member.mockResolvedValue({ id: "operator-member" });
  m.tx.mockImplementation(async run => run({ organizationMember:{findFirst:m.member}, $executeRaw: m.lock, $queryRaw: m.lock, operationClientProcess: { findFirst: m.config, findMany: m.others, update: m.updateConfig }, operationActivity: { findMany: (args:{where:{scheduledDate?:unknown}})=>args.where.scheduledDate?m.activities(args):m.assignments(args), update: m.update, updateMany:m.bulkUpdate, create: m.create }, operationTimeEntry:{findMany:m.running,updateMany:m.stop}, operationHoliday: { findMany: m.holidays }, operationEvent: { create: m.event,createMany:m.events } }));
});
afterEach(() => vi.useRealTimers());
it("removes only untouched future dates and preserves completed or worked tasks when rescheduling", async () => {
  m.activities.mockResolvedValue([row("untouched"), { ...row("worked"), timeEntries: [{ id: "entry" }] }, { ...row("complete"), status: "COMPLETED" }]);
  expect(await editRoutine(member, "routine", input)).toEqual({ updated: 0, removed: 1, created: 1, preserved: 2, transferred:0, pausedTimers:0 });
  expect(m.update.mock.calls[0][0]).toMatchObject({ where: { id: "untouched" }, data: { deletionReason: ROUTINE_EDIT_REMOVAL } });
  expect(m.create.mock.calls[0][0].data).toMatchObject({ clientProcessId: "routine", organizationId: "org", scheduledDate: new Date("2026-11-24T00:00:00Z"), dueAt: new Date("2026-11-24T21:00:00Z") });
  expect(m.activities.mock.calls[0][0].where).toMatchObject({ clientProcessId: "routine", organizationId: "org", scheduledDate: { gte: new Date("2026-11-23T00:00:00Z") } });
});
it("never resurrects manually deleted activities but can restore a day removed by a previous schedule edit", async () => {
  m.activities.mockResolvedValue([{ ...row("manual", "2026-11-24"), deletedAt: new Date(), deletionReason: "Exclusão manual" }]);
  expect(await editRoutine(member, "routine", input)).toMatchObject({ preserved: 1, created: 0, updated: 0 }); expect(m.update).not.toHaveBeenCalled();
  m.activities.mockResolvedValue([{ ...row("schedule", "2026-11-24"), deletedAt: new Date(), deletionReason: ROUTINE_EDIT_REMOVAL }]);
  expect(await editRoutine(member, "routine", input)).toMatchObject({ updated: 1, created: 0 }); expect(m.update.mock.calls[0][0].data.deletedAt).toBeNull();
});
it("refuses concurrent routine edits and a schedule already belonging to another configuration", async () => {
  await expect(editRoutine(member, "routine", { ...input, expectedUpdatedAt: "2026-11-22T12:00:00.000Z" })).rejects.toMatchObject({ status: 409 });
  m.others.mockResolvedValue([{ id: "other", recurrenceType: input.recurrenceType, recurrenceData: input.recurrenceData }]); await expect(editRoutine(member, "routine", input)).rejects.toMatchObject({ status: 409 });
  expect(m.updateConfig).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});
it("does not let operators, read-only profiles, foreign people or arbitrary teams edit routines", async () => {
  await expect(editRoutine({ ...member as object, role: "OPERATOR" } as never, "routine", input)).rejects.toMatchObject({ status: 403 });
  await expect(editRoutine({ ...member as object, canEdit: false } as never, "routine", input)).rejects.toMatchObject({ status: 403 });
  await expect(editRoutine(member, "routine", { ...input, team: "Inventada" })).rejects.toMatchObject({ status: 400 });
  m.member.mockResolvedValue(null); await expect(editRoutine(member, "routine", { ...input, responsibleId: "foreign" })).rejects.toMatchObject({ status: 400 }); expect(m.tx).not.toHaveBeenCalled();
});
it("transfers all existing tasks of the edited routine, including old, closed and worked tasks",async()=>{
 m.assignments.mockResolvedValue([{id:"overdue",responsibleId:"old"},{id:"running",responsibleId:"old"},{id:"completed",responsibleId:"old"},{id:"disregarded",responsibleId:"old"},{id:"unassigned",responsibleId:null},{id:"already-new",responsibleId:"new"}]);
 m.bulkUpdate.mockResolvedValueOnce({count:5}).mockResolvedValueOnce({count:1});
 m.running.mockResolvedValue([{id:"timer",activityId:"running",startedAt:new Date("2026-11-23T14:15:00Z")}]);
 const result=await editRoutine(member,"routine",{...input,responsibleId:"new"});
 expect(result).toMatchObject({transferred:5,pausedTimers:1});
 expect(m.assignments.mock.calls[0][0].where).toEqual({organizationId:"org",clientProcessId:"routine",deletedAt:null});
 const transfer=m.bulkUpdate.mock.calls[0][0];expect(transfer).toEqual({where:{organizationId:"org",clientProcessId:"routine",deletedAt:null,id:{in:["overdue","running","completed","disregarded","unassigned"]}},data:{responsibleId:"new"}});
 expect(m.stop.mock.calls[0][0]).toEqual({where:{id:"timer",activityId:"running",endedAt:null},data:{endedAt:new Date("2026-11-23T15:00:00Z"),seconds:2700}});
 expect(m.bulkUpdate.mock.calls[1][0]).toMatchObject({where:{clientProcessId:"routine",organizationId:"org",status:"IN_PROGRESS",timeEntries:{none:{endedAt:null}}},data:{status:"PAUSED"}});
 expect(m.events.mock.calls[0][0].data).toHaveLength(5);expect(m.events.mock.calls[0][0].data.find((event:{activityId:string})=>event.activityId==="completed")).toMatchObject({type:"ASSIGNED",metadata:{fromResponsibleId:"old",toResponsibleId:"new",routineId:"routine"}});
 const activityLocks=m.lock.mock.calls.filter(call=>(Array.isArray(call[0])?call[0].join(""):call[0].sql||"").includes('FROM "OperationActivity"'));expect(activityLocks[0][0].join("")).not.toContain('"scheduledDate"');
});
it("leaves task ownership and running timers alone when only editing the schedule",async()=>{
 await editRoutine(member,"routine",input);expect(m.assignments).not.toHaveBeenCalled();expect(m.running).not.toHaveBeenCalled();expect(m.events).not.toHaveBeenCalled();
});
it("applies the inherited client responsible to every task when the explicit routine responsible is cleared",async()=>{
 const configuration=await m.config();m.config.mockResolvedValue({...configuration,responsibleId:"old",client:{cluster:"A",generalResponsibleId:"default"}});
 m.assignments.mockResolvedValue([{id:"past",responsibleId:"old"}]);m.bulkUpdate.mockResolvedValueOnce({count:1});
 expect(await editRoutine(member,"routine",input)).toMatchObject({transferred:1});expect(m.bulkUpdate.mock.calls[0][0].data).toEqual({responsibleId:"default"});
});
it("rejects an incomplete ownership update so the routine edit rolls back atomically",async()=>{
 m.assignments.mockResolvedValue([{id:"task",responsibleId:"old"}]);m.bulkUpdate.mockResolvedValueOnce({count:0});
 await expect(editRoutine(member,"routine",{...input,responsibleId:"new"})).rejects.toMatchObject({status:409});expect(m.events).not.toHaveBeenCalled();
});
it("revalidates the new responsible inside the transaction before transferring any task",async()=>{
 m.member.mockResolvedValueOnce({id:"membership"}).mockResolvedValueOnce(null);
 await expect(editRoutine(member,"routine",{...input,responsibleId:"new"})).rejects.toMatchObject({status:409});expect(m.bulkUpdate).not.toHaveBeenCalled();expect(m.updateConfig).not.toHaveBeenCalled();
});
