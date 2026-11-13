import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ verify: vi.fn(), createVerifier: vi.fn(), admin: vi.fn(), update: vi.fn(), signOut: vi.fn(), member: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: m.createVerifier }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: m.member } } }));
vi.mock("@/modules/auth/password-recovery", () => ({ recoveryOrigin: () => "https://app.hubsuporte.shop" }));
import { POST } from "./route";
const tokenHash = "fresh-single-use-recovery-token";
const password = "new-password-for-unit-test";
function request(body: unknown = { tokenHash, password }, origin: string | null = "https://app.hubsuporte.shop") {
  return new Request("https://app.hubsuporte.shop/api/auth/password-recovery/complete", {
    method: "POST", headers: origin ? { origin } : {}, body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
  m.createVerifier.mockReturnValue({ auth: { verifyOtp: m.verify } });
  m.admin.mockReturnValue({ auth: { admin: { updateUserById: m.update, signOut: m.signOut } } });
  m.verify.mockResolvedValue({ data: { user: { id: "verified-user", factors: [{ status: "verified", factor_type: "totp" }] }, session: { access_token: "recovery-session" } }, error: null });
  m.member.mockResolvedValue({ id: "verified-user" });
  m.update.mockResolvedValue({ error: null });
  m.signOut.mockResolvedValue({ error: null });
});
it("allows email-only reset with an enrolled authenticator, bound exclusively to the provider-verified user", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(m.verify).toHaveBeenCalledWith({ token_hash: tokenHash, type: "recovery" });
  expect(m.member).toHaveBeenCalledWith({ where: { id: "verified-user", memberships: { some: {} } }, select: { id: true } });
  expect(m.update).toHaveBeenCalledExactlyOnceWith("verified-user", { password });
  expect(m.signOut).toHaveBeenCalledWith("recovery-session", "global");
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain("fortuno_mfa_daily="); expect(cookie).toContain("Max-Age=0");
  expect(cookie).not.toContain("recovery-session");
  expect(m.createVerifier).toHaveBeenCalledWith("https://auth.example.test", "public-key", { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
});
it("rejects invalid, expired or replayed tokens without a privileged update", async () => {
  m.verify.mockResolvedValue({ data: { user: null, session: null }, error: { message: "private upstream detail" } });
  const response = await POST(request());
  expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ invalidLink: true });
  expect(m.update).not.toHaveBeenCalled(); expect(m.member).not.toHaveBeenCalled();
});
it("cannot reset a second time after Supabase consumes the emailed token", async () => {
  expect((await POST(request())).status).toBe(200);
  m.verify.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: "otp_expired" } });
  expect((await POST(request())).status).toBe(400);
  expect(m.update).toHaveBeenCalledTimes(1);
});
it("does not permit a valid token for a user without current Hub membership", async () => {
  m.member.mockResolvedValue(null); const response = await POST(request());
  expect(response.status).toBe(400); expect(m.update).not.toHaveBeenCalled();
  expect(m.signOut).toHaveBeenCalledWith("recovery-session", "global");
});
it("never accepts caller identities, regular sessions or a different OTP type", async () => {
  for (const body of [{ email: "victim@example.test", password }, { accessToken: "ordinary-session", password }, { tokenHash, password, userId: "victim" }, { tokenHash, password, type: "invite" }]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  expect(m.verify).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
it("rejects missing or foreign origin and malformed, oversized or weak-password input before token consumption", async () => {
  for (const origin of [null, "https://evil.example"]) expect((await POST(request(undefined, origin))).status).toBe(403);
  for (const body of ["not json", { tokenHash, password: "short" }, { tokenHash, password: "x".repeat(129) }, { tokenHash: "x".repeat(3000), password }]) expect((await POST(request(body))).status).toBe(400);
  expect(m.verify).not.toHaveBeenCalled();
});
it("requires a replacement link if the password provider rejects the change and does not expose its body", async () => {
  m.update.mockResolvedValue({ error: { message: "private provider details" } });
  const response = await POST(request()); const body = await response.json();
  expect(response.status).toBe(400); expect(body.invalidLink).toBe(true); expect(JSON.stringify(body)).not.toContain("private");
  expect(m.signOut).toHaveBeenCalled();
});
it("fails closed when server authentication is unavailable", async () => {
  m.admin.mockReturnValue(null); const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try { expect((await POST(request())).status).toBe(503); expect(m.verify).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); }
  finally { spy.mockRestore(); }
});
