import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), enqueue: vi.fn(), drain: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { whatsAppConnection: { findUnique: mocks.find, update: mocks.update } } }));
vi.mock("@/modules/whatsapp/uazapi-events", () => ({ enqueueUazapiEvent: mocks.enqueue, drainUazapiInbox: mocks.drain }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
import { POST } from "./route";
import { tokenHash } from "@/modules/whatsapp/uazapi";
const context = { params: Promise.resolve({ id: "connection" }) };
const request = (token: string) => new Request("https://hub/api/whatsapp/uazapi/webhook/connection", { method: "POST", body: JSON.stringify({ EventType: "messages", token, message: { id: "a", messageid: "a", chatid: "123@s.whatsapp.net", text: "Oi" } }) });
beforeEach(() => { vi.clearAllMocks(); mocks.find.mockResolvedValue({ id: "connection", tokenHash: tokenHash("secret") }); mocks.update.mockResolvedValue({}); mocks.enqueue.mockResolvedValue(undefined); });
describe("Uazapi webhook authentication and durable delivery", () => {
  it("rejects the wrong token before persisting or processing messages", async () => {
    expect((await POST(request("wrong"), context)).status).toBe(401);
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("stores sanitized events before acknowledging and schedules processing", async () => {
    expect((await POST(request("secret"), context)).status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledOnce(); expect(JSON.stringify(mocks.enqueue.mock.calls[0][1])).not.toContain("secret"); expect(mocks.after).toHaveBeenCalledOnce();
  });
  it("does not acknowledge a message when durable storage fails", async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error("db unavailable"));
    await expect(POST(request("secret"), context)).rejects.toThrow("db unavailable"); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("rejects oversized payloads before querying connection credentials", async () => {
    expect((await POST(new Request("https://hub", { method: "POST", headers: { "content-length": "2000000" }, body: "{}" }), context)).status).toBe(413); expect(mocks.find).not.toHaveBeenCalled();
  });
});
