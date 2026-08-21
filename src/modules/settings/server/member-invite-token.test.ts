import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTokenRecord } = vi.hoisted(() => ({
  createTokenRecord: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMemberInviteToken: {
      create: createTokenRecord,
    },
  },
}));

vi.mock("@/modules/settings/server/member-invite-link", () => ({
  getMemberInviteAppUrl: () => "https://fortuno.example",
}));

import {
  createPermanentMemberInviteUrl,
  hashMemberInviteToken,
  isValidMemberInviteToken,
} from "./member-invite-token";

describe("convites permanentes de colaboradores", () => {
  beforeEach(() => {
    createTokenRecord.mockReset();
    createTokenRecord.mockResolvedValue({ id: "invite-token-id" });
  });

  it("aceita apenas tokens com formato e entropia mínimos", () => {
    expect(isValidMemberInviteToken("a".repeat(32))).toBe(true);
    expect(isValidMemberInviteToken("a".repeat(31))).toBe(false);
    expect(isValidMemberInviteToken(`${"a".repeat(31)}!`)).toBe(false);
  });

  it("gera hash SHA-256 determinístico sem armazenar o token original", () => {
    const token = "token-seguro-com-mais-de-trinta-e-dois-caracteres";

    expect(hashMemberInviteToken(token)).toBe(
      "0e53c40f58e48511b4f93e26ff6e80f403d02d622da55d1e78fbf324b2afcfca",
    );
  });

  it("cria um link sem validade e persiste somente o hash", async () => {
    const url = await createPermanentMemberInviteUrl("member-1");
    const parsed = new URL(url);
    const token = new URLSearchParams(parsed.hash.slice(1)).get("invite_token");

    expect(parsed.origin).toBe("https://fortuno.example");
    expect(parsed.pathname).toBe("/ativar-acesso");
    expect(token).toBeTruthy();
    expect(isValidMemberInviteToken(token!)).toBe(true);
    expect(createTokenRecord).toHaveBeenCalledWith({
      data: {
        memberId: "member-1",
        tokenHash: hashMemberInviteToken(token!),
      },
    });
    expect(JSON.stringify(createTokenRecord.mock.calls)).not.toContain(token!);
  });
});
