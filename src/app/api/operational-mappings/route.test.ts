import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), permissions: vi.fn(), find: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), client: vi.fn() }));
vi.mock("@/modules/assistant/auth", () => ({ getMappingMember: mocks.member, assistantClientAccessWhere: () => ({ operationLeaderId: "user" }), hasOrganizationClientScope: (member: { role: string }) => member.role === "ADMIN" }));
vi.mock("@/modules/permissions/permissions", () => ({ getRolePermissions: mocks.permissions }));
vi.mock("@/lib/prisma", () => ({ prisma: { operationalMapping: { findFirst: mocks.find, create: mocks.create }, client: { findFirst: mocks.client }, $transaction: (cb: (tx: unknown) => unknown) => cb({ operationalMapping: { updateMany: mocks.updateMany, findUniqueOrThrow: mocks.findUniqueOrThrow } }) } }));
import { GET, POST, PATCH } from "./route";
import { emptyMapping } from "@/modules/operational-mapping/model";
beforeEach(() => { vi.clearAllMocks(); mocks.member.mockResolvedValue({ userId: "user", organizationId: "org", role: "OPERATOR" }); mocks.permissions.mockResolvedValue({ OPERATIONAL_MAPPING: { canView: true, canCreate: true, canEdit: true } }); });
const request = (body: unknown) => new Request("http://localhost/api/operational-mappings", { method: "POST", body: JSON.stringify(body) });
describe("acesso e salvamento dos mapeamentos", () => {
  it("bloqueia sessão ausente antes de consultar registros", async () => {
    mocks.member.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/operational-mappings?id=other"))).status).toBe(401);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("restringe a consulta por organização, cliente acessível ou avulso próprio", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/operational-mappings?id=other"))).status).toBe(404);
    expect(mocks.find.mock.calls[0][0].where).toMatchObject({ organizationId: "org", OR: [{ client: { is: { organizationId: "org", operationLeaderId: "user" } } }, { clientId: null, createdById: "user" }] });
  });
  it("não permite salvar para cliente inacessível ou com permissão revogada", async () => {
    mocks.client.mockResolvedValue(null);
    expect((await POST(request({ ...emptyMapping(), title: "Processo", clientId: "other-org-client" }))).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.permissions.mockResolvedValue({ OPERATIONAL_MAPPING: { canView: true, canCreate: false } });
    expect((await POST(request({ ...emptyMapping(), title: "Processo" }))).status).toBe(403);
  });
  it("rejeita revisão antiga em vez de sobrescrever edição concorrente", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect((await PATCH(request({ ...emptyMapping(), title: "Processo", id: "map", revision: 1 }))).status).toBe(409);
    expect(mocks.updateMany.mock.calls[0][0].where).toMatchObject({ id: "map", revision: 1, organizationId: "org" });
    expect(mocks.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
