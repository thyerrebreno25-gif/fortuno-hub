import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),audit:vi.fn(),member:vi.fn(),permissions:vi.fn(),build:vi.fn(),token:vi.fn(),pdf:vi.fn(),upload:vi.fn(),post:vi.fn()}));
vi.mock("@/lib/prisma",()=>{const tx={$queryRaw:m.query,$executeRaw:m.execute,auditLog:{create:m.audit}};return {prisma:{...tx,organizationMember:{findFirst:m.member},$transaction:(fn:(t:typeof tx)=>unknown)=>fn(tx)}};});
vi.mock("@/modules/permissions/permissions",()=>({getRolePermissions:m.permissions}));
vi.mock("./operator-report-server",()=>({buildOperatorDayReport:m.build}));
vi.mock("./operator-report-google",()=>({reportChatAccessToken:m.token,validReportSpace:(value:string)=>/^spaces\/[A-Za-z0-9_-]+$/.test(value)}));
vi.mock("./operator-report-delivery",()=>({chatRequestId:(org:string,key:string)=>org+":"+key,uploadReportPdf:m.upload,postReportPdf:m.post}));
vi.mock("./operator-report-pdf",()=>({createOperatorReportPdf:m.pdf}));
import {sendManualOperatorReport} from "./operator-report-manual";
const member={id:"member",userId:"master",organizationId:"org",role:"MASTER"};
const input={day:"2026-11-24",requestId:"e17fca79-dc4a-47b3-9e67-62f5279253a3",revision:"revision"},now=new Date("2026-11-25T09:00Z");
const config={revision:"revision",configuredById:"sender",spaceName:"spaces/managers",destinationName:"Daily Gestão",enabled:false};
const snapshot={day:input.day,generatedAt:now.toISOString(),scope:"Todos",available:{whatsapp:true,operations:true,daily:true},warnings:[],rows:[]};
const ref={attachmentUploadToken:"private-upload"},bytes=new TextEncoder().encode("%PDF-1.7 test");
const saved=()=>({requestId:input.requestId,requestedById:"master",day:input.day,configRevision:"revision",destinationName:"Daily Gestão",status:"READY",attempts:0,snapshot,messages:["Saudação congelada"],pdfBase64:null as string|null,attachmentRef:null as typeof ref|null,sentAt:null as Date|null});
const permissions=()=>Object.fromEntries(["MANAGEMENT","WHATSAPP","OPERATIONS","DAILY_ACTIVITIES"].map(key=>[key,{canView:true,canManage:true,canExport:true}]));
function prepare(existing:ReturnType<typeof saved>|null=null){
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce(existing?[existing]:[]).mockResolvedValueOnce([config]).mockResolvedValueOnce([existing||saved()]);
 if(existing?.status!=="SENT")m.query.mockResolvedValueOnce([{active:false}]).mockResolvedValueOnce([{...(existing||saved()),status:"SENDING"}]).mockResolvedValueOnce([{sentAt:now}]);
}
beforeEach(()=>{vi.resetAllMocks();m.execute.mockResolvedValue(1);m.member.mockResolvedValue({...member,userId:"sender"});m.permissions.mockImplementation(async()=>permissions());m.build.mockResolvedValue(snapshot);m.token.mockResolvedValue("private-token");m.upload.mockResolvedValue(ref);m.pdf.mockReturnValue({output:()=>bytes.buffer});m.query.mockResolvedValue([]);});
it("sends the selected past day before 08h with automatic sending disabled and leaves scheduled deliveries untouched",async()=>{
 prepare();const result=await sendManualOperatorReport(member,input,now);
 expect(result).toEqual({status:"SENT",alreadySent:false,day:input.day,destinationName:"Daily Gestão",sentAt:now});
 expect(m.build).toHaveBeenCalledWith(member,input.day,now);expect(m.token).toHaveBeenCalledWith("org","sender");expect(m.upload).toHaveBeenCalledWith("private-token","spaces/managers",input.day,expect.any(Buffer));
 expect(m.post).toHaveBeenCalledWith("private-token","spaces/managers","Saudação congelada",ref,"org:manual:"+input.requestId);
 expect(m.audit.mock.calls[0][0].data.action).toBe("OPERATOR_REPORT_SENT_MANUALLY");
 const sql=m.execute.mock.calls.concat(m.query.mock.calls).map(call=>call[0].sql).join(" ");expect(sql).not.toContain('UPDATE "OperatorReportConfig"');expect(sql).not.toContain('FROM "OperatorReportDelivery"');expect(sql).not.toContain('INSERT INTO "OperatorReportDelivery"');
 expect(JSON.stringify(result)).not.toContain("private-");expect(JSON.stringify(m.audit.mock.calls)).not.toContain("private-");
});
it("returns an already confirmed request without generating, uploading or sending a second PDF",async()=>{
 prepare({...saved(),status:"SENT",sentAt:now});expect((await sendManualOperatorReport(member,input,now)).alreadySent).toBe(true);
 for(const fn of [m.build,m.token,m.pdf,m.upload,m.post,m.audit])expect(fn).not.toHaveBeenCalled();
});
it("reuses frozen bytes, attachment and Google id after an uncertain delivery, never replacing the snapshot",async()=>{
 const frozen={...saved(),status:"FAILED",pdfBase64:Buffer.from(bytes).toString("base64"),attachmentRef:ref};
 prepare(frozen);m.post.mockRejectedValueOnce(new Error("network private-token"));await expect(sendManualOperatorReport(member,input,now)).rejects.toMatchObject({code:"REPORT_DELIVERY_UNCONFIRMED"});
 expect(m.execute.mock.calls.at(-1)![0].sql).toContain("status='FAILED'");expect(m.execute.mock.calls.at(-1)![0].values.join(" ")).not.toContain("private-token");
 m.query.mockReset();prepare(frozen);await sendManualOperatorReport(member,input,now);expect(m.post.mock.calls[0][4]).toBe(m.post.mock.calls[1][4]);
 for(const fn of [m.build,m.pdf,m.upload])expect(fn).not.toHaveBeenCalled();
});
it("never sends a greeting without its PDF when upload or attachment persistence fails",async()=>{
 prepare();m.upload.mockRejectedValueOnce(new Error("upload unavailable"));await expect(sendManualOperatorReport(member,input,now)).rejects.toMatchObject({code:"REPORT_DELIVERY_UNCONFIRMED"});expect(m.post).not.toHaveBeenCalled();
 m.query.mockReset();prepare();m.execute.mockImplementation(async(q:{sql:string})=>q.sql.includes('SET "attachmentRef"')?0:1);await expect(sendManualOperatorReport(member,input,now)).rejects.toThrow();expect(m.post).not.toHaveBeenCalled();
});
it("rejects a changed destination, forged request reuse, removed sender, invalid day and unauthorized roles",async()=>{
 m.query.mockResolvedValueOnce([{...config,revision:"new"}]);await expect(sendManualOperatorReport(member,input,now)).rejects.toMatchObject({code:"REPORT_CONFIG_CHANGED"});
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([{...saved(),requestedById:"another"}]);await expect(sendManualOperatorReport(member,input,now)).rejects.toMatchObject({code:"REPORT_REQUEST_CONFLICT"});
 m.query.mockResolvedValueOnce([config]);m.member.mockResolvedValueOnce(null);await expect(sendManualOperatorReport(member,input,now)).rejects.toMatchObject({code:"REPORT_SENDER_UNAVAILABLE"});
 await expect(sendManualOperatorReport(member,{...input,day:"2026-11-25"},now)).rejects.toThrow();
 await expect(sendManualOperatorReport({...member,role:"MANAGER"},input,now)).rejects.toMatchObject({status:403});expect(m.upload).not.toHaveBeenCalled();
});
it("rechecks sender and requester module permissions before replaying a frozen report",async()=>{
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([{...saved(),status:"FAILED"}]);m.permissions.mockResolvedValueOnce(permissions()).mockResolvedValueOnce({...permissions(),WHATSAPP:{canView:false}});
 await expect(sendManualOperatorReport(member,input,now)).rejects.toMatchObject({code:"REPORT_PERMISSION_CHANGED"});expect(m.token).not.toHaveBeenCalled();
});
it("serializes active manual sends and rejects stale configuration at claim time",async()=>{
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([]).mockResolvedValueOnce([config]).mockResolvedValueOnce([saved()]).mockResolvedValueOnce([{active:true}]);
 await expect(sendManualOperatorReport(member,input,now)).rejects.toMatchObject({code:"REPORT_ALREADY_SENDING"});expect(m.token).not.toHaveBeenCalled();
 m.query.mockResolvedValueOnce([config]).mockResolvedValueOnce([]).mockResolvedValueOnce([{revision:"new"}]);await expect(sendManualOperatorReport(member,input,now)).rejects.toMatchObject({code:"REPORT_CONFIG_CHANGED"});expect(m.upload).not.toHaveBeenCalled();
});
