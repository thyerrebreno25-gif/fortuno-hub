import { describe, expect, it } from "vitest";

import { targetableNoticeMemberWhere } from "./notice-targeting";

describe("direcionamento individual de avisos", () => {
  it("permite ao gestor selecionar colaboradores da organização", () => {
    expect(
      targetableNoticeMemberWhere({
        id: "manager-1",
        organizationId: "org-1",
        role: "MANAGER",
      }),
    ).toEqual({
      organizationId: "org-1",
      id: { not: "manager-1" },
      role: { not: "CLIENT" },
    });
  });

  it("limita um líder operacional aos próprios liderados", () => {
    expect(
      targetableNoticeMemberWhere({
        id: "leader-1",
        organizationId: "org-1",
        role: "OPERATOR",
      }),
    ).toEqual({
      organizationId: "org-1",
      id: { not: "leader-1" },
      role: { not: "CLIENT" },
      teamLeaderId: "leader-1",
    });
  });

  it("mantém a validação dos destinatários solicitados", () => {
    expect(
      targetableNoticeMemberWhere(
        {
          id: "manager-1",
          organizationId: "org-1",
          role: "ADMIN",
        },
        ["operator-1"],
      ),
    ).toEqual({
      organizationId: "org-1",
      id: { in: ["operator-1"], not: "manager-1" },
      role: { not: "CLIENT" },
    });
  });
});
