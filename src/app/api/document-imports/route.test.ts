import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), company: vi.fn(), options: vi.fn(), clients: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock("@/modules/document-imports/server", () => ({ importAccess: mocks.access, authorizedCompany: mocks.company, importOptions: mocks.options }));
vi.mock("@/lib/prisma", () => ({ prisma: { client: { findMany: mocks.clients }, documentImportReview: { findUnique: mocks.findUnique, upsert: mocks.upsert, findMany: vi.fn().mockResolvedValue([]) } } }));
import { GET, POST } from "./route";
import { parseInvestment } from "@/modules/document-imports/parsers";
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ member: { organizationId: "org", userId: "master" }, permission: { canView: true, canCreate: true, canImport: true } }); mocks.company.mockResolvedValue({ id: "company" }); mocks.clients.mockResolvedValue([]); mocks.findUnique.mockResolvedValue(null); mocks.upsert.mockResolvedValue({ id: "draft", fileName: "file.pdf" }); });
const request = () => new Request("https://example.test/api/document-imports", { method: "POST", body: JSON.stringify({ clientId: "company", fileName: "file.pdf", fingerprint: "a".repeat(64), data: parseInvestment([]) }) });
it("requires a session and module permission", async () => {
  mocks.access.mockResolvedValueOnce(null); expect((await GET(new Request("https://example.test/api/document-imports?kind=INVESTMENT"))).status).toBe(401);
  mocks.access.mockResolvedValueOnce({ member: {}, permission: { canView: false } }); expect((await GET(new Request("https://example.test/api/document-imports?kind=CONTRACT"))).status).toBe(403);
  mocks.access.mockResolvedValueOnce({ member: {}, permission: { canImport: false } }); expect((await POST(request())).status).toBe(403);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it("rejects foreign companies before storing parsed documents", async () => {
  mocks.company.mockResolvedValue(null); expect((await POST(request())).status).toBe(404); expect(mocks.upsert).not.toHaveBeenCalled();
});
it("uses an organization/company fingerprint and never overwrites existing reviews", async () => {
  mocks.findUnique.mockResolvedValue({ id: "draft" }); expect(await (await POST(request())).json()).toMatchObject({ duplicate: true });
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId_clientId_kind_fingerprint: { organizationId: "org", clientId: "company", kind: "INVESTMENT", fingerprint: "a".repeat(64) } }, update: {} }));
});
