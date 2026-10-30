import "server-only";
import { prisma } from "@/lib/prisma";
import { syncClientCategories } from "./ca-categories";
import type { AcquirerMappingType } from "@/modules/acquirers/category-mapping";
export async function saveAcquirerCategory(input: {
    organizationId: string;
    clientId: string;
    userId: string;
    categoryId: string;
    direction: "PAYABLE" | "RECEIVABLE";
    mappingTypes: AcquirerMappingType[];
}) {
    const categories = await syncClientCategories(input.organizationId, input.clientId);
    const selected = categories.find(category => category.remoteId === input.categoryId);
    if (!selected || selected.type && selected.type !== (input.direction === "RECEIVABLE" ? "RECEITA" : "DESPESA"))
        throw Error("Categoria não encontrada ou incompatível no CA deste cliente.");
    const categoryId = selected.parentId || selected.id;
    const subcategoryId = selected.parentId ? selected.id : null;
    await prisma.$transaction(async (tx) => {
        for (const mappingType of new Set(input.mappingTypes)) {
            await tx.clientCategoryMapping.upsert({ where: { clientId_mappingType: { clientId: input.clientId, mappingType } }, create: { clientId: input.clientId, mappingType, categoryId, subcategoryId }, update: { categoryId, subcategoryId } });
        }
        await tx.auditLog.create({ data: { userId: input.userId, action: "ACQUIRER_CATEGORY_LEARNED", entity: "Client", entityId: input.clientId, afterData: { mappingTypes: input.mappingTypes, categoryId, subcategoryId, remoteCategoryId: input.categoryId } } });
    });
    return input.mappingTypes.map(mappingType => ({ mappingType, categoryName: selected.name }));
}
