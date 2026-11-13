import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({queue:vi.fn(),deliver:vi.fn(),after:vi.fn()}));
vi.mock("next/server",async()=>({...await vi.importActual<typeof import("next/server")>("next/server"),after:m.after}));
vi.mock("@/modules/auth/password-recovery",()=>({queuePasswordRecovery:m.queue,deliverPasswordRecovery:m.deliver,recoveryOrigin:()=>"https://app.hubsuporte.shop",RecoveryRequestError:class extends Error{constructor(message:string,public status=503,public retryAfter=60){super(message);}}}));
import {POST} from "./route";
import {RecoveryRequestError} from "@/modules/auth/password-recovery";
function request(body:unknown,headers:Record<string,string>={}){return new Request("https://app.hubsuporte.shop/api/auth/password-recovery",{method:"POST",headers:{origin:"https://app.hubsuporte.shop",...headers},body:typeof body==="string"?body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();m.queue.mockResolvedValue("request");});
it("returns a generic response without sessions or secrets and delivers after the response",async()=>{
 const response=await POST(request({email:"  Operator@Example.test  "},{"x-vercel-forwarded-for":"192.0.2.1"}));expect(response.status).toBe(202);expect(await response.json()).toEqual({ok:true});expect(response.headers.get("Cache-Control")).toBe("no-store");expect(m.queue).toHaveBeenCalledWith("operator@example.test","192.0.2.1");expect(m.deliver).not.toHaveBeenCalled();await m.after.mock.calls[0][0]();expect(m.deliver).toHaveBeenCalledWith("request");
});
it("accepts a suppressed duplicate with the identical response",async()=>{m.queue.mockResolvedValue(null);const response=await POST(request({email:"operator@example.test"}));expect(response.status).toBe(202);expect(await response.json()).toEqual({ok:true});expect(m.after).not.toHaveBeenCalled();});
it("rejects invalid, oversized or foreign-origin input before queuing an email",async()=>{
 for(const body of [{email:"bad"},"not json",{email:"a".repeat(3000)}])expect((await POST(request(body))).status).toBe(400);
 expect((await POST(request({email:"user@example.test"},{origin:"https://evil.example"}))).status).toBe(403);expect(m.queue).not.toHaveBeenCalled();
});
it("reports shared throttling without exposing the provider or existence of an account",async()=>{
 m.queue.mockRejectedValue(new RecoveryRequestError("Aguarde 15 minutos.",429,900));const response=await POST(request({email:"user@example.test"}));expect(response.status).toBe(429);expect(response.headers.get("Retry-After")).toBe("900");expect(m.after).not.toHaveBeenCalled();
});
