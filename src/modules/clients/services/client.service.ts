import { clientRepository } from "../repositories/client.repository";
import type {
  AuthenticatedMember,
  CreateClientInput,
  ListClientsInput,
} from "../types/client.types";
import { normalizeText } from "../utils/client-normalizers";

export class ClientConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientConflictError";
  }
}

export class ClientPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientPermissionError";
  }
}

function ensureCreatePermission(member: AuthenticatedMember) {
  const allowedRoles = ["MASTER", "ADMIN", "MANAGER"];

  if (!allowedRoles.includes(member.role)) {
    throw new ClientPermissionError(
      "Seu perfil não possui permissão para cadastrar clientes.",
    );
  }
}

export const clientService = {
  async list(input: ListClientsInput) {
    const result = await clientRepository.list(input);

    const totalPages = Math.max(
      1,
      Math.ceil(result.total / input.pageSize),
    );

    return {
      data: result.clients,
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total: result.total,
        totalPages,
        hasPreviousPage: input.page > 1,
        hasNextPage: input.page < totalPages,
      },
    };
  },

  async create(
    member: AuthenticatedMember,
    input: CreateClientInput,
  ) {
    ensureCreatePermission(member);

    const normalizedName = normalizeText(input.name);

    const duplicate = await clientRepository.findDuplicate(
      member.organizationId,
      normalizedName,
      input.document,
    );

    if (duplicate) {
      if (duplicate.document === input.document) {
        throw new ClientConflictError(
          "Já existe um cliente cadastrado com este CNPJ.",
        );
      }

      if (duplicate.normalizedName === normalizedName) {
        throw new ClientConflictError(
          "Já existe um cliente cadastrado com este nome.",
        );
      }

      throw new ClientConflictError(
        "Já existe um cliente com os dados informados.",
      );
    }

    return clientRepository.create(
      member.organizationId,
      member.userId,
      input,
    );
  },
};