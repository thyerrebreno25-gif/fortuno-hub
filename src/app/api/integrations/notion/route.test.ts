import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), permissions: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { notionConnection: { findUnique: mocks.findUnique, upsert: mocks.upsert, deleteMany: mocks.deleteMany } } }));
vi.mock("@/modules/permissions/permissions", () => ({ getCurrentMember: mocks.member, getRolePermissions: mocks.permissions }));
vi.mock("@/modules/purchase-invoices/server/crypto", () => ({ encryptIntegrationSecret: mocks.encrypt, decryptIntegrationSecret: mocks.decrypt }));
import { GET, POST, DELETE } from "./route";
import { notionFetch, readNotionBlocks } from "@/modules/notion/server";
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
it("retrieves relation pages by property with permission-aware fallback", async () => {
  const id = "22222222-2222-4222-8222-222222222222", related = "11111111-1111-4111-8111-111111111111";
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ relation: { id: related } }], has_more: true, next_cursor: "more-relations" }))).mockResolvedValueOnce(new Response("", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  const result = await GET(new Request(`https://hub.test/api/integrations/notion?view=relation&id=${id}&property=a%2Fb`));
  const body = await result.json();
  expect(fetchMock.mock.calls[0][0]).toContain(`/properties/a%2Fb?page_size=8`);
  expect(body.items[0]).toMatchObject({ id: related, unavailable: true });
  expect(body.cursor).toBe("more-relations");
});
it("flattens layout columns and names an untitled inner database after its heading", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: "layout", type: "column_list", has_children: true }], has_more: true, next_cursor: "next-root" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: "column", type: "column", has_children: true }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: "h", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Acessos & Senhas" }] } }, { id: "database", type: "child_database", child_database: { title: "Untitled" } }] })));
  vi.stubGlobal("fetch", fetchMock);
  const result = await readNotionBlocks(token, "root");
  expect(result.blocks.map((block) => block.type)).toEqual(["heading_2", "child_database"]);
  expect(result.blocks[1].text).toBe("Acessos & Senhas");
  expect(result.cursor).toBe("next-root");
});
it("discovers linked database views without falling back to unfiltered sources", async () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id, object: "database", data_sources: [] }))).mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id, name: "Acessos" }] })));
  vi.stubGlobal("fetch", fetchMock);
  const result = await GET(new Request(`https://hub.test/api/integrations/notion?view=database&id=${id}`));
  expect((await result.json()).sources[0]).toMatchObject({ kind: "saved_view", title: "Acessos" });
  expect(fetchMock.mock.calls[1][0]).toContain(`/views?database_id=${id}`);
});
it("keeps saved client and quick filters when searching a linked view", async () => {
  const id = "22222222-2222-4222-8222-222222222222", source = "11111111-1111-4111-8111-111111111111";
  const clientFilter = { property: "Cliente", relation: { contains: id } };
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data_source_id: source, filter: clientFilter, quick_filters: { Ativo: { checkbox: { equals: true } }, Vazio: {} } }))).mockResolvedValueOnce(new Response(JSON.stringify({ id: source, object: "data_source", properties: { Nome: { type: "title" } } }))).mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
  vi.stubGlobal("fetch", fetchMock);
  const result = await GET(new Request(`https://hub.test/api/integrations/notion?view=saved_view&id=${id}&query=banco`));
  expect(result.status).toBe(200);
  const query = JSON.parse(fetchMock.mock.calls[2][1].body);
  expect(query.filter.and).toContainEqual(clientFilter);
  expect(query.filter.and).toContainEqual({ property: "Ativo", checkbox: { equals: true } });
  expect(query.filter.and).toHaveLength(3);
});
it("includes access details nested in lists and paragraphs without dropping the parent", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: "access", type: "bulleted_list_item", has_children: true, bulleted_list_item: { rich_text: [{ plain_text: "Acesso de exemplo" }] } }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: "password", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "Senha: exemplo fictício" }] } }, { id: "nested", type: "paragraph", has_children: true }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: "detail", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Detalhe do acesso" }] } }] })));
  vi.stubGlobal("fetch", fetchMock);
  const result = await readNotionBlocks(token, "root");
  expect(result.blocks.map((block) => block.id)).toEqual(["access", "password", "nested", "detail"]);
  expect(result.blocks[0].expanded).toBe(true);
  expect(result.blocks[1]).toMatchObject({ depth: 1, text: "Senha: exemplo fictício" });
  expect(result.blocks[3].depth).toBe(2);
});
