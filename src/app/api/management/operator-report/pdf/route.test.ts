import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permissions:vi.fn(),build:vi.fn(),pdf:vi.fn()}));
vi.mock("@/modules/assistant/auth",()=>({getMemberForModule:m.member}));
vi.mock("@/modules/permissions/permissions",()=>({getRolePermissions:m.permissions}));
vi.mock("@/modules/management/operator-report-server",()=>({buildOperatorDayReport:m.build}));
vi.mock("@/modules/management/operator-report-pdf",()=>({operatorPdfName:()=>"report.pdf",createOperatorReportPdf:m.pdf}));
import {GET} from "./route";
beforeEach(()=>{vi.resetAllMocks();m.member.mockResolvedValue({role:"MANAGER",organizationId:"org"});m.permissions.mockResolvedValue({MANAGEMENT:{canExport:true}});m.build.mockResolvedValue({day:"2026-11-25",rows:[{userId:"allowed",name:"Ana"},{userId:"other",name:"Bia"}],pendingWork:[],available:{},serviceSnapshot:{open:4}});m.pdf.mockReturnValue({output:()=>new ArrayBuffer(1)});});
const request=(operator="allowed")=>new Request("https://hub.test/api/management/operator-report/pdf?day=2026-11-25&operator="+operator);
it("exports only the selected person from the server-authorized scope",async()=>{expect((await GET(request())).status).toBe(200);expect(m.pdf.mock.calls[0][0].rows).toEqual([{userId:"allowed",name:"Ana"}]);expect(m.pdf.mock.calls[0][0].serviceSnapshot).toBeUndefined();});
it("rejects a person outside the authorized scope without generating a PDF",async()=>{expect((await GET(request("foreign"))).status).toBe(400);expect(m.pdf).not.toHaveBeenCalled();});
it("requires both a management role and export permission",async()=>{m.member.mockResolvedValueOnce({role:"OPERATOR"});expect((await GET(request())).status).toBe(403);m.permissions.mockResolvedValueOnce({MANAGEMENT:{canExport:false}});expect((await GET(request())).status).toBe(403);expect(m.pdf).not.toHaveBeenCalled();});
it("retains real PDF output and private download headers, ignoring a forged organization query",async()=>{
 const actual=await vi.importActual<typeof import("@/modules/management/operator-report-pdf")>("@/modules/management/operator-report-pdf");
 m.pdf.mockImplementation(actual.createOperatorReportPdf);m.build.mockResolvedValue({day:"2026-11-25",generatedAt:"2026-11-26T11:00Z",scope:"Minha equipe",available:{whatsapp:false,operations:false,daily:false},rows:[],warnings:[]});
 const response=await GET(new Request("https://hub.test/api/management/operator-report/pdf?day=2026-11-25&organizationId=forged"));
 expect(response.status).toBe(200);expect(response.headers.get("Content-Type")).toBe("application/pdf");expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");expect((await response.text()).slice(0,5)).toBe("%PDF-");expect(m.build.mock.calls[0][0].organizationId).toBe("org");
});
it("rejects invalid reference dates before querying report data",async()=>{expect((await GET(new Request("https://hub.test/api/management/operator-report/pdf?day=2026-02-30"))).status).toBe(400);expect(m.build).not.toHaveBeenCalled();});
