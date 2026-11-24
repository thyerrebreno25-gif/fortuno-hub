import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),member:vi.fn(),permissions:vi.fn(),build:vi.fn(),audit:vi.fn(),fetch:vi.fn(),encrypt:vi.fn(),decrypt:vi.fn()}));
vi.mock("@/lib/prisma",()=>{const tx={$queryRaw:m.query,$executeRaw:m.execute,auditLog:{create:m.audit}};return {prisma:{...tx,organizationMember:{findFirst:m.member},$transaction:(fn:(t:typeof tx)=>unknown)=>fn(tx)}};});
vi.mock("@/modules/permissions/permissions",()=>({getRolePermissions:m.permissions}));
vi.mock("./operator-report-server",()=>({buildOperatorDayReport:m.build}));
vi.mock("@/modules/purchase-invoices/server/crypto",()=>({encryptIntegrationSecret:m.encrypt,decryptIntegrationSecret:m.decrypt}));
import {chatRequestId,postReportPart,processDailyOperatorReports,saveReportConfig} from "./operator-report-delivery";
const webhook="https://chat.googleapis.com/v1/spaces/managers/messages?key=private-key&token=private-token";
const config={organizationId:"org",revision:"revision",configuredById:"master",destinationName:"Gestores",webhookEncrypted:"encrypted",enabled:true,updatedAt:new Date("2026-11-23T12:00Z")};
const snapshot={day:"2026-11-23",generatedAt:"2026-11-24T11:00Z",scope:"Todos",available:{whatsapp:true,operations:true,daily:true},warnings:[],rows:[]};
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal("fetch",m.fetch);m.fetch.mockResolvedValue(new Response(JSON.stringify({name:"spaces/managers/messages/confirmed"}),{status:200}));m.execute.mockResolvedValue(1);m.member.mockResolvedValue({id:"membership",userId:"master",organizationId:"org",role:"MASTER"});m.permissions.mockResolvedValue(Object.fromEntries(["MANAGEMENT","WHATSAPP","OPERATIONS","DAILY_ACTIVITIES"].map(key=>[key,{canView:true,canManage:true}])));m.build.mockResolvedValue(snapshot);m.encrypt.mockReturnValue("encrypted");m.decrypt.mockReturnValue(webhook);m.query.mockResolvedValue([]);});
it("does nothing before 08h Brasília or without a configured destination",async()=>{
 await processDailyOperatorReports(new Date("2026-11-24T10:59:59Z"));expect(m.query).not.toHaveBeenCalled();
 await processDailyOperatorReports(new Date("2026-11-24T11:00:00Z"));expect(m.fetch).not.toHaveBeenCalled();
});
it("freezes yesterday's report once, claims a database lease and persists confirmation",async()=>{
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([]).mockResolvedValueOnce([{messages:["frozen report"],sentParts:0}]);
 await processDailyOperatorReports(new Date("2026-11-24T11:00:00Z"));
 expect(m.build).toHaveBeenCalledWith(expect.objectContaining({organizationId:"org"}),"2026-11-23",expect.any(Date));
 expect(m.query.mock.calls[2][0].sql).toContain("leaseUntil");expect(m.query.mock.calls[2][0].sql).toContain("attempts<8");
 expect(m.execute.mock.calls[0][0].sql).toContain("ON CONFLICT");expect(m.fetch).toHaveBeenCalledOnce();
 const [url,options]=m.fetch.mock.calls[0];expect(url.searchParams.get("requestId")).toBe(chatRequestId("org","2026-11-23",0));expect(JSON.parse(options.body).text).toBe("frozen report");
 expect(m.execute.mock.calls.at(-1)![0].sql).toContain("status='SENT'");
});
it("resumes frozen parts after an uncertain delivery using the same request id and never rebuilds",async()=>{
 const existing={status:"FAILED",configRevision:"revision",snapshot};
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([existing]).mockResolvedValueOnce([{messages:["already confirmed","same frozen second"],sentParts:1}]);
 m.fetch.mockRejectedValueOnce(new Error("network error private-token"));
 await processDailyOperatorReports(new Date("2026-11-24T11:10Z"));expect(m.build).not.toHaveBeenCalled();expect(m.execute.mock.calls.at(-1)![0].values.join(" ")).not.toContain("private-token");
 const firstId=m.fetch.mock.calls[0][0].searchParams.get("requestId");
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([existing]).mockResolvedValueOnce([{messages:["already confirmed","same frozen second"],sentParts:1}]);
 await processDailyOperatorReports(new Date("2026-11-24T11:15Z"));expect(m.fetch.mock.calls[1][0].searchParams.get("requestId")).toBe(firstId);expect(JSON.parse(m.fetch.mock.calls[1][1].body).text).toBe("same frozen second");
});
it("does not send when another worker owns the lease, permissions were removed or the destination changed",async()=>{
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([{status:"READY",configRevision:"revision",snapshot}]).mockResolvedValueOnce([]);
 await processDailyOperatorReports(new Date("2026-11-24T11:00Z"));expect(m.fetch).not.toHaveBeenCalled();
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([{status:"FAILED",configRevision:"old",snapshot}]);await processDailyOperatorReports(new Date("2026-11-24T11:01Z"));expect(m.fetch).not.toHaveBeenCalled();
 m.member.mockResolvedValueOnce(null);m.query.mockResolvedValueOnce([config]);await processDailyOperatorReports(new Date("2026-11-24T11:02Z"));expect(m.fetch).not.toHaveBeenCalled();
});
it("stores only encrypted webhooks, omits secrets from configuration/audit and never sends on save",async()=>{
 m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([config]).mockResolvedValueOnce([]);
 const result=await saveReportConfig({organizationId:"org",userId:"master",destinationName:"Gestores",enabled:true,webhook});
 expect(m.encrypt).toHaveBeenCalledWith(webhook);expect(m.execute.mock.calls[0][0].values).toContain("encrypted");expect(JSON.stringify(result)).not.toContain("private-token");expect(JSON.stringify(m.audit.mock.calls)).not.toContain("private-token");expect(m.fetch).not.toHaveBeenCalled();
});
it("requires a confirmation and forbids redirects without leaking provider responses",async()=>{
 m.fetch.mockResolvedValueOnce(new Response("{}",{status:200}));await expect(postReportPart(webhook,"report","id","thread")).rejects.toThrow("não confirmou");
 expect(m.fetch.mock.calls[0][1].redirect).toBe("error");
 expect(chatRequestId("org","2026-11-23",0)).not.toBe(chatRequestId("org","2026-11-23",1));
});
