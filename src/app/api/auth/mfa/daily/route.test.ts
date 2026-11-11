import {beforeEach,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const m=vi.hoisted(()=>({user:vi.fn(),assurance:vi.fn(),mint:vi.fn(),verify:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:m.user,mfa:{getAuthenticatorAssuranceLevel:m.assurance}}})}));
vi.mock("@/lib/auth/daily-mfa",()=>({createDailyMfaToken:m.mint,verifyDailyMfaToken:m.verify,DAILY_MFA_COOKIE_NAME:"daily",DAILY_MFA_COOKIE_MAX_AGE_SECONDS:129600}));
import {GET,POST} from "./route";
const req=()=>new NextRequest("https://hub.test/api/auth/mfa/daily",{headers:{cookie:"daily=signed"}});
beforeEach(()=>{vi.clearAllMocks();m.user.mockResolvedValue({data:{user:{id:"u",last_sign_in_at:new Date().toISOString()}}});m.assurance.mockResolvedValue({data:{currentLevel:"aal2",currentAuthenticationMethods:[{method:"totp",timestamp:Math.floor(Date.now()/1000)}]}});m.mint.mockResolvedValue("signed-today");m.verify.mockResolvedValue(true);});
it("does not renew an old login merely because its refresh token is still AAL2",async()=>{m.user.mockResolvedValue({data:{user:{id:"u",last_sign_in_at:"2000-01-01T12:00:00Z"}}});expect((await POST(req())).status).toBe(401);expect(m.mint).not.toHaveBeenCalled();});
it("requires password login and MFA before issuing today's signed access",async()=>{m.assurance.mockResolvedValueOnce({data:{currentLevel:"aal1"}});expect((await POST(req())).status).toBe(403);expect(m.mint).not.toHaveBeenCalled();const response=await POST(req());expect(response.status).toBe(200);expect(response.cookies.get("daily")?.value).toBe("signed-today");expect(response.headers.get("set-cookie")).toContain("HttpOnly");});
it("checks the server-signed day on GET without renewing it",async()=>{expect((await GET(req())).status).toBe(200);expect(m.verify).toHaveBeenCalledWith("signed","u");expect(m.mint).not.toHaveBeenCalled();m.verify.mockResolvedValue(false);const invalid=await GET(req());expect(invalid.status).toBe(401);expect((await invalid.json()).code).toBe("DAILY_LOGIN_REQUIRED");});

it("does not let another browser's new login refresh yesterday's AAL2 verification",async()=>{m.assurance.mockResolvedValue({data:{currentLevel:"aal2",currentAuthenticationMethods:[{method:"totp",timestamp:1}]}});expect((await POST(req())).status).toBe(403);expect(m.mint).not.toHaveBeenCalled();});
