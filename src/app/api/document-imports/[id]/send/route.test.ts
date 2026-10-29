import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), company: vi.fn(), find: vi.fn(), send: vi.fn(), contractSend: vi.fn() }));
vi.mock("@/modules/document-imports/server", () => ({ importAccess: mocks.access, authorizedCompany: mocks.company }));
vi.mock("@/modules/document-imports/delivery", () => ({ sendInvestmentReview: mocks.send, deliverySummary: {} }));
vi.mock("@/modules/document-imports/contract-delivery", () => ({ sendContractReview: mocks.contractSend }));
vi.mock("@/lib/prisma", () => ({ prisma: { documentImportReview: { findFirst: mocks.find } } }));
import { POST } from "./route";
const context = { params: Promise.resolve({ id: "draft" }) };
const request = (confirmation = "ENVIAR AO CA") => new Request("https://example.test/api/document-imports/draft/send", { method: "POST", body: JSON.stringify({ version: 1, confirmation }) });
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ member: { organizationId: "org", userId: "master" }, permission: { canView: true, canExport: true, canEdit: true, canCreate: true } }); mocks.company.mockResolvedValue({}); mocks.find.mockResolvedValue({ id: "draft", clientId: "company", version: 1 }); mocks.send.mockResolvedValue({ completed: true }); });
it("requires session, send permission, explicit confirmation and an authorized company", async () => {
  mocks.access.mockResolvedValueOnce(null); expect((await POST(request(), context)).status).toBe(401);
  mocks.access.mockResolvedValueOnce({ permission: { canView: true, canEdit: true, canExport: false } }); expect((await POST(request(), context)).status).toBe(403);
  expect((await POST(request(""), context)).status).toBe(400);
  mocks.company.mockResolvedValueOnce(null); expect((await POST(request(), context)).status).toBe(404);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("passes the stored review identity and version rather than accepting a financial payload", async () => {
  expect((await POST(request(), context)).status).toBe(200);
  expect(mocks.send).toHaveBeenCalledWith({ organizationId: "org", userId: "master", reviewId: "draft", version: 1 });
  expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "draft", organizationId: "org", kind: "INVESTMENT" } }));
});
it("uses contract permissions and the contract sender for real recurring contracts", async () => {
  mocks.contractSend.mockResolvedValueOnce({ completed: true });
  const response = await POST(new Request("https://example.test/api/document-imports/draft/send", { method: "POST", body: JSON.stringify({ kind: "CONTRACT", version: 1, confirmation: "ENVIAR AO CA" }) }), context);
  expect(response.status).toBe(200);
  expect(mocks.access).toHaveBeenCalledWith("CONTRACT");
  expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "draft", organizationId: "org", kind: "CONTRACT" } }));
  expect(mocks.contractSend).toHaveBeenCalledWith({ organizationId: "org", userId: "master", reviewId: "draft", version: 1 });
  expect(mocks.send).not.toHaveBeenCalled();
});
it("requires create permission before automatically registering a missing buyer",async()=>{
  mocks.access.mockResolvedValueOnce({member:{organizationId:"org",userId:"user"},permission:{canView:true,canExport:true,canEdit:true,canCreate:false}});
  const response=await POST(new Request("https://example.test/api/document-imports/draft/send",{method:"POST",body:JSON.stringify({kind:"CONTRACT",version:1,confirmation:"ENVIAR AO CA"})}),context);
  expect(response.status).toBe(403);expect(mocks.contractSend).not.toHaveBeenCalled();
});
