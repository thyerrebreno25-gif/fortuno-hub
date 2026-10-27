import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ after: vi.fn(), sync: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/modules/management/sync", () => ({ runScheduledManagementSync: mocks.sync }));
vi.mock("@/modules/atendimento/gmail/sync", () => ({ pollGmailConnections: vi.fn() }));
import { POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "test-secret"); vi.stubEnv("INTEGRATION_TOKEN_ENCRYPTION_KEY", ""); vi.stubEnv("GMAIL_TOKEN_ENCRYPTION_KEY", ""); });
afterEach(() => vi.unstubAllEnvs());
it("requires the server secret before scheduling reads for all clients", async () => {
  for (const authorization of ["", "Bearer wrong", "Bearer ééé"]) {
    expect((await POST(new Request("https://hub.test/api/cron/management", { method: "POST", headers: { authorization } }))).status).toBe(401);
  }
  expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
});
it("accepts the valid cloud trigger and defers the batch until after the response", async () => {
  expect((await POST(new Request("https://hub.test/api/cron/management", { method: "POST", headers: { authorization: "Bearer test-secret" } }))).status).toBe(202);
  expect(mocks.sync).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0][0](); expect(mocks.sync).toHaveBeenCalledOnce();
});
it("fails closed if the secret is missing from the environment", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await POST(new Request("https://hub.test/api/cron/management", { method: "POST", headers: { authorization: "Bearer " } }))).status).toBe(401);
});
