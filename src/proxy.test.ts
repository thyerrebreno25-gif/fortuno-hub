import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
beforeEach(() => { session.user = null; });
vi.mock("@/lib/auth/daily-mfa", () => ({ DAILY_MFA_COOKIE_NAME: "daily", verifyDailyMfaToken: async () => true }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: session.user } }),
      mfa: {
        listFactors: async () => ({ data: { totp: [{ id: "factor" }] } }),
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }),
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
