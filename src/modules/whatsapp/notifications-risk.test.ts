import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({live:vi.fn(),account:vi.fn()}));
vi.mock("./account-scope",()=>({currentWhatsAppAccount:m.account}));vi.mock("./monitoring-live",()=>({liveMonitoringTickets:m.live}));vi.mock("./operation-start",()=>({operationStartedAt:async()=>null}));vi.mock("./payment-requests",()=>({paymentRequestNotifications:async()=>[]}));vi.mock("@/lib/prisma",()=>({prisma:{}}));
import {whatsappManagerRiskNotifications} from "./notifications";
beforeEach(()=>{vi.clearAllMocks();m.account.mockResolvedValue({recipient:"wa-account:c:5511",connection:{phone:"5511"}});m.live.mockResolvedValue([]);});
it("produces a stable managerial warning for urgent unanswered calls without exposing raw customer text",async()=>{
 const date=new Date("2026-11-16T15:00:00Z");m.live.mockResolvedValue([{id:"t",contact:"Grupo",client:"Cliente",assigneeId:"op",assignee:"Operador",status:"IN_PROGRESS",receivedAt:date,assignedAt:date,firstResponseAt:date,pendingSince:date,pendingText:"URGENTE preciso pagar o valor confidencial 99999",lastMessageId:"m",lastMessageAt:date}]);
 const result=await whatsappManagerRiskNotifications("org",date);expect(result[0]).toMatchObject({id:"whatsapp-risk-t-m-CRITICAL",type:"ERROR",href:"/whatsapp?ticket=t",priority:5});expect(result[0].description).toContain("urgente");expect(result[0].description).not.toContain("99999");expect(m.live).toHaveBeenCalledWith("org","wa-account:c:5511","5511",null);
});
it("stops producing risk notifications after the call leaves the live backlog or the account disconnects",async()=>{expect(await whatsappManagerRiskNotifications("org")).toEqual([]);m.account.mockResolvedValueOnce({recipient:null});expect(await whatsappManagerRiskNotifications("org")).toEqual([]);expect(m.live).toHaveBeenCalledOnce();});
