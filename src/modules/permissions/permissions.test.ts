import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    roleModulePermission: { findMany },
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import {
  defaultPermission,
  getRolePermissions,
} from "./permissions";

describe("permissões do módulo de clientes", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it.each(["MASTER", "ADMIN", "MANAGER"])(
    "mantém acesso completo para %s por padrão",
    (role) => {
      expect(defaultPermission(role, "CLIENTS")).toEqual({
        canView: true,
        canCreate: true,
        canEdit: true,
        canDelete: true,
        canImport: true,
        canExport: true,
        canManage: true,
      });
    },
  );

  it("permite ao operador visualizar, criar e editar sem liberar exclusão por padrão", () => {
    expect(defaultPermission("OPERATOR", "CLIENTS")).toEqual({
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false,
      canImport: false,
      canExport: false,
      canManage: false,
    });
  });

  it("permite ao operador administrar os próprios avisos", () => {
    expect(defaultPermission("OPERATOR", "NOTICES")).toEqual({
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canImport: false,
      canExport: false,
      canManage: false,
    });
  });

  it("libera o assistente para o operador sem conceder gestão administrativa", () => {
    expect(defaultPermission("OPERATOR", "ASSISTANT")).toEqual({
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canImport: false,
      canExport: false,
      canManage: false,
    });
  });

  it("mantém o WhatsApp privado para operadores até a liberação no perfil", () => {
    expect(defaultPermission("OPERATOR", "WHATSAPP")).toEqual({
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canImport: false,
      canExport: false,
      canManage: false,
    });
  });

  it("mantém o perfil de cliente externo sem acesso ao cadastro operacional", () => {
    expect(defaultPermission("CLIENT", "CLIENTS")).toEqual({
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canImport: false,
      canExport: false,
      canManage: false,
    });
  });

  it("prioriza a permissão configurada para o cargo, inclusive Operador", async () => {
    findMany.mockResolvedValue([
      {
        moduleCode: "CLIENTS",
        canView: true,
        canCreate: false,
        canEdit: true,
        canDelete: false,
        canImport: false,
        canExport: false,
        canManage: false,
      },
    ]);

    const permissions = await getRolePermissions("org-1", "OPERATOR");

    expect(permissions.CLIENTS).toEqual({
      canView: true,
      canCreate: false,
      canEdit: true,
      canDelete: false,
      canImport: false,
      canExport: false,
      canManage: false,
    });
  });
});
