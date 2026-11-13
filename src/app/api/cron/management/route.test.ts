vi.mock("@/modules/auth/password-recovery",()=>({processPasswordRecoveryQueue:mocks.recovery}));
vi.mock("@/modules/whatsapp/surveys",()=>({processWhatsAppSurveys:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@/modules/meetings/fathom",()=>({syncConnectedFathom:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@/modules/meetings/reports",()=>({processQueuedMeetingReports:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@/modules/whatsapp/directory",()=>({scheduleConnectedDirectories:vi.fn().mockResolvedValue(undefined),processDirectorySync:vi.fn().mockResolvedValue(undefined)}));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ after: vi.fn(), sync: vi.fn(), calendar: vi.fn(), recovery: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/modules/management/sync", () => ({ runScheduledManagementSync: mocks.sync }));
vi.mock("@/modules/atendimento/gmail/sync", () => ({ pollGmailConnections: vi.fn() }));
vi.mock("@/modules/notion/client-sync", () => ({ runNotionClientSync: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/modules/meetings/google-calendar",()=>({syncCalendarEvents:mocks.calendar}));
vi.mock("@/modules/whatsapp/history-sync",()=>({scheduleConnectedHistory:vi.fn().mockResolvedValue(undefined),processWhatsAppHistory:vi.fn().mockResolvedValue(undefined)}));
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
  expect(mocks.sync).not.toHaveBeenCalled(); expect(mocks.calendar).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0][0](); expect(mocks.sync).toHaveBeenCalledOnce(); expect(mocks.calendar).toHaveBeenCalledOnce(); expect(mocks.recovery).toHaveBeenCalledOnce();
});
it("fails closed if the secret is missing from the environment", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await POST(new Request("https://hub.test/api/cron/management", { method: "POST", headers: { authorization: "Bearer " } }))).status).toBe(401);
});
