import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ member: vi.fn(), correct: vi.fn() }));
vi.mock("@/modules/operations/auth", () => ({ getOperationMember: m.member }));
vi.mock("@/modules/operations/time-correction-server", () => ({ correctOperationTime: m.correct }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { POST } from "./route";
import { OperationTimerError } from "@/modules/operations/timer-server";
const input = { newEntryId: "22c6f4cc-3cc8-479d-a5fb-24f9a05c7340", startedAt: "2026-11-17T12:00:00Z", endedAt: "2026-11-17T13:00:00Z", reason: "Esqueci de iniciar" };
const request = (body: unknown = input) => new Request("https://hub.test/api/operations/activities/a/time-correction", { method: "POST", body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: "a" }) };
beforeEach(() => { vi.resetAllMocks(); m.member.mockResolvedValue({ userId: "u", organizationId: "org" }); m.correct.mockResolvedValue({ id: input.newEntryId, seconds: 3600 }); });
it("requires authentication and valid, justified periods before running a correction", async () => {
  m.member.mockResolvedValueOnce(null); expect((await POST(request(), context)).status).toBe(401);
  for (const body of [{}, { ...input, reason: " " }, { ...input, startedAt: "2026-02-30T12:00:00Z" }]) expect((await POST(request(body), context)).status).toBe(400);
  expect(m.correct).not.toHaveBeenCalled();
});
it.each([403, 404, 409])("preserves the service's authorization/conflict status %s", async status => {
  m.correct.mockRejectedValue(new OperationTimerError("Não permitido", status)); expect((await POST(request(), context)).status).toBe(status);
});
it("returns the saved entry without exposing unexpected database errors", async () => {
  expect(await (await POST(request(), context)).json()).toMatchObject({ entry: { seconds: 3600 } });
  expect(m.correct.mock.calls[0]).toEqual([{ userId: "u", organizationId: "org" }, "a", input]);
  m.correct.mockRejectedValue(new Error("PRIVATE_DATABASE_DETAIL"));
  const failed = await POST(request(), context); expect(failed.status).toBe(500); expect(await failed.text()).not.toContain("PRIVATE_DATABASE_DETAIL");
});
