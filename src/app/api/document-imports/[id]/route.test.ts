import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), company: vi.fn(), simulate: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/modules/document-imports/server", () => ({ importAccess: mocks.access, authorizedCompany: mocks.company, simulateReview: mocks.simulate }));
vi.mock("@/lib/prisma", () => ({ prisma: { documentImportReview: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } } }));
import { PATCH } from "./route";
import { parseInvestment } from "@/modules/document-imports/parsers";
const context = { params: Promise.resolve({ id: "draft" }) };
const request = (action = "save") => new Request("https://example.test/api/document-imports/draft", { method: "PATCH", body: JSON.stringify({ action, version: 1, data: parseInvestment([]) }) });
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ member: { organizationId: "org" }, permission: { canEdit: true } }); mocks.company.mockResolvedValue({}); mocks.findFirst.mockResolvedValue({ id: "draft", clientId: "company", version: 1 }); mocks.updateMany.mockResolvedValue({ count: 1 }); });
it("scopes the record to the organization and rejects stale versions", async () => {
  mocks.findFirst.mockResolvedValueOnce({ version: 2, clientId: "company" }); expect((await PATCH(request(), context)).status).toBe(409);
  expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "draft", organizationId: "org", kind: "INVESTMENT", status: { not: "DELETED" } } }); expect(mocks.updateMany).not.toHaveBeenCalled();
});
it("invalidates a previous simulation when the review changes", async () => {
  expect((await PATCH(request(), context)).status).toBe(200);
  expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "draft", organizationId: "org", version: 1, deliveries: { none: {} } }, data: expect.objectContaining({ status: "REVIEW", version: { increment: 1 } }) }));
  expect(mocks.simulate).not.toHaveBeenCalled();
});
it("does not mark the draft tested when CA validation has errors", async () => {
  mocks.simulate.mockResolvedValue({ errors: ["Conta inválida"], writesToContaAzul: 0 });
  expect((await PATCH(request("simulate"), context)).status).toBe(200);
  expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REVIEW" }) }));
});
