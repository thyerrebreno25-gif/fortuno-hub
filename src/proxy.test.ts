import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ user: null as { id: string; last_sign_in_at?: string } | null, totp: true, aal: "aal2", daily: true }));
beforeEach(() => { session.user = null; session.totp = true; session.aal = "aal2"; session.daily = true; });
vi.mock("@/lib/auth/daily-mfa", () => ({ DAILY_MFA_COOKIE_NAME: "daily", verifyDailyMfaToken: async () => session.daily }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: session.user } }),
      mfa: {
        listFactors: async () => ({ data: { totp: session.totp ? [{ id: "factor" }] : [] } }),
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: session.aal } }),
      },
    },
  }),
}));

import { proxy } from "./proxy";

it("restores task management without redirecting authenticated members home", async () => {
  session.user = { id: "user" };
  const response = await proxy(new NextRequest("https://example.test/operacoes"));
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

it("keeps task management behind login", async () => {
  const response = await proxy(new NextRequest("https://example.test/operacoes"));
  expect(response.headers.get("location")).toBe("https://example.test/login");
});

it("lets the meeting cron reach its Bearer authentication without a user session", async () => {
  const response = await proxy(new NextRequest("https://example.test/api/cron/meeting-reminders"));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
});
it("lets the management scheduler reach its Bearer check without a browser session", async () => {
  const response = await proxy(new NextRequest("https://example.test/api/cron/management", { method: "POST" }));
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

it("restores the email central for an authenticated member with MFA", async () => {
  session.user = { id: "user" };
  const response = await proxy(new NextRequest("https://example.test/atendimento"));
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

it("keeps the restored email central behind login", async () => {
  const response = await proxy(new NextRequest("https://example.test/atendimento"));
  expect(response.headers.get("location")).toBe("https://example.test/login");
});

it("still redirects unauthenticated visitors of the meetings API to login", async () => {
  const response = await proxy(new NextRequest("https://example.test/api/meetings"));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://example.test/login");
});

it("serves the privacy policy without authentication", async () => {
  const response = await proxy(new NextRequest("https://example.test/politica-de-privacidade"));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

it("serves the terms of service without authentication", async () => {
  const response = await proxy(new NextRequest("https://example.test/termos-de-servico"));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
});


it("does not let API resource names bypass authentication by ending in an image extension", async () => {
  const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server");
  const { config } = await import("./proxy");
  for (const suffix of ["png", "svg", "jpg", "webp"]) {
    expect(unstable_doesMiddlewareMatch({ config, url: "/api/onboarding/projects/resource." + suffix })).toBe(true);
  }
  expect(unstable_doesMiddlewareMatch({ config, url: "/fortuno-logo.png" })).toBe(false);
  expect(unstable_doesMiddlewareMatch({ config, url: "/_next/static/file.js" })).toBe(false);
});


it("blocks protected APIs until the second factor has been enrolled", async () => {
  session.user = { id: "user", last_sign_in_at: new Date().toISOString() }; session.totp = false;
  const response = await proxy(new NextRequest("https://example.test/api/onboarding/projects"));
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("MFA_ENROLLMENT_REQUIRED");
});
it("blocks APIs after daily verification expires until a new MFA challenge succeeds", async () => {
  session.user = { id: "user", last_sign_in_at: new Date().toISOString() }; session.aal = "aal1"; session.daily = false;
  const response = await proxy(new NextRequest("https://example.test/api/onboarding/projects/file.png"));
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("MFA_CHALLENGE_REQUIRED");
});
it("honors the signed daily verification for a member with an enrolled factor", async () => {
  session.user = { id: "user" }; session.aal = "aal1";
  const response = await proxy(new NextRequest("https://example.test/api/onboarding/projects"));
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

it("allows only the public satisfaction page and response API without opening management APIs", async()=>{
  for(const path of ["/satisfacao/preview","/api/satisfacao/token"]){const r=await proxy(new NextRequest("https://example.test"+path));expect(r.headers.get("x-middleware-next")).toBe("1");expect(r.headers.get("location")).toBeNull();}
  for(const path of ["/api/whatsapp/surveys","/api/whatsapp/finalize-batch","/api/satisfacao-admin"]){const r=await proxy(new NextRequest("https://example.test"+path));expect(r.headers.get("location")).toBe("https://example.test/login");}
});

it("preserves password recovery tokens before the authenticated-login redirect",async()=>{session.user={id:"user"};const response=await proxy(new NextRequest("https://example.test/login?token_hash=hash&type=recovery"));expect(response.headers.get("location")).toBe("https://example.test/recuperar-senha?token_hash=hash&type=recovery");});
it("recovers a PKCE code that was sent to the site URL after a reset request",async()=>{const response=await proxy(new NextRequest("https://example.test/?code=one-time",{headers:{cookie:"fortuno-password-recovery=1"}}));expect(response.headers.get("location")).toBe("https://example.test/recuperar-senha?code=one-time&recovery=1");});

it("requires a new daily login even if yesterday's session is still AAL2",async()=>{session.user={id:"user",last_sign_in_at:"2000-01-01T12:00:00Z"};session.aal="aal2";session.daily=false;const api=await proxy(new NextRequest("https://example.test/api/management"));expect(api.status).toBe(401);expect((await api.json()).code).toBe("DAILY_LOGIN_REQUIRED");const page=await proxy(new NextRequest("https://example.test/inicio"));expect(page.headers.get("location")).toBe("https://example.test/auth/signout?reason=day");});
it("requires today's MFA cookie after a new password login, while allowing its authenticated mint endpoint",async()=>{session.user={id:"user",last_sign_in_at:new Date().toISOString()};session.aal="aal2";session.daily=false;const page=await proxy(new NextRequest("https://example.test/inicio"));expect(page.headers.get("location")).toBe("https://example.test/mfa");const mint=await proxy(new NextRequest("https://example.test/api/auth/mfa/daily",{method:"POST"}));expect(mint.headers.get("x-middleware-next")).toBe("1");});

it("preserves a recovery code even when Site URL returns it on another domain without cookies",async()=>{
 const response=await proxy(new NextRequest("https://example.test/?code=one-time"));
 expect(response.headers.get("location")).toBe("https://example.test/recuperar-senha?code=one-time&recovery=1");
});
it("keeps valid, expired and MFA recovery links public instead of sending them to login",async()=>{
 for(const user of [null,{id:"user",last_sign_in_at:"2000-01-01T12:00:00Z"}]){
 session.user=user;session.daily=false;
 for(const suffix of ["?token_hash=hash&type=recovery","?recovery=1","?error_code=otp_expired"]){
 const response=await proxy(new NextRequest("https://example.test/recuperar-senha"+suffix));expect(response.headers.get("location")).toBeNull();expect(response.headers.get("x-middleware-next")).toBe("1");
 }
 }
});

it("lets only the exact public recovery endpoint handle its own origin and rate limits",async()=>{
 expect((await proxy(new NextRequest("https://example.test/api/auth/password-recovery",{method:"POST"}))).headers.get("x-middleware-next")).toBe("1");
 expect((await proxy(new NextRequest("https://example.test/api/auth/password-recovery/complete",{method:"POST"}))).headers.get("x-middleware-next")).toBe("1");
 expect((await proxy(new NextRequest("https://example.test/api/auth/password-recovery/complete/admin"))).headers.get("location")).toBe("https://example.test/login");
 expect((await proxy(new NextRequest("https://example.test/api/auth/password-recovery-admin"))).headers.get("location")).toBe("https://example.test/login");
});
