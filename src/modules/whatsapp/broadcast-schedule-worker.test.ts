import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({raw:vi.fn(),execute:vi.fn(),member:vi.fn(),permission:vi.fn(),deliveries:vi.fn(),counts:vi.fn(),send:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{$queryRaw:m.raw,$executeRaw:m.execute,organizationMember:{findFirst:m.member},whatsAppBatchDelivery:{findMany:m.deliveries,groupBy:m.counts}}}));
vi.mock("@/modules/atendimento/auth",()=>({getWhatsAppPermission:m.permission}));vi.mock("./batch-send",()=>({deliverBatchMessage:m.send}));
import {processScheduledBroadcasts} from "./broadcast-schedule-worker";
const job={id:"job",organizationId:"org",userId:"operator",status:"RUNNING",scheduledAt:new Date("2026-11-26T16:00Z"),acknowledgedIds:[]};
beforeEach(()=>{vi.resetAllMocks();m.raw.mockResolvedValueOnce([{id:"job"}]).mockResolvedValueOnce([job]);m.execute.mockResolvedValue(1);m.member.mockResolvedValue({organizationId:"org",userId:"operator",role:"OPERATOR",user:{name:"Original operator",email:"op@test"}});m.permission.mockResolvedValue({canView:true,canEdit:true});m.deliveries.mockResolvedValueOnce([]).mockResolvedValueOnce([{id:"pending"}]);m.counts.mockResolvedValue([{status:"SENT",_count:{_all:1}}]);m.send.mockResolvedValue(new Response(JSON.stringify({status:"SENT"}),{status:200}));});
it("starts only due jobs under an atomic shared lease and sends as the original authorized operator",async()=>{
 await processScheduledBroadcasts(new Date("2026-11-26T16:00Z"));expect(m.raw.mock.calls[0][0].sql).toContain('"scheduledAt"<=');expect(m.raw.mock.calls[1][0].sql).toContain("RETURNING *");
 expect(m.send).toHaveBeenCalledWith("pending",expect.objectContaining({organizationId:"org",userId:"operator"}),{scheduleId:"job",leaseId:expect.any(String)});expect(m.execute.mock.calls.at(-1)![0].values).toContain("COMPLETED");
});
it("losing workers and cancelled jobs cannot claim or dispatch another copy",async()=>{
 m.raw.mockReset();m.raw.mockResolvedValueOnce([{id:"job"}]).mockResolvedValueOnce([]);await processScheduledBroadcasts();expect(m.send).not.toHaveBeenCalled();
 m.raw.mockResolvedValueOnce([{id:"job"}]).mockResolvedValueOnce([job]);m.execute.mockResolvedValueOnce(0);await processScheduledBroadcasts();expect(m.send).not.toHaveBeenCalled();
});
it("does not retry unknown outcomes or crashed sending records without explicit acknowledgement",async()=>{
 m.deliveries.mockReset();m.deliveries.mockResolvedValueOnce([{id:"orphan"}]);await processScheduledBroadcasts();expect(m.send).not.toHaveBeenCalled();expect(m.execute.mock.calls.at(-1)![0].values).toContain("PAUSED");
});
it("pauses on missing permission or connection errors without consuming pending recipients",async()=>{
 m.permission.mockResolvedValueOnce({canView:true,canEdit:false});await processScheduledBroadcasts();expect(m.send).not.toHaveBeenCalled();expect(m.execute.mock.calls.at(-1)![0].values).toContain("PAUSED");
});
it("pauses the remaining batch when one provider outcome is uncertain instead of continuing blindly",async()=>{
 m.deliveries.mockReset();m.deliveries.mockResolvedValueOnce([]).mockResolvedValueOnce([{id:"first"},{id:"second"}]);m.send.mockResolvedValueOnce(new Response(JSON.stringify({status:"UNKNOWN",error:"Confira a conversa"}),{status:200}));await processScheduledBroadcasts();expect(m.send).toHaveBeenCalledTimes(1);expect(m.counts).not.toHaveBeenCalled();expect(m.execute.mock.calls.at(-1)![0].values).toEqual(expect.arrayContaining(["PAUSED","Confira a conversa"]));
});
it("processes acknowledged uncertainty only by skipping it and continuing the pending recipients",async()=>{
 m.raw.mockReset();m.raw.mockResolvedValueOnce([{id:"job"}]).mockResolvedValueOnce([{...job,acknowledgedIds:["unknown"]}]);m.deliveries.mockReset();m.deliveries.mockResolvedValueOnce([{id:"unknown"}]).mockResolvedValueOnce([{id:"remaining"}]);m.counts.mockResolvedValue([{status:"SENT",_count:{_all:1}},{status:"UNKNOWN",_count:{_all:1}}]);await processScheduledBroadcasts();expect(m.send.mock.calls.map(c=>c[0])).toEqual(["remaining"]);expect(m.execute.mock.calls.at(-1)![0].values).toContain("PARTIAL");
});
