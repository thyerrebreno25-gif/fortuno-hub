import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateLink } = vi.hoisted(() => ({
  generateLink: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/modules/settings/server/member-invite-link", () => ({
  getMemberInviteAppUrl: () => "https://fortuno.example",
  getMemberInviteRedirectTo: () =>
    "https://fortuno.example/ativar-acesso",
  buildMemberActivationUrl: (
    appUrl: string,
    properties?: { hashed_token?: string; verification_type?: string },
  ) =>
    properties?.hashed_token && properties.verification_type
      ? `${appUrl}/ativar-acesso?token_hash=${properties.hashed_token}&type=${properties.verification_type}`
      : "",
}));

import { createFreshMemberActivationSession } from "./member-invite-session";

const admin = {
  auth: {
    admin: {
      generateLink,
    },
  },
};

describe("sessão temporária de ativação", () => {
  beforeEach(() => {
    generateLink.mockReset();
  });

  it("gera uma sessão de convite somente quando o link permanente é aberto", async () => {
    generateLink.mockResolvedValueOnce({
      data: {
        properties: {
          hashed_token: "fresh-invite-token",
          verification_type: "invite",
        },
      },
      error: null,
    });

    const result = await createFreshMemberActivationSession(
      admin as never,
      "colaborador@example.com",
    );

    expect(result).toEqual({
      created: true,
      activationUrl:
        "https://fortuno.example/ativar-acesso?token_hash=fresh-invite-token&type=invite",
      linkType: "invite",
    });
  });

  it("usa recuperação quando o usuário já existe no Supabase", async () => {
    generateLink
      .mockResolvedValueOnce({
        data: { properties: null },
        error: new Error("User already registered"),
      })
      .mockResolvedValueOnce({
        data: {
          properties: {
            hashed_token: "fresh-recovery-token",
            verification_type: "recovery",
          },
        },
        error: null,
      });

    const result = await createFreshMemberActivationSession(
      admin as never,
      "colaborador@example.com",
    );

    expect(result).toEqual({
      created: true,
      activationUrl:
        "https://fortuno.example/ativar-acesso?token_hash=fresh-recovery-token&type=recovery",
      linkType: "recovery",
    });
    expect(generateLink).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: "recovery" }),
    );
  });
});
