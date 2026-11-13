import {expect,it} from "vitest";
import {recoveryReturnPath} from "./recovery-return";
it("returns legacy recovery fragments sent to login or home to the password form",()=>{expect(recoveryReturnPath("https://hub/login#access_token=access&refresh_token=refresh&type=recovery")).toBe("/recuperar-senha?recovery=1#access_token=access&refresh_token=refresh&type=recovery");});
it("preserves recovery token hashes and PKCE codes instead of dropping them at login",()=>{expect(recoveryReturnPath("https://hub/?token_hash=hash&type=recovery")).toBe("/recuperar-senha?token_hash=hash&type=recovery");expect(recoveryReturnPath("https://hub/login?code=one-time",true)).toBe("/recuperar-senha?code=one-time&recovery=1");});
it("does not hijack unrelated oauth callbacks or allow an external redirect",()=>{expect(recoveryReturnPath("https://hub/api/calendar/google/callback?code=oauth")).toBeNull();expect(recoveryReturnPath("https://hub/api/calendar/callback?code=oauth",true)).toBeNull();expect(recoveryReturnPath("https://hub/?token_hash=hash&type=recovery&next=https://evil.example")).not.toContain("evil");});
it("does not loop on the password form and shows expired-link errors there",()=>{expect(recoveryReturnPath("https://hub/recuperar-senha?recovery=1#access_token=a&refresh_token=b&type=recovery",true)).toBeNull();expect(recoveryReturnPath("https://hub/login#error_code=otp_expired",true)).toContain("/recuperar-senha");});

it("recovers Supabase codes sent to Site URL without a browser intent cookie",()=>{
 for(const path of ["/","/login","/auth/callback","/auth/confirm"])expect(recoveryReturnPath(`https://hub${path}?code=one-time`)).toBe("/recuperar-senha?code=one-time&recovery=1");
});
it("keeps expired email errors on the recovery screen on a different browser",()=>{
 expect(recoveryReturnPath("https://hub/login#error_code=otp_expired&error=access_denied")).toContain("/recuperar-senha?recovery=1#");
 expect(recoveryReturnPath("https://hub/?error_code=otp_expired&error=access_denied")).toBe("/recuperar-senha?error=access_denied&error_code=otp_expired&recovery=1");
});
it("does not intercept activation tokens, integrations or protected APIs",()=>{
 for(const path of ["/ativar-acesso","/api/meetings","/api/calendar/google/callback","/api/atendimento/gmail/callback"]){
 expect(recoveryReturnPath(`https://hub${path}?token_hash=hash&type=recovery&code=oauth`,true)).toBeNull();
 }
});
