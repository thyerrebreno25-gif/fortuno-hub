import { afterEach,beforeEach,expect,it,vi } from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permissions:vi.fn(),holiday:vi.fn(),ack:vi.fn(),save:vi.fn(),tickets:vi.fn(),tasks:vi.fn(),notices:vi.fn(),events:vi.fn(),eventCount:vi.fn(),account:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{operationHoliday:{count:m.holiday},auditLog:{findFirst:m.ack,create:m.save},serviceTicket:{count:m.tickets},operationActivity:{count:m.tasks},notice:{count:m.notices},teamCalendarEvent:{findMany:m.events,count:m.eventCount}}}));
vi.mock("@/modules/permissions/permissions",()=>({getCurrentMember:m.member,getRolePermissions:m.permissions}));
vi.mock("@/modules/whatsapp/account-scope",()=>({currentWhatsAppAccount:m.account}));
import { GET,POST } from "./route";
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-16T20:30:00Z"));m.member.mockResolvedValue({id:"membership",organizationId:"org",userId:"me",role:"OPERATOR"});m.permissions.mockResolvedValue(Object.fromEntries(["WHATSAPP","SERVICE_CENTER","OPERATIONS","NOTICES","CALENDAR"].map(key=>[key,{canView:true}])));m.holiday.mockResolvedValue(0);m.ack.mockResolvedValue(null);m.tickets.mockResolvedValue(2);m.tasks.mockResolvedValueOnce(5).mockResolvedValueOnce(1);m.notices.mockResolvedValue(3);m.events.mockResolvedValue([{id:"event",title:"Daily",startsAt:new Date("2026-11-17T12:00:00Z"),endsAt:new Date("2026-11-17T13:00:00Z"),meetingId:null}]);m.eventCount.mockResolvedValue(1);m.account.mockResolvedValue({where:{organizationId:"org",source:"WHATSAPP_API",recipientEmail:"wa-account:current"}});});
afterEach(()=>vi.useRealTimers());
it("counts only owned pending work, active account and personally targeted unread notices",async()=>{
 const r=await GET();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({eligible:true,tasks:5,overdue:1,unread:3,agendaTotal:1,tomorrow:"2026-11-17"});
 expect(m.tickets.mock.calls[0][0].where).toMatchObject({organizationId:"org",assignedToId:"me",recipientEmail:"wa-account:current",mergedIntoId:null,status:{notIn:["SPAM","RESOLVED"]}});
 expect(m.tasks.mock.calls[0][0].where).toMatchObject({organizationId:"org",responsibleId:"me",deletedAt:null,OR:expect.any(Array)});
 expect(m.tasks.mock.calls[0][0].where.OR[0].scheduledDate.lt.toISOString()).toBe("2026-11-17T00:00:00.000Z");
 expect(m.notices.mock.calls[0][0].where.recipients).toEqual({some:{memberId:"membership",viewedAt:null,completedAt:null}});
 expect(m.events.mock.calls[0][0].where).toMatchObject({organizationId:"org",userId:"me",startsAt:{lt:new Date("2026-11-18T03:00:00Z")},endsAt:{gt:new Date("2026-11-17T03:00:00Z")}});
 expect(r.headers.get("Cache-Control")).toBe("private, no-store");
});
it("does not fetch pending work on holidays, before 17h30, or after acknowledging",async()=>{
 m.holiday.mockResolvedValueOnce(1);expect((await (await GET()).json()).eligible).toBe(false);m.ack.mockResolvedValueOnce({id:"ack"});expect((await (await GET()).json()).acknowledged).toBe(true);
 vi.setSystemTime(new Date("2026-11-16T20:29:59Z"));expect((await (await GET()).json()).eligible).toBe(false);expect(m.tickets).not.toHaveBeenCalled();expect(m.events).not.toHaveBeenCalled();
});
it("does not expose modules denied to the viewer",async()=>{
 m.permissions.mockResolvedValue(Object.fromEntries(["WHATSAPP","SERVICE_CENTER","OPERATIONS","NOTICES","CALENDAR"].map(key=>[key,{canView:false}])));
 expect(await (await GET()).json()).toMatchObject({eligible:true,calls:null,email:null,tasks:null,overdue:null,unread:null,agenda:[],calendarAvailable:false});expect(m.tasks).not.toHaveBeenCalled();expect(m.account).not.toHaveBeenCalled();
});
it("rejects unauthenticated and client requests without reading work",async()=>{m.member.mockResolvedValueOnce(null);expect((await GET()).status).toBe(401);m.member.mockResolvedValueOnce({role:"CLIENT"});expect((await GET()).status).toBe(403);expect(m.tickets).not.toHaveBeenCalled();});
it("acknowledges only the authenticated user and organization, without completing anything",async()=>{
 expect((await POST()).status).toBe(200);expect(m.save.mock.calls[0][0].data).toMatchObject({userId:"me",entityId:"org",action:"END_OF_DAY_ACK",afterData:{day:"2026-11-16"}});expect(m.tasks).not.toHaveBeenCalled();
});
