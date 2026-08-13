import { prisma } from "@/lib/prisma";
import type {
  CreateClientInput,
  ListClientsInput,
} from "../types/client.types";
import { normalizeText } from "../utils/client-normalizers";

export const clientRepository = {
  async findOperationalMemberIds(
    organizationId: string,
    userIds: string[],
  ) {
    if (userIds.length === 0) return [];

    const memberships = await prisma.organizationMember.findMany({
      where: {
        organizationId,
        userId: { in: userIds },
        role: { not: "CLIENT" },
      },
      select: { userId: true },
    });

    return memberships.map((membership) => membership.userId);
  },

  async findDuplicate(
    organizationId: string,
    normalizedName: string,
    document: string,
  ) {
    return prisma.client.findFirst({
      where: {
        organizationId,
        OR: [
          {
            normalizedName,
          },
          {
            document,
          },
        ],
      },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        document: true,
      },
    });
  },

  async list(input: ListClientsInput) {
  const skip = (input.page - 1) * input.pageSize;
  const normalizedSearch = input.search ? normalizeText(input.search) : "";
  const documentSearch = input.search?.replace(/\D/g, "") ?? "";

  const where = {
    organizationId: input.organizationId,

    ...(input.status === "active"
      ? { active: true }
      : input.status === "inactive"
        ? { active: false }
        : {}),

    ...(input.search
      ? {
          OR: [
            {
              normalizedName: {
                contains: normalizedSearch,
              },
            },
            ...(documentSearch
              ? [
                  {
                    document: {
                      contains: documentSearch,
                    },
                  },
                ]
              : []),
          ],
        }
      : {}),
  };

  const [clients, total] = await prisma.$transaction([
    prisma.client.findMany({
      where,
      skip,
      take: input.pageSize,
      orderBy: {
        createdAt: "desc",
      },
      include: {
        acquirers: {
          where: {
            active: true,
          },
          orderBy: {
            name: "asc",
          },
        },
        categoryMappings: {
          include: {
            category: true,
            subcategory: true,
          },
        },
        banks: {
          where: { active: true },
          orderBy: { bankName: "asc" },
        },
        cards: {
          where: { active: true },
          orderBy: {
            brand: "asc",
          },
        },
        _count: {
          select: {
            imports: true,
          },
        },
      },
    }),

    prisma.client.count({
      where,
    }),
  ]);

  return {
    clients,
    total,
  };
},

  async create(
    organizationId: string,
    userId: string,
    input: CreateClientInput,
  ) {
    return prisma.$transaction(async (transaction) => {
      const client = await transaction.client.create({
        data: {
          organizationId,
          name: input.name,
          normalizedName: normalizeText(input.name),
          document: input.document,
          active: true,
          serviceSquad: input.serviceSquad,
          operationLeaderId: input.operationLeaderId,
          payableResponsibleId: input.payableResponsibleId,
          receivableResponsibleId: input.receivableResponsibleId,
          generalResponsibleId: input.generalResponsibleId,
          serviceAliases: input.serviceAliases,

          acquirers: {
            create: input.acquirers.map((acquirer) => ({
              name: acquirer.name,
              normalizedName: normalizeText(acquirer.name),
              receiptRule: acquirer.receiptRule,
            })),
          },
        },
      });

      for (const mapping of input.categoryMappings) {
        const normalizedCategory = normalizeText(mapping.category);

        let category = await transaction.category.findFirst({
          where: {
            organizationId,
            parentId: null,
            normalizedName: normalizedCategory,
          },
        });

        if (!category) {
          category = await transaction.category.create({
            data: {
              organizationId,
              parentId: null,
              name: mapping.category,
              normalizedName: normalizedCategory,
            },
          });
        }

        let subcategoryId: string | null = null;

        if (mapping.subcategory) {
          const normalizedSubcategory = normalizeText(
            mapping.subcategory,
          );

          let subcategory = await transaction.category.findFirst({
            where: {
              organizationId,
              parentId: category.id,
              normalizedName: normalizedSubcategory,
            },
          });

          if (!subcategory) {
            subcategory = await transaction.category.create({
              data: {
                organizationId,
                parentId: category.id,
                name: mapping.subcategory,
                normalizedName: normalizedSubcategory,
              },
            });
          }

          subcategoryId = subcategory.id;
        }

        await transaction.clientCategoryMapping.create({
          data: {
            clientId: client.id,
            mappingType: mapping.mappingType,
            categoryId: category.id,
            subcategoryId,
          },
        });
      }

      await transaction.auditLog.create({
        data: {
          userId,
          action: "CLIENT_CREATED",
          entity: "Client",
          entityId: client.id,
          afterData: {
            name: input.name,
            document: input.document,
            acquirers: input.acquirers,
            categoryMappings: input.categoryMappings,
            serviceSquad: input.serviceSquad,
            operationLeaderId: input.operationLeaderId,
            payableResponsibleId: input.payableResponsibleId,
            receivableResponsibleId: input.receivableResponsibleId,
            generalResponsibleId: input.generalResponsibleId,
            serviceAliases: input.serviceAliases,
          },
        },
      });

      return transaction.client.findUnique({
        where: {
          id: client.id,
        },
        include: {
          acquirers: {
            orderBy: {
              name: "asc",
            },
          },
          categoryMappings: {
            include: {
              category: true,
              subcategory: true,
            },
          },
        },
      });
    });
  },
};
