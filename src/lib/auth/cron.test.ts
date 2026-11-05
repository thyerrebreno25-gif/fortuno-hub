import { afterEach, beforeEach, expect, it, vi } from "vitest";
const jobs = vi.hoisted(() => ({ purge: vi.fn(), reminders: vi.fn() }));
vi.mock("@/modules/atendimento/retention", () => ({ purgeExpiredServiceTickets: jobs.purge }));
vi.mock("@/modules/settings/server/automatic-invite-reminders", () => ({ sendAutomaticPendingInviteReminders: jobs.reminders }));
import { GET as retention } from "@/app/api/cron/atendimento-retention/route";
import { GET as reminders } from "@/app/api/cron/member-invite-reminders/route";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "test-secret"); });
afterEach(() => vi.unstubAllEnvs());
for (const [name, handler, job] of [["retention", retention, jobs.purge], ["reminders", reminders, jobs.reminders]] as const) {
  it(name + " rejects missing, forged and Unicode credentials before running the job", async () => {
    for (const authorization of ["", "Bearer wrong", "Bearer ééé"]) {
      const response = await handler(new Request("https://hub.test/api/cron/" + name, { headers: { authorization, "user-agent": "vercel-cron/1.0" } }));
      expect(response.status).toBe(401);
    }
    expect(job).not.toHaveBeenCalled();
  });
  it(name + " cannot be triggered with a spoofed scheduler header when unconfigured", async () => {
    vi.stubEnv("CRON_SECRET", " ");
    expect((await handler(new Request("https://hub.test/api/cron/" + name, { headers: { "user-agent": "vercel-cron/1.0" } }))).status).toBe(401);
    expect(job).not.toHaveBeenCalled();
  });
  it(name + " accepts the configured Bearer secret", async () => {
    job.mockResolvedValue({ processed: 0 });
    expect((await handler(new Request("https://hub.test/api/cron/" + name, { headers: { authorization: "Bearer test-secret" } }))).status).toBe(200);
    expect(job).toHaveBeenCalledOnce();
  });
}
