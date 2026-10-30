import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ request: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() }));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: m.request }));
vi.mock("@/lib/prisma", () => { const category = { upsert: m.upsert, update: m.update, updateMany: m.updateMany, findMany: m.findMany }; return { prisma: { category, $transaction: async (fn: (tx: unknown) => unknown) => fn({ category }) } }; });
import { localCategoryId, parseCategoryPage, syncClientCategories } from "./ca-categories";
beforeEach(() => { vi.clearAllMocks(); m.findMany.mockResolvedValue([]); });
it("isolates identical CA identifiers across companies and organizations", () => {
    expect(localCategoryId("org", "clientA", "remote")).not.toBe(localCategoryId("org", "clientB", "remote"));
    expect(localCategoryId("org", "clientA", "remote")).not.toBe(localCategoryId("other", "clientA", "remote"));
});
it("reads parent identifiers and inactive categories", () => {
    expect(parseCategoryPage({ itens: [{ id: "root", nome: "Receitas" }, { id: "leaf", nome: "Vendas", categoria_pai: { id: "root" }, ativo: false }], itens_totais: 2 }).rows[1]).toMatchObject({ remoteId: "leaf", parentRemoteId: "root", active: false });
    expect(() => parseCategoryPage({ unexpected: [] })).toThrow("inválido");
});
it("consults and persists only the selected company's catalog, retaining names and hierarchy", async () => {
    m.request.mockResolvedValue({ itens: [{ id: "root", nome: "Receitas" }, { id: "leaf", nome: "Vendas", categoria_pai: "root" }], itens_totais: 2 });
    await syncClientCategories("org", "clientA");
    expect(m.request).toHaveBeenCalledWith("clientA", "/v1/categorias?pagina=1&tamanho_pagina=1000");
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ organizationId: "org", sourceClientId: "clientA", remoteId: "leaf", name: "Vendas" }) }));
    expect(m.update).toHaveBeenCalledWith({ where: { id: localCategoryId("org", "clientA", "leaf") }, data: { parentId: localCategoryId("org", "clientA", "root") } });
    expect(m.updateMany).toHaveBeenCalledWith({ where: { organizationId: "org", sourceClientId: "clientA", remoteId: { notIn: ["root", "leaf"] } }, data: { active: false } });
});
it("does not clear existing catalogs when the API fails or returns an invalid shape", async () => {
    m.request.mockRejectedValueOnce(Error("offline"));
    await expect(syncClientCategories("org", "clientA")).rejects.toThrow("offline");
    m.request.mockResolvedValueOnce({ unexpected: [] });
    await expect(syncClientCategories("org", "clientA")).rejects.toThrow("inválido");
    expect(m.updateMany).not.toHaveBeenCalled();
});
it("refuses cyclic hierarchies before persisting", async () => {
    m.request.mockResolvedValue([{ id: "a", nome: "A", categoria_pai: "b" }, { id: "b", nome: "B", categoria_pai: "a" }]);
    await expect(syncClientCategories("org", "client")).rejects.toThrow("hierarquia");
    expect(m.upsert).not.toHaveBeenCalled();
});
