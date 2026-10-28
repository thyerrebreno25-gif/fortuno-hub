import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ update: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { whatsAppConnection: { update: m.update } } }));
vi.mock("@/modules/purchase-invoices/server/crypto", () => ({ decryptIntegrationSecret: () => "private-token" }));
vi.mock("./uazapi", async (original) => ({ ...await original<typeof import("./uazapi")>(), uazapiRequest: m.request }));
import { checkConnection, configureWebhook, connectionView, type whatsappConnection } from "./uazapi-server";
const connection = { id: "connection", instanceId: "instance", organizationId: "org", serverUrl: "https://free.uazapi.com", tokenEncrypted: "encrypted-secret", tokenHash: "private-hash", status: "DISCONNECTED", expiresAt: null } as NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
beforeEach(() => { vi.clearAllMocks(); m.update.mockResolvedValue({}); });
describe("Uazapi server-side connection", () => {
  it("projects connection information without credentials", () => {
    const result = JSON.stringify(connectionView(connection)); expect(result).not.toMatch(/encrypted-secret|private-hash|tokenEncrypted|tokenHash/);
    expect(connectionView({ ...connection, expiresAt: new Date(0) }).status).toBe("EXPIRED");
  });
  it("adds its webhook without replacing other subscriptions", async () => {
    const url = "https://app.hubsuporte.shop/api/whatsapp/uazapi/webhook/connection";
    m.request.mockResolvedValueOnce([{ id: "other", url: "https://other.example/hook" }]).mockResolvedValueOnce({}).mockResolvedValueOnce([{ id: "own", url, enabled: true, events: ["messages", "messages_update", "connection"] }]);
    await configureWebhook(connection);
    expect(m.request.mock.calls[1][3]).toMatchObject({ action: "add", url, excludeMessages: [] }); expect(m.request.mock.calls[1][3].id).toBeUndefined(); expect(m.update.mock.calls[0][0].data.webhookId).toBe("own");
  });
  it("does not claim receiving is configured until the provider confirms it", async () => {
    m.request.mockResolvedValueOnce([]).mockResolvedValueOnce({}).mockResolvedValueOnce([]);
    await expect(configureWebhook(connection)).rejects.toThrow("não foi confirmada"); expect(m.update).not.toHaveBeenCalled();
  });
  it("refuses credentials that resolve to another instance", async () => {
    m.request.mockResolvedValueOnce({ instance: { id: "another", status: "connected" } }); await expect(checkConnection(connection)).rejects.toThrow("outra instância"); expect(m.update).not.toHaveBeenCalled();
  });
});
