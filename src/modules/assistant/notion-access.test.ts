import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), permissions: vi.fn(), mapping: vi.fn(), token: vi.fn(), fetch: vi.fn(), blocks: vi.fn(), audit: vi.fn() }));
vi.mock("./auth", () => ({ findAssistantClient: mocks.client }));
vi.mock("@/modules/permissions/permissions", () => ({ getRolePermissions: mocks.permissions }));
vi.mock("@/lib/prisma", () => ({ prisma: { clientManagement: { findFirst: mocks.mapping }, auditLog: { create: mocks.audit } } }));
vi.mock("@/modules/notion/server", () => ({ notionToken: mocks.token, notionFetch: mocks.fetch, readNotionBlocks: mocks.blocks }));
import { getClientNotionAccess } from "./notion-access";
import type { AssistantMember } from "./auth";
const member = { organizationId: "org", userId: "u", role: "OPERATOR" } as AssistantMember;
const pageId = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.resetAllMocks(); mocks.client.mockResolvedValue({ id: "c", name: "Cliente" }); mocks.permissions.mockResolvedValue({ NOTION: { canView: true } });
  mocks.mapping.mockResolvedValue({ notionPageId: pageId }); mocks.token.mockResolvedValue("secret");
  mocks.fetch.mockResolvedValue({ id: pageId, object: "page", properties: { Nome: { type: "title", title: [{ plain_text: "Cliente" }] } }, url: `https://www.notion.so/${pageId}` });
  mocks.blocks.mockResolvedValue({ blocks: [{ type: "paragraph", text: "Itaú: usuário operador" }], cursor: null });
});
it("denies cross-client and revoked Notion access before fetching secrets", async () => {
  mocks.client.mockResolvedValueOnce(null);
  await expect(getClientNotionAccess(member, "other", "acesso")).rejects.toThrow("fora do seu acesso");
  expect(mocks.token).not.toHaveBeenCalled();
  mocks.permissions.mockResolvedValueOnce({ NOTION: { canView: false } });
  await expect(getClientNotionAccess(member, "c", "acesso")).rejects.toThrow("acesso ao módulo Notion");
  expect(mocks.token).not.toHaveBeenCalled();
});
it("reads the organization mapping and logs metadata without credentials", async () => {
  const result = await getClientNotionAccess(member, "c", "acesso Itaú");
  expect(mocks.mapping).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: "c", organizationId: "org" } }));
  expect(result.sections[0].text).toContain("Itaú: usuário operador");
  expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("operador");
  expect(result.sourceUrl).toContain("notion.so");
});
it("refuses ambiguous automatic matches instead of choosing another client's page", async () => {
  mocks.mapping.mockResolvedValueOnce(null);
  mocks.fetch.mockResolvedValueOnce({ results: [{ properties: { Nome: { type: "title", title: [{ plain_text: "Cliente" }] } } }, { properties: { Nome: { type: "title", title: [{ plain_text: "Cliente" }] } } }] });
  await expect(getClientNotionAccess(member, "c", "acesso")).rejects.toThrow("Vincule a página correta");
  expect(mocks.blocks).not.toHaveBeenCalled();
});
it("does not query unrestricted linked databases", async () => {
  mocks.blocks.mockResolvedValue({ blocks: [{ id: "db", type: "child_database", text: "Acessos" }], cursor: null });
  mocks.fetch.mockImplementation(async (_token: string, path: string) => path.startsWith("/databases") ? { data_sources: [], parent: {} } : path.startsWith("/views?") ? { results: [{ id: "view" }] } : path === "/views/view" ? { data_source_id: "shared", filter: {} } : { id: pageId, properties: {} });
  const result = await getClientNotionAccess(member, "c", "acesso");
  expect(result.notices.join(" ")).toContain("não tem restrição de cliente");
  expect(mocks.fetch.mock.calls.some((call) => String(call[1]).includes("/data_sources/shared/query"))).toBe(false);
});
