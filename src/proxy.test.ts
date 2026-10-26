import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

import { proxy } from "./proxy";

it("lets the meeting cron reach its Bearer authentication without a user session", async () => {
  const response = await proxy(new NextRequest("https://example.test/api/cron/meeting-reminders"));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

it("still redirects unauthenticated visitors of the meetings API to login", async () => {
  const response = await proxy(new NextRequest("https://example.test/api/meetings"));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://example.test/login");
});
