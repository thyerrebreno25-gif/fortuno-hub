import {beforeEach,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const m=vi.hoisted(()=>({signout:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{signOut:m.signout}})}));
import {GET} from "./route";
import {DAILY_MFA_COOKIE_NAME} from "@/lib/auth/daily-mfa";
beforeEach(()=>vi.clearAllMocks());
it("manual logout clears both this login and daily verification",async()=>{const response=await GET(new NextRequest("https://hub.test/auth/signout"));expect(m.signout).toHaveBeenCalledWith({scope:"local"});expect(response.cookies.get(DAILY_MFA_COOKIE_NAME)?.value).toBe("");expect(response.headers.get("location")).toBe("https://hub.test/login");});
it("daily expiration returns to normal login without the inactivity profile shortcut",async()=>{const response=await GET(new NextRequest("https://hub.test/auth/signout?reason=day"));expect(response.headers.get("location")).toBe("https://hub.test/login?day=1");});
