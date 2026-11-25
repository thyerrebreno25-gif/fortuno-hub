import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),send:vi.fn()}));
vi.mock("@/modules/assistant/auth",()=>({getMemberForModule:m.member}));
vi.mock("@/modules/management/operator-report-manual",()=>({sendManualOperatorReport:m.send}));
import {POST} from "./route";
import {OperatorChatError} from "@/modules/management/operator-chat-error";
const member={id:"member",organizationId:"org",userId:"master",role:"MASTER"},input={day:"2026-11-24",requestId:"e17fca79-dc4a-47b3-9e67-62f5279253a3",revision:"revision"};
const post=(value:unknown=input,headers:Record<string,string>={"Content-Type":"application/json",Origin:"https://hub"})=>POST(new Request("https://hub/api/management/operator-report/send",{method:"POST",headers,body:JSON.stringify(value)}));
beforeEach(()=>{vi.clearAllMocks();vi.useRealTimers();m.member.mockResolvedValue(member);m.send.mockResolvedValue({status:"SENT",day:input.day,destinationName:"Daily Gestão"});});
it("uses only authenticated organization and user scope with private noncached responses",async()=>{
 const response=await post();expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(m.send).toHaveBeenCalledWith(member,input);
 expect((await post({...input,organizationId:"other"})).status).toBe(400);expect((await post({...input,spaceName:"spaces/forged"})).status).toBe(400);
});
it("blocks unauthenticated, operator and manager accounts before sending",async()=>{
 for(const value of [null,{...member,role:"OPERATOR"},{...member,role:"MANAGER"}]){m.member.mockResolvedValueOnce(value);expect((await post()).status).toBe(403);}expect(m.send).not.toHaveBeenCalled();
});
it("rejects cross-site form posts, invalid request IDs, and current/future report days",async()=>{
 expect((await post(input,{"Content-Type":"application/json",Origin:"https://evil.test"})).status).toBe(403);expect((await post(input,{"Content-Type":"text/plain"})).status).toBe(403);
 expect((await post({...input,requestId:"not-a-uuid"})).status).toBe(400);expect((await post({...input,day:"2099-01-01"})).status).toBe(400);expect(m.send).not.toHaveBeenCalled();
});
it("returns actionable safe conflicts and hides unexpected provider/database errors",async()=>{
 m.send.mockRejectedValueOnce(new OperatorChatError("REPORT_ALREADY_SENDING","Um envio está em andamento.",409));const conflict=await post();expect(conflict.status).toBe(409);expect(await conflict.json()).toMatchObject({code:"REPORT_ALREADY_SENDING"});
 m.send.mockRejectedValueOnce(new Error("private access token"));const error=await post();expect(error.status).toBe(503);expect(await error.text()).not.toContain("private access token");
});
