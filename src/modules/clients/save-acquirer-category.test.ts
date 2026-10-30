import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ sync: vi.fn(), upsert: vi.fn(), audit: vi.fn() }));
vi.mock("./ca-categories", () => ({ syncClientCategories: m.sync }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (fn: (tx: unknown) => unknown) => fn({ clientCategoryMapping: { upsert: m.upsert }, auditLog: { create: m.audit } }) } }));
import { saveAcquirerCategory } from "./save-acquirer-category";
const input = { organizationId: "org", clientId: "client", userId: "user", categoryId: "remote", direction: "PAYABLE" as const, mappingTypes: ["MDR_FEES" as const] };
beforeEach(() => { vi.clearAllMocks(); m.sync.mockResolvedValue([{ id: "local", remoteId: "remote", name: "Tarifas", parentId: "parent", type: "DESPESA" }]); });
it("saves only the selected client's applicable slot and retains other mappings", async () => {
    expect(await saveAcquirerCategory(input)).toEqual([{ mappingType: "MDR_FEES", categoryName: "Tarifas" }]);
    expect(m.sync).toHaveBeenCalledWith("org", "client");
    expect(m.upsert).toHaveBeenCalledExactlyOnceWith({ where: { clientId_mappingType: { clientId: "client", mappingType: "MDR_FEES" } }, create: { clientId: "client", mappingType: "MDR_FEES", categoryId: "parent", subcategoryId: "local" }, update: { categoryId: "parent", subcategoryId: "local" } });
});
it("rejects a category absent from this company's live catalog", async () => { m.sync.mockResolvedValue([]); await expect(saveAcquirerCategory(input)).rejects.toThrow("Categoria"); expect(m.upsert).not.toHaveBeenCalled(); });
it("rejects the wrong revenue/expense direction", async () => { await expect(saveAcquirerCategory({ ...input, direction: "RECEIVABLE" })).rejects.toThrow("incompatível"); expect(m.upsert).not.toHaveBeenCalled(); });
it("does not save on a CA lookup failure", async () => { m.sync.mockRejectedValue(Error("offline")); await expect(saveAcquirerCategory(input)).rejects.toThrow("offline"); expect(m.upsert).not.toHaveBeenCalled(); });
