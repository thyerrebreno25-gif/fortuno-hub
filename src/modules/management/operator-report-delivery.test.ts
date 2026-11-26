import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),member:vi.fn(),permissions:vi.fn(),build:vi.fn(),audit:vi.fn(),fetch:vi.fn(),token:vi.fn(),space:vi.fn(),status:vi.fn(),pdf:vi.fn(),share:vi.fn()}));
vi.mock("@/lib/prisma",()=>{const tx={$queryRaw:m.query,$executeRaw:m.execute,auditLog:{create:m.audit}};return {prisma:{...tx,organizationMember:{findFirst:m.member},$transaction:(fn:(t:typeof tx)=>unknown)=>fn(tx)}};});
vi.mock("@/modules/permissions/permissions",()=>({getRolePermissions:m.permissions}));vi.mock("./operator-report-server",()=>({buildOperatorDayReport:m.build}));
vi.mock("./operator-report-google",()=>({reportChatAccessToken:m.token,readReportSpace:m.space,reportGoogleStatus:m.status,validReportSpace:(value:string)=>/^spaces\/[A-Za-z0-9_-]+$/.test(value)}));
vi.mock("./operator-report-pdf",()=>({createOperatorReportPdf:m.pdf,operatorPdfName:(day:string)=>`Fortuno-Relatorio-Diario-${day}.pdf`}));
vi.mock("./executive-report-share",()=>({publishExecutiveReport:m.share}));
import {chatRequestId,postReportPdf,uploadReportPdf,processDailyOperatorReports,saveReportConfig,reportSchedule} from "./operator-report-delivery";
const config={organizationId:"org",revision:"revision",configuredById:"master",destinationName:"Gestores",spaceName:"spaces/managers",enabled:true,updatedAt:new Date("2026-11-23T12:00Z")};
const snapshot={day:"2026-11-23",generatedAt:"2026-11-24T11:00Z",scope:"Todos",available:{whatsapp:true,operations:true,daily:true},warnings:[],rows:[]};
const pdfBytes=new TextEncoder().encode("%PDF-1.7 sample"),ref={attachmentUploadToken:"private-attachment-token"};
const delivery=()=>({messages:["Bom dia! Segue em anexo o relatório."],snapshot,pdfBase64:null as string|null,attachmentRef:null as typeof ref|null,sentParts:0});
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal("fetch",m.fetch);m.fetch.mockImplementation(async(url:URL|string)=>new Response(JSON.stringify(String(url).includes("attachments:upload")?{attachmentDataRef:ref}:{name:"spaces/managers/messages/confirmed"}),{status:200}));m.execute.mockResolvedValue(1);m.member.mockResolvedValue({id:"member",userId:"master",organizationId:"org",role:"MASTER"});m.permissions.mockResolvedValue(Object.fromEntries(["MANAGEMENT","WHATSAPP","OPERATIONS","DAILY_ACTIVITIES"].map(key=>[key,{canView:true,canManage:true,canExport:true}])));m.build.mockResolvedValue(snapshot);m.token.mockResolvedValue("private-access-token");m.space.mockResolvedValue({name:config.spaceName,displayName:"Gestores"});m.status.mockResolvedValue({configured:true,connected:true});m.pdf.mockReturnValue({output:()=>pdfBytes.buffer});m.query.mockResolvedValue([]);});
it("does nothing before 08h or without a configured space",async()=>{await processDailyOperatorReports(new Date("2026-11-24T10:59:59Z"));expect(m.query).not.toHaveBeenCalled();await processDailyOperatorReports(new Date("2026-11-24T11:00Z"));expect(m.fetch).not.toHaveBeenCalled();});
it("freezes the report and PDF, uploads the file then sends one greeting with its attachment",async()=>{
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([]).mockResolvedValueOnce([delivery()]);await processDailyOperatorReports(new Date("2026-11-24T11:00Z"));
 expect(m.build).toHaveBeenCalledWith(expect.objectContaining({organizationId:"org"}),"2026-11-23",expect.any(Date),"GENERAL");expect(m.query.mock.calls[2][0].sql).toContain("attempts<8");expect(m.fetch).toHaveBeenCalledTimes(2);
 const [uploadUrl,upload]=m.fetch.mock.calls[0];expect(String(uploadUrl)).toContain("/upload/v1/spaces/managers/attachments:upload?uploadType=multipart");expect(upload.headers.Authorization).toBe("Bearer private-access-token");expect(Buffer.from(upload.body).toString()).toContain("application/pdf");expect(Buffer.from(upload.body).toString()).toContain("Fortuno-Relatorio-Diario-2026-11-23.pdf");
 const [url,options]=m.fetch.mock.calls[1];expect(url.searchParams.get("requestId")).toBe(chatRequestId("org","2026-11-23"));expect(JSON.parse(options.body)).toEqual({text:"Bom dia! Segue em anexo o relatório.",attachment:[{attachmentDataRef:ref}]});expect(m.execute.mock.calls.at(-1)![0].sql).toContain("status='SENT'");
});
it("retries a frozen attachment after an uncertain send with the same request id and without uploading again",async()=>{
 const frozen={...delivery(),pdfBase64:Buffer.from(pdfBytes).toString("base64"),attachmentRef:ref},existing={status:"FAILED",configRevision:"revision",snapshot};
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([existing]).mockResolvedValueOnce([{...frozen}]);m.fetch.mockRejectedValueOnce(new Error("network private-access-token"));await processDailyOperatorReports(new Date("2026-11-24T11:10Z"));
 const firstId=m.fetch.mock.calls[0][0].searchParams.get("requestId");expect(m.execute.mock.calls.at(-1)![0].values.join(" ")).not.toContain("private-access-token");
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([existing]).mockResolvedValueOnce([{...frozen}]);await processDailyOperatorReports(new Date("2026-11-24T11:15Z"));expect(m.fetch.mock.calls[1][0].searchParams.get("requestId")).toBe(firstId);expect(m.build).not.toHaveBeenCalled();expect(m.pdf).not.toHaveBeenCalled();expect(m.fetch.mock.calls.every(call=>!String(call[0]).includes("attachments:upload"))).toBe(true);
});
it("never sends text alone if PDF upload fails, a lease is owned or the destination changed",async()=>{
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([]).mockResolvedValueOnce([delivery()]);m.fetch.mockResolvedValueOnce(new Response("failure",{status:503}));await processDailyOperatorReports(new Date("2026-11-24T11:00Z"));expect(m.fetch).toHaveBeenCalledOnce();expect(m.execute.mock.calls.at(-1)![0].sql).toContain("status='FAILED'");
 m.fetch.mockClear();m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([{status:"READY",configRevision:"revision",snapshot}]).mockResolvedValueOnce([]);await processDailyOperatorReports(new Date("2026-11-24T11:01Z"));expect(m.fetch).not.toHaveBeenCalled();
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([{status:"FAILED",configRevision:"other",snapshot}]);await processDailyOperatorReports(new Date("2026-11-24T11:02Z"));expect(m.fetch).not.toHaveBeenCalled();
});
it("validates the destination using Google instead of trusting a client label and stores no access token",async()=>{
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([]);const result=await saveReportConfig({organizationId:"org",userId:"master",spaceName:config.spaceName!,enabled:true});expect(m.space).toHaveBeenCalledWith("private-access-token",config.spaceName);expect(JSON.stringify(result)).not.toContain("private-access-token");expect(JSON.stringify(m.audit.mock.calls)).not.toContain("private-access-token");expect(m.fetch).not.toHaveBeenCalled();
});
it("requires attachment and message confirmations and rejects arbitrary upload destinations",async()=>{
 await expect(uploadReportPdf("token","../../evil","2026-11-23",pdfBytes)).rejects.toThrow();m.fetch.mockResolvedValueOnce(new Response("{}",{status:200}));await expect(uploadReportPdf("token",config.spaceName!,"2026-11-23",pdfBytes)).rejects.toThrow("não confirmou");
 m.fetch.mockResolvedValueOnce(new Response("{}",{status:200}));await expect(postReportPdf("token",config.spaceName!,"Bom dia",ref,"id")).rejects.toThrow("não confirmou");expect(m.fetch.mock.calls.at(-1)![1].redirect).toBe("error");
});
it("revalidates current export/module permissions and stops before sending when attachment persistence loses its lease",async()=>{
 m.query.mockResolvedValueOnce([config]);m.permissions.mockResolvedValueOnce({MANAGEMENT:{canView:true,canManage:true,canExport:false}});await processDailyOperatorReports(new Date("2026-11-24T11:00Z"));expect(m.fetch).not.toHaveBeenCalled();
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([{status:"FAILED",configRevision:"revision",snapshot}]);m.permissions.mockResolvedValueOnce({MANAGEMENT:{canView:true,canManage:true,canExport:true},WHATSAPP:{canView:false},OPERATIONS:{canView:true},DAILY_ACTIVITIES:{canView:true}});await processDailyOperatorReports(new Date("2026-11-24T11:01Z"));expect(m.fetch).not.toHaveBeenCalled();
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([]).mockResolvedValueOnce([delivery()]);m.execute.mockImplementation(async(query:{sql:string})=>query.sql.includes('SET "attachmentRef"')?0:1);await processDailyOperatorReports(new Date("2026-11-24T11:02Z"));expect(m.fetch).toHaveBeenCalledOnce();expect(String(m.fetch.mock.calls[0][0])).toContain("attachments:upload");expect(m.execute.mock.calls.at(-1)![0].sql).toContain("status='FAILED'");
});
it("preserves the safe Chat app setup diagnosis for upload and message failures",async()=>{
 for(const stage of ["upload","message"]){
  m.fetch.mockResolvedValueOnce(new Response(JSON.stringify({error:{message:"Google Chat app not found. private-token"}}),{status:404}));
  const result=stage==="upload"?uploadReportPdf("token",config.spaceName!,"2026-11-23",pdfBytes):postReportPdf("token",config.spaceName!,"Bom dia",ref,"id");
  await expect(result).rejects.toMatchObject({code:"CHAT_APP_NOT_CONFIGURED",status:409});
 }
});
it("does not expose provider payloads for malformed uploads, denied scopes, and failed publications",async()=>{
 m.fetch.mockResolvedValueOnce(new Response(JSON.stringify({error:{message:"private-token",details:[{reason:"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}),{status:403}));await expect(uploadReportPdf("token",config.spaceName!,"2026-11-23",pdfBytes)).rejects.toMatchObject({code:"CHAT_SCOPE_MISSING"});
 m.fetch.mockResolvedValueOnce(new Response("private-provider-body",{status:400}));await expect(uploadReportPdf("token",config.spaceName!,"2026-11-23",pdfBytes)).rejects.toMatchObject({code:"REPORT_UPLOAD_REJECTED",message:expect.not.stringContaining("private-")});
 m.fetch.mockResolvedValueOnce(new Response("private-provider-body",{status:200}));await expect(uploadReportPdf("token",config.spaceName!,"2026-11-23",pdfBytes)).rejects.toMatchObject({code:"REPORT_UPLOAD_UNCONFIRMED"});
 m.fetch.mockResolvedValueOnce(new Response("private-provider-body",{status:500}));await expect(postReportPdf("token",config.spaceName!,"Bom dia",ref,"id")).rejects.toMatchObject({code:"REPORT_MESSAGE_REJECTED",message:expect.not.stringContaining("private-")});
});

it("uses Brasília weekday schedules and keeps 08h and 13h delivery identities independent",async()=>{
 expect(reportSchedule(new Date("2026-11-28T16:00Z"),"SERVICE")).toBeNull();
 expect(reportSchedule(new Date("2026-11-29T11:00Z"))).toBeNull();
 expect(reportSchedule(new Date("2026-11-26T15:59:59Z"),"SERVICE")).toBeNull();
 expect(reportSchedule(new Date("2026-11-26T16:00Z"),"SERVICE")?.day).toBe("2026-11-26");
 expect(reportSchedule(new Date("2026-11-26T11:00Z"))?.day).toBe("2026-11-25");
 expect(chatRequestId("org","service:2026-11-26")).not.toBe(chatRequestId("org","2026-11-26"));
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([]).mockResolvedValueOnce([delivery()]);
 await processDailyOperatorReports(new Date("2026-11-26T16:00Z"),"SERVICE");
 expect(m.build).toHaveBeenCalledWith(expect.objectContaining({organizationId:"org"}),"2026-11-26",expect.any(Date),"SERVICE");
 expect(m.query.mock.calls[1][0].sql).toContain('"OperatorServiceReportDelivery"');
 expect(m.fetch.mock.calls[1][0].searchParams.get("requestId")).toBe(chatRequestId("org","service:2026-11-26"));
});
it("persists the isolated executive link before posting and does not rebuild an already frozen payload",async()=>{
 m.share.mockResolvedValue({url:'https://app.hubsuporte.shop/relatorios/d/'+'a'.repeat(43)});
 const v2={...delivery(),snapshot:{...snapshot,presentationVersion:2 as const}};
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([]).mockResolvedValueOnce([v2]);await processDailyOperatorReports(new Date('2026-11-24T11:00Z'));
 expect(m.share).toHaveBeenCalledWith('org','master','scheduled:GENERAL:2026-11-23:revision',v2.snapshot,expect.any(Date));expect(m.fetch.mock.calls[1][1].body).toContain('/relatorios/d/');expect(m.execute.mock.calls.some(c=>c[0].sql.includes('SET messages='))).toBe(true);
 m.share.mockClear();m.fetch.mockClear();m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([{status:'FAILED',configRevision:'revision',snapshot:v2.snapshot}]).mockResolvedValueOnce([{...v2,pdfBase64:Buffer.from(pdfBytes).toString('base64'),attachmentRef:ref}]);await processDailyOperatorReports(new Date('2026-11-24T11:10Z'));expect(m.share).not.toHaveBeenCalled();expect(m.fetch.mock.calls[0][1].body).toContain('/relatorios/d/');
});
