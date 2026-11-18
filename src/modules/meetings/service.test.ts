import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  tx: { notice: {updateMany: vi.fn()}, $executeRaw: vi.fn(), $queryRaw: vi.fn(), teamMeeting: { findUniqueOrThrow: vi.fn(), findMany: vi.fn(), createManyAndReturn: vi.fn(), create: vi.fn(), updateMany: vi.fn() }, meetingActionItem: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() }, meetingParticipant: { deleteMany: vi.fn(), createMany: vi.fn() }, teamCalendarEvent: { createMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() }, meetingDelivery: { updateMany: vi.fn(), createMany: vi.fn(), create: vi.fn() } }, members: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { organizationMember: { count: mocks.members }, $transaction: (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx) } }));
vi.mock("./auth", () => ({ findMeeting: mocks.find, MeetingError: class extends Error { constructor(message: string, public status = 400) { super(message); } } }));
import { saveAction, saveMeeting } from "./service";
const member = { id: "member", userId: "a", organizationId: "org", role: "OPERATOR" as const, isTeamLeader: false, teamLeaderId: null, user: { id: "a", name: "A", email: "a@example.com" } };
const meeting = { id: "m", organizationId: "org", createdById: "a", title: "Semanal", type: "Semanal", startsAt: new Date("2026-10-26T12:00:00Z"), endsAt: new Date("2026-10-26T13:00:00Z"), agenda: "", location: "", status: "SCHEDULED", revision: 1, participants: [{ userId: "a" }, { userId: "b" }] };
const action = { id: "task", meetingId: "m", title: "Entregar relatório", description: "", responsibleId: "b", dueAt: new Date("2026-10-30T20:00:00Z"), completedAt: null, revision: 1 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.tx.$queryRaw.mockReset().mockResolvedValue([]); mocks.tx.$executeRaw.mockReset().mockResolvedValue(1); mocks.find.mockResolvedValue(meeting); mocks.members.mockResolvedValue(2);
  mocks.tx.teamMeeting.findMany.mockResolvedValue([]);
  mocks.tx.teamMeeting.createManyAndReturn.mockImplementation(async ({data}) => data.map((row: object) => ({...meeting,...row,revision:1})));
  mocks.tx.teamMeeting.create.mockResolvedValue(meeting); mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue(meeting); mocks.tx.teamMeeting.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.meetingActionItem.count.mockResolvedValue(0); mocks.tx.meetingActionItem.findFirst.mockResolvedValue(action); mocks.tx.meetingActionItem.create.mockResolvedValue(action); mocks.tx.meetingActionItem.updateMany.mockResolvedValue({ count: 1 }); mocks.tx.meetingActionItem.findUniqueOrThrow.mockResolvedValue(action); mocks.tx.meetingActionItem.findMany.mockResolvedValue([]);
});
it("creates individual calendar events for participants and queues invitations", async () => {
  await saveMeeting(member, { ...meeting, startsAt: meeting.startsAt.toISOString(), endsAt: meeting.endsAt.toISOString(), participantIds: ["a", "b"] });
  expect(mocks.tx.teamCalendarEvent.createMany.mock.calls[0][0].data).toHaveLength(2);
  expect(mocks.tx.teamCalendarEvent.createMany.mock.calls[0][0].data).toEqual(expect.arrayContaining([expect.objectContaining({ organizationId: "org", userId: "b", sourceKey: expect.stringMatching(/^meeting:/) })]));
  expect(mocks.tx.meetingDelivery.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ userId: "b", meetingId: expect.any(String) })]) }));
});
it("rejects participants outside the organization before saving", async () => {
  mocks.members.mockResolvedValue(1);
  await expect(saveMeeting(member, { ...meeting, startsAt: meeting.startsAt.toISOString(), endsAt: meeting.endsAt.toISOString(), participantIds: ["a", "outside"] })).rejects.toThrow("organização");
  expect(mocks.tx.teamMeeting.create).not.toHaveBeenCalled();
});
it("transfers a delivery by cancelling the old owner's event", async () => {
  await saveAction(member, "m", { title: action.title, responsibleId: "b", dueAt: action.dueAt.toISOString() });
  expect(mocks.tx.teamCalendarEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { actionItemId: "task", userId: { not: "b" } }, data: expect.objectContaining({ status: "CANCELLED" }) }));
  expect(mocks.tx.teamCalendarEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ userId: "b", actionItemId: "task", startsAt: action.dueAt }) }));
});
it("marks a checked delivery completed in the agenda and stops reminder emails", async () => {
  mocks.tx.meetingActionItem.findUniqueOrThrow.mockResolvedValue({ ...action, completedAt: new Date(), revision: 2 });
  await saveAction(member, "m", { completed: true, revision: 1 }, "task");
  expect(mocks.tx.teamCalendarEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: "COMPLETED" }) }));
  expect(mocks.tx.meetingDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { actionItemId: "task", emailStatus: "PENDING" } }));
  expect(mocks.tx.meetingDelivery.create).not.toHaveBeenCalled();
});
it("prevents a collaborator from checking somebody else's goal", async () => {
  mocks.find.mockResolvedValue({ ...meeting, createdById: "other" }); mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue({ ...meeting, createdById: "other" });
  await expect(saveAction(member, "m", { completed: true, revision: 1 }, "task")).rejects.toThrow("responsável");
  expect(mocks.tx.teamCalendarEvent.upsert).not.toHaveBeenCalled();
});
it("rejects stale checklist revisions without changing the agenda", async () => {
  mocks.tx.meetingActionItem.updateMany.mockResolvedValue({ count: 0 });
  await expect(saveAction(member, "m", { completed: true, revision: 1 }, "task")).rejects.toThrow("alterada");
  expect(mocks.tx.teamCalendarEvent.upsert).not.toHaveBeenCalled();
});
it("cancels the meeting's linked events", async () => {
  mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue({ ...meeting, status: "CANCELLED", revision: 2 });
  await saveMeeting(member, { ...meeting, startsAt: meeting.startsAt.toISOString(), endsAt: meeting.endsAt.toISOString(), participantIds: ["a", "b"], status: "CANCELLED", revision: 1 }, "m");
  expect(mocks.tx.teamCalendarEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { meetingId: "m" }, data: expect.objectContaining({ status: "CANCELLED" }) }));
});

const payload = { title: "Daily", type: "Daily", startsAt: "2026-11-16T09:00:00-03:00", endsAt: "2026-11-16T09:30:00-03:00", participantIds: ["a","b"], creationKey: "7fae5ebd-3d35-4651-bcad-e86b30c032a9" };
it("allows the current responsible operator to designate another responsible and includes them as a participant",async()=>{
 const current={...meeting,createdById:"master",responsibleId:"a"};mocks.find.mockResolvedValue(current);mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue(current);
 await saveMeeting(member,{...payload,responsibleId:"b",revision:1},"m");expect(mocks.tx.teamMeeting.updateMany.mock.calls[0][0].data.responsibleId).toBe("b");expect(mocks.tx.meetingParticipant.createMany.mock.calls[0][0].data).toContainEqual({meetingId:"m",userId:"b"});
});
it("prevents a plain participant from delegating or retaining organizer rights after responsibility changes concurrently",async()=>{
 const current={...meeting,createdById:"master",responsibleId:"b"};mocks.find.mockResolvedValue(current);
 await expect(saveMeeting(member,{...payload,responsibleId:"a",revision:1},"m")).rejects.toMatchObject({status:403});
 mocks.find.mockResolvedValue({...current,responsibleId:"a"});mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue(current);
 await expect(saveMeeting(member,{...payload,responsibleId:"b",revision:1},"m")).rejects.toMatchObject({status:403});expect(mocks.tx.teamMeeting.updateMany).not.toHaveBeenCalled();
});
it("completes a carried task using its original ID, revision, notice and calendar event under the new Daily responsible",async()=>{
 const current={...meeting,type:"Daily",creationKey:"series",createdById:"master",responsibleId:"a",startsAt:new Date("2026-11-17T12:00:00Z")};mocks.find.mockResolvedValue(current);mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue(current);
 const carried={...action,meetingId:"prior",overdueNoticeId:"notice"};mocks.tx.meetingActionItem.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(carried).mockResolvedValueOnce(carried);mocks.tx.meetingActionItem.findUniqueOrThrow.mockResolvedValue({...carried,completedAt:new Date(),revision:2});
 await saveAction(member,"m",{completed:true,revision:1},"task");
 expect(mocks.tx.meetingActionItem.updateMany.mock.calls[0][0].where).toEqual({id:"task",meetingId:"prior",revision:1});expect(mocks.tx.meetingActionItem.create).not.toHaveBeenCalled();expect(mocks.tx.teamCalendarEvent.upsert.mock.calls[0][0].create).toMatchObject({meetingId:"prior",actionItemId:"task",sourceKey:"action:task"});expect(mocks.tx.notice.updateMany).toHaveBeenCalled();expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(2);
 expect(mocks.tx.meetingActionItem.findFirst.mock.calls[1][0].where.meeting).toMatchObject({organizationId:"org",creationKey:"series",type:"Daily",deletedAt:null});
});
it("does not let participants complete another person's carried action or use IDs outside this series",async()=>{
 const current={...meeting,type:"Daily",creationKey:"series",createdById:"master",responsibleId:"other",startsAt:new Date("2026-11-17T12:00:00Z")};mocks.find.mockResolvedValue(current);mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue(current);
 mocks.tx.meetingActionItem.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(action).mockResolvedValueOnce(action);await expect(saveAction(member,"m",{completed:true,revision:1},"task")).rejects.toMatchObject({status:403});expect(mocks.tx.meetingActionItem.updateMany).not.toHaveBeenCalled();
 mocks.tx.meetingActionItem.findFirst.mockResolvedValue(null);await expect(saveAction(member,"m",{completed:true,revision:1},"foreign-task")).rejects.toMatchObject({status:404});
});
it("preserves the one-time extension rule and detects stale revisions when editing carried work",async()=>{
 const current={...meeting,type:"Daily",creationKey:"series",startsAt:new Date("2026-11-17T12:00:00Z")};mocks.find.mockResolvedValue(current);mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue(current);
 const carried={...action,meetingId:"prior",autoExtendedAt:new Date()};mocks.tx.meetingActionItem.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(carried).mockResolvedValueOnce(carried);
 await expect(saveAction(member,"m",{title:action.title,responsibleId:"b",dueAt:"2026-12-01T18:00:00Z",revision:1},"task")).rejects.toThrow("única prorrogação");
 mocks.tx.meetingActionItem.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(carried).mockResolvedValueOnce(carried);mocks.tx.meetingActionItem.updateMany.mockResolvedValueOnce({count:0});
 await expect(saveAction(member,"m",{completed:true,revision:1},"task")).rejects.toMatchObject({status:409});expect(mocks.tx.teamCalendarEvent.upsert).not.toHaveBeenCalled();
});
it("creates a separate meeting and participant events for every selected Thursday and Friday", async () => {
  const result = await saveMeeting({...member,role:"MASTER"}, {...payload,responsibleId:"b",recurrence:{frequency:"WEEKLY",weekdays:[4,5],until:"2026-11-27"}});
  expect(result.createdCount).toBe(4);
  const rows=mocks.tx.teamMeeting.createManyAndReturn.mock.calls[0][0].data;
  expect(new Set(rows.map((row:{id:string})=>row.id)).size).toBe(4);
  expect(rows.map((row:{startsAt:Date})=>row.startsAt.toISOString())).toEqual(["2026-11-19T12:00:00.000Z","2026-11-20T12:00:00.000Z","2026-11-26T12:00:00.000Z","2026-11-27T12:00:00.000Z"]);
  expect(rows.every((row:{responsibleId:string;createdById:string})=>row.responsibleId==="b"&&row.createdById==="a")).toBe(true);
  expect(mocks.tx.teamCalendarEvent.createMany.mock.calls[0][0].data).toHaveLength(8);
  expect(mocks.tx.meetingDelivery.createMany.mock.calls[0][0].data).toHaveLength(8);
});
it("allows the Master to schedule for someone else without adding the Master to their agenda",async()=>{
  mocks.members.mockResolvedValue(1);
  await saveMeeting({...member,role:"MASTER"},{...payload,responsibleId:"b",participantIds:["b"]});
  const rows=mocks.tx.teamCalendarEvent.createMany.mock.calls[0][0].data;
  expect(rows.map((row:{userId:string})=>row.userId)).toEqual(["b"]);
  expect(mocks.tx.teamMeeting.createManyAndReturn.mock.calls[0][0].data[0]).toMatchObject({createdById:"a",responsibleId:"b"});
});
it("rejects responsibility delegation by an ordinary operator and validates the responsible member",async()=>{
  await expect(saveMeeting(member,{...payload,responsibleId:"b"})).rejects.toMatchObject({status:403});
  mocks.members.mockResolvedValue(1);
  await expect(saveMeeting({...member,role:"MASTER"},{...payload,responsibleId:"foreign"})).rejects.toThrow("organização");
  expect(mocks.tx.teamMeeting.createManyAndReturn).not.toHaveBeenCalled();
});
it("replays the same creation without duplicating meetings, calendars or invitations",async()=>{
  const first=await saveMeeting(member,payload);
  mocks.tx.teamMeeting.findMany.mockResolvedValue([first]);
  const again=await saveMeeting(member,payload);
  expect(again.id).toBe(first.id);
  expect(mocks.tx.teamMeeting.createManyAndReturn).toHaveBeenCalledTimes(1);
  expect(mocks.tx.teamCalendarEvent.createMany).toHaveBeenCalledTimes(1);
  await expect(saveMeeting(member,{...payload,title:"Changed"})).rejects.toMatchObject({status:409});
});
it("does not regenerate a series while editing one occurrence",async()=>{
  await expect(saveMeeting(member,{...payload,revision:1,recurrence:{frequency:"DAILY",until:"2026-11-18"}},"m")).rejects.toThrow("ocorrência");
  expect(mocks.tx.teamMeeting.createManyAndReturn).not.toHaveBeenCalled();
});

it("creates all 79 meetings and 395 participant commitments without decoding the void lock result",async()=>{
  mocks.members.mockResolvedValue(5);
  mocks.tx.$queryRaw.mockRejectedValueOnce(Error("Unsupported column type void"));
  const result=await saveMeeting({...member,role:"MASTER"},{...payload,responsibleId:"b",participantIds:["a","b","c","d","e"],recurrence:{frequency:"WEEKLY",weekdays:[1,2,3,4,5],until:"2027-03-04"}});
  expect(result.createdCount).toBe(79);
  expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1);
  expect(mocks.tx.$queryRaw).not.toHaveBeenCalled();
  expect(mocks.tx.teamMeeting.createManyAndReturn.mock.calls[0][0].data).toHaveLength(79);
  expect(mocks.tx.teamCalendarEvent.createMany.mock.calls[0][0].data).toHaveLength(395);
  expect(mocks.tx.meetingDelivery.createMany.mock.calls[0][0].data).toHaveLength(395);
});

it("lets the designated meeting responsible assign an action to any participant",async()=>{
 const responsibleMeeting={...meeting,createdById:"else",responsibleId:"a"};mocks.find.mockResolvedValue(responsibleMeeting);mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue(responsibleMeeting);
 await saveAction(member,"m",{title:"Atividade atribuída",responsibleId:"b",dueAt:"2026-12-01T18:00:00Z"});
 expect(mocks.tx.meetingActionItem.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({responsibleId:"b"})}));
});
it("closes the real overdue Aviso when the action is completed from either screen",async()=>{
 mocks.tx.meetingActionItem.findFirst.mockResolvedValue({...action,overdueNoticeId:"notice"});
 mocks.tx.meetingActionItem.findUniqueOrThrow.mockResolvedValue({...action,completedAt:new Date()});
 await saveAction(member,"m",{completed:true,revision:1},"task");
 expect(mocks.tx.notice.updateMany).toHaveBeenCalledWith({where:{id:"notice",organizationId:"org"},data:{closedAt:expect.any(Date)}});
});
it("denies a fresh manual Daily postponement after the automatic extension",async()=>{
 mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue({...meeting,type:"Daily"});
 mocks.tx.meetingActionItem.findFirst.mockResolvedValue({...action,autoExtendedAt:new Date()});
 await expect(saveAction(member,"m",{title:action.title,responsibleId:"b",dueAt:"2026-12-01T18:00:00Z",revision:1},"task")).rejects.toThrow("única prorrogação");
 expect(mocks.tx.meetingActionItem.updateMany).not.toHaveBeenCalled();
});
