import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), permissions: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { notionConnection: { findUnique: mocks.findUnique, upsert: mocks.upsert, deleteMany: mocks.deleteMany } } }));
vi.mock("@/modules/permissions/permissions", () => ({ getCurrentMember: mocks.member, getRolePermissions: mocks.permissions }));
vi.mock("@/modules/purchase-invoices/server/crypto", () => ({ encryptIntegrationSecret: mocks.encrypt, decryptIntegrationSecret: mocks.decrypt }));
import { GET, POST, DELETE } from "./route";
import { notionFetch } from "@/modules/notion/server";
const token = "ntn_test_private_key_123456789";
beforeEach(() => {
  vi.clearAllMocks(); mocks.member.mockResolvedValue({ organizationId: "org", userId: "u", role: "MASTER" }); mocks.permissions.mockResolvedValue({ NOTION: { canView: true, canManage: true } }); mocks.findUnique.mockResolvedValue({ encryptedToken: "ciphertext" }); mocks.encrypt.mockReturnValue("ciphertext"); mocks.decrypt.mockReturnValue(token); mocks.upsert.mockResolvedValue({ botName: "Hub", workspaceName: "Equipe", checkedAt: "now" });
});
afterEach(() => vi.unstubAllGlobals());
it("requires a session and enforces view and management separately", async () => {
  mocks.member.mockResolvedValueOnce(null);
  expect((await GET(new Request("https://hub.test/api/integrations/notion"))).status).toBe(401);
  mocks.permissions.mockResolvedValueOnce({ NOTION: { canView: false } });
  expect((await GET(new Request("https://hub.test/api/integrations/notion?view=search"))).status).toBe(403);
  mocks.permissions.mockResolvedValueOnce({ NOTION: { canView: true, canManage: false } });
  expect((await DELETE()).status).toBe(403); expect(mocks.deleteMany).not.toHaveBeenCalled();
});
it("validates before saving an encrypted token and returns only safe metadata", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: "bot", name: "Hub", bot: { workspace_name: "Equipe" } }))).mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }))));
  const result = await POST(new Request("https://hub.test/api/integrations/notion", { method: "POST", body: JSON.stringify({ token }) }));
  expect(result.status).toBe(200); expect(await result.text()).not.toContain(token);
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org" }, update: expect.objectContaining({ encryptedToken: "ciphertext" }) }));
});
it("leaves an existing connection unchanged when validation fails and does not leak upstream errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: token }), { status: 401 })));
  const result = await POST(new Request("https://hub.test/api/integrations/notion", { method: "POST", body: JSON.stringify({ token }) }));
  expect(result.status).toBe(400); expect(await result.text()).not.toContain(token); expect(mocks.upsert).not.toHaveBeenCalled();
});
it("isolates credentials by organization and forwards opaque pagination cursors", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [], has_more: false })));
  vi.stubGlobal("fetch", fetchMock);
  await GET(new Request("https://hub.test/api/integrations/notion?view=search&cursor=opaque%2Bvalue"));
  expect(mocks.findUnique).toHaveBeenCalledWith({ where: { organizationId: "org" } });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).start_cursor).toBe("opaque+value");
  expect(fetchMock.mock.calls[0][1].headers["Notion-Version"]).toBe("2026-03-11");
});
it("rejects malicious record IDs before requesting a remote resource", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect((await GET(new Request("https://hub.test/api/integrations/notion?view=page&id=https://evil.test"))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("reports Notion rate limiting without exposing provider details", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
  await expect(notionFetch(token, "/search", { page_size: 1 })).rejects.toThrow("limitou");
});
it("queries the data source, paginates rows and exposes safe display fields", async () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id, object: "data_source", title: [{ plain_text: "Clientes" }], properties: { Nome: { type: "title" } } }))).mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: "row", object: "page", properties: { Nome: { type: "title", title: [{ plain_text: "Cliente A" }] } } }], has_more: true, next_cursor: "next-opaque" })));
  vi.stubGlobal("fetch", fetchMock);
  const result = await GET(new Request(`https://hub.test/api/integrations/notion?view=data_source&id=${id}&cursor=current-opaque`));
  const body = await result.json();
  expect(body.items[0].properties.Nome).toBe("Cliente A"); expect(body.cursor).toBe("next-opaque");
  expect(fetchMock.mock.calls[1][0]).toBe(`https://api.notion.com/v1/data_sources/${id}/query`);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).start_cursor).toBe("current-opaque");
});
