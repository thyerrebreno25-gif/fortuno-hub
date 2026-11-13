import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({tx:{ $executeRaw:vi.fn(),passwordRecoveryRequest:{deleteMany:vi.fn(),count:vi.fn(),create:vi.fn()},user:{findFirst:vi.fn()}},request:{updateMany:vi.fn(),findUniqueOrThrow:vi.fn(),update:vi.fn(),findMany:vi.fn()},user:{findFirst:vi.fn()},generate:vi.fn(),fetch:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{$transaction:(callback:(tx:typeof m.tx)=>unknown)=>callback(m.tx),passwordRecoveryRequest:m.request,user:m.user}}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({auth:{admin:{generateLink:m.generate}}})}));
vi.mock("@/modules/purchase-invoices/server/crypto",()=>({encryptIntegrationSecret:(value:string)=>"encrypted:"+value,decryptIntegrationSecret:(value:string)=>value.replace(/^encrypted:/,"")}));
import {queuePasswordRecovery,deliverPasswordRecovery,processPasswordRecoveryQueue} from "./password-recovery";
const email="operator@example.test",now=new Date("2026-11-13T18:00:00Z");
let request:Record<string,unknown>;
beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv("RESEND_API_KEY","test-resend");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","test-admin");vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://test.supabase.co");vi.stubEnv("INTEGRATION_TOKEN_ENCRYPTION_KEY","test-key");vi.stubEnv("PASSWORD_RECOVERY_APP_URL","https://app.hubsuporte.shop");
 m.tx.passwordRecoveryRequest.count.mockResolvedValue(0);m.tx.passwordRecoveryRequest.create.mockImplementation(async({data})=>{request={id:"request",...data};return {id:"request"};});m.tx.user.findFirst.mockResolvedValue({id:"user"});
 m.request.updateMany.mockResolvedValue({count:1});m.user.findFirst.mockResolvedValue({id:"user",email});m.generate.mockResolvedValue({data:{properties:{hashed_token:"single-use-secret",verification_type:"recovery"}},error:null});m.fetch.mockResolvedValue(Response.json({id:"email"}));vi.stubGlobal("fetch",m.fetch);
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("queues only hashed email/IP metadata with durable global, IP, hourly and minute email limits",async()=>{
 expect(await queuePasswordRecovery(email,"192.0.2.1",now)).toBe("request");
 expect(m.tx.$executeRaw).toHaveBeenCalledOnce();expect(m.tx.passwordRecoveryRequest.count).toHaveBeenCalledTimes(4);
 expect(request).toMatchObject({userId:"user",status:"PENDING",recipientHash:expect.stringMatching(/^[a-f0-9]{64}$/),ipHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
 expect(JSON.stringify(request)).not.toContain(email);expect(JSON.stringify(request)).not.toContain("192.0.2.1");
});
it("uses the same accepted result for an unknown account without generating a token",async()=>{
 m.tx.user.findFirst.mockResolvedValue(null);expect(await queuePasswordRecovery(email,"ip",now)).toBe("request");expect(request.status).toBe("SKIPPED");expect(m.generate).not.toHaveBeenCalled();
});
it("deduplicates repeated clicks and enforces email cooldowns before token generation",async()=>{
 m.tx.passwordRecoveryRequest.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
 expect(await queuePasswordRecovery(email,"ip",now)).toBeNull();expect(m.tx.user.findFirst).not.toHaveBeenCalled();expect(m.tx.passwordRecoveryRequest.create).not.toHaveBeenCalled();
});
it("rejects an IP burst and a global burst for any email",async()=>{
 m.tx.passwordRecoveryRequest.count.mockResolvedValueOnce(0).mockResolvedValueOnce(20).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
 await expect(queuePasswordRecovery(email,"ip",now)).rejects.toMatchObject({status:429,retryAfter:900});
 m.tx.passwordRecoveryRequest.count.mockResolvedValueOnce(100).mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
 await expect(queuePasswordRecovery(email,"ip",now)).rejects.toMatchObject({status:503});expect(m.generate).not.toHaveBeenCalled();
});
it("sends the same single-use Supabase recovery token through the existing mail provider and never exposes it publicly",async()=>{
 await queuePasswordRecovery(email,"ip",now);m.request.findUniqueOrThrow.mockResolvedValue(request);
 await deliverPasswordRecovery("request",now);
 expect(m.generate).toHaveBeenCalledWith({type:"recovery",email,options:{redirectTo:"https://app.hubsuporte.shop/recuperar-senha"}});
 expect(m.request.update).toHaveBeenCalledWith({where:{id:"request"},data:{encryptedToken:"encrypted:single-use-secret"}});
 const body=JSON.parse(m.fetch.mock.calls[0][1].body);expect(body.to).toEqual([email]);expect(body.text).toContain("https://app.hubsuporte.shop/recuperar-senha?token_hash=single-use-secret&type=recovery");
 expect(m.request.update).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({status:"SENT",encryptedToken:null})}));
});
it("reuses encrypted tokens and a stable delivery idempotency key after an uncertain mail response",async()=>{
 await queuePasswordRecovery(email,"ip",now);m.request.findUniqueOrThrow.mockResolvedValue({...request,encryptedToken:"encrypted:same-token"});
 await deliverPasswordRecovery("request",now);expect(m.generate).not.toHaveBeenCalled();expect(m.fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("password-recovery:request");expect(m.fetch.mock.calls[0][1].body).toContain("same-token");
});
it("skips changed emails or removed memberships and honors the shared worker lease",async()=>{
 await queuePasswordRecovery(email,"ip",now);m.request.findUniqueOrThrow.mockResolvedValue(request);m.user.findFirst.mockResolvedValue({id:"user",email:"changed@example.test"});
 await deliverPasswordRecovery("request",now);expect(m.generate).not.toHaveBeenCalled();expect(m.request.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"SKIPPED"})}));
 m.request.updateMany.mockResolvedValue({count:0});m.request.findUniqueOrThrow.mockClear();await deliverPasswordRecovery("request",now);expect(m.request.findUniqueOrThrow).not.toHaveBeenCalled();
});
it("records provider errors without tokens or provider bodies and leaves retries queued",async()=>{
 await queuePasswordRecovery(email,"ip",now);m.request.findUniqueOrThrow.mockResolvedValue(request);m.fetch.mockResolvedValue(Response.json({error:"private provider details"},{status:503}));const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
 try {await deliverPasswordRecovery("request",now);expect(m.request.update).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({status:"FAILED",lastErrorCode:"EMAIL_HTTP_503",leaseUntil:null})}));expect(JSON.stringify(warn.mock.calls)).not.toContain(email);expect(JSON.stringify(warn.mock.calls)).not.toContain("single-use-secret");}finally{warn.mockRestore();}
});
it("fails closed when delivery configuration is missing and never sends after three attempts or fifteen minutes",async()=>{
 vi.stubEnv("RESEND_API_KEY","");await expect(queuePasswordRecovery(email,"ip",now)).rejects.toMatchObject({status:503});expect(m.tx.passwordRecoveryRequest.create).not.toHaveBeenCalled();
 vi.stubEnv("RESEND_API_KEY","test");m.request.findMany.mockResolvedValue([]);await processPasswordRecoveryQueue(now);expect(m.request.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({attempts:{lt:3},createdAt:{gte:new Date(+now-900000)}})}));
});

it("suppresses recipients already requested three times this hour without scheduling another email",async()=>{
 m.tx.passwordRecoveryRequest.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(3).mockResolvedValueOnce(0);
 expect(await queuePasswordRecovery(email,"ip",now)).toBeNull();expect(m.tx.passwordRecoveryRequest.create).not.toHaveBeenCalled();
});
