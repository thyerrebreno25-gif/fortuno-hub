import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
import { apiItems } from "@/modules/conta-azul/financial-export";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export type ClientCaCategory = {
    remoteId: string;
    name: string;
    parentRemoteId: string | null;
    code: string | null;
    active: boolean;
    type?: string;
};
export function parseCategoryPage(body: unknown) {
    const root = object(body);
    const list = Array.isArray(body) ? body : [root.itens, root.items, root.data, root.conteudo].find(Array.isArray);
    if (!list)
        throw Error("O CA retornou um catálogo de categorias inválido.");
    const rows = apiItems(body).map(row => {
        const remoteId = String(row.id || row.uuid || "");
        const name = String(row.nome || row.descricao || "").trim();
        if (!remoteId || !name)
            throw Error("O CA retornou uma categoria sem identificação.");
        const parent = row.categoria_pai;
        return { remoteId, name, type: typeof row.tipo === "string" ? row.tipo : undefined, parentRemoteId: typeof parent === "string" ? parent : typeof object(parent).id === "string" ? String(object(parent).id) : null, code: typeof row.codigo === "string" ? row.codigo : null, active: row.ativo !== false && row.status !== "INATIVO" };
    });
    const total = [root.itens_totais, root.totalItems].find(v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0) as number | undefined;
    return { rows, total };
}
export function localCategoryId(organizationId: string, clientId: string, remoteId: string) { return "ca_" + createHash("sha256").update(JSON.stringify([organizationId, clientId, remoteId])).digest("hex").slice(0, 40); }
export async function syncClientCategories(organizationId: string, clientId: string) {
    const all: ClientCaCategory[] = [];
    for (let page = 1; page <= 20; page++) {
        const { rows, total } = parseCategoryPage(await contaAzulRequest(clientId, `/v1/categorias?pagina=${page}&tamanho_pagina=1000`));
        all.push(...rows);
        if (total !== undefined && all.length >= total || total === undefined && rows.length < 1000)
            break;
        if (!rows.length || page === 20)
            throw Error("A consulta de categorias ficou incompleta. Tente atualizar novamente.");
    }
    const ids = new Set(all.map(row => row.remoteId));
    if (ids.size !== all.length)
        throw Error("O CA retornou categorias repetidas na paginação.");
    for (const row of all) {
        const seen = new Set([row.remoteId]);
        let parent = row.parentRemoteId;
        while (parent) {
            if (seen.has(parent))
                throw Error("O CA retornou uma hierarquia de categorias inválida.");
            seen.add(parent);
            parent = all.find(item => item.remoteId === parent)?.parentRemoteId || null;
        }
    }
    await prisma.$transaction(async (tx) => {
        for (const row of all) {
            const id = localCategoryId(organizationId, clientId, row.remoteId);
            const data = { sourceClientId: clientId, remoteId: row.remoteId, name: row.name, normalizedName: row.remoteId, code: row.code, active: row.active };
            await tx.category.upsert({ where: { id }, create: { id, organizationId, ...data }, update: data });
        }
        for (const row of all) {
            await tx.category.update({ where: { id: localCategoryId(organizationId, clientId, row.remoteId) }, data: { parentId: row.parentRemoteId && ids.has(row.parentRemoteId) ? localCategoryId(organizationId, clientId, row.parentRemoteId) : null } });
        }
        await tx.category.updateMany({ where: { organizationId, sourceClientId: clientId, remoteId: { notIn: [...ids] } }, data: { active: false } });
    }, { timeout: 30000 });
    const categories = await prisma.category.findMany({ where: { organizationId, sourceClientId: clientId, active: true }, include: { children: { where: { organizationId, sourceClientId: clientId, active: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } });
    return categories.map(row => {
        const names = [row.name];
        let parent = row.parentId;
        const seen = new Set([row.id]);
        while (parent && !seen.has(parent)) {
            seen.add(parent);
            const item = categories.find(c => c.id === parent);
            if (!item)
                break;
            names.unshift(item.name);
            parent = item.parentId;
        }
        return { ...row, name: names.join(" > "), type: all.find(item => item.remoteId === row.remoteId)?.type };
    });
}
