import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getMemberInviteAppUrl } from "@/modules/settings/server/member-invite-link";

const TOKEN_BYTES = 32;
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 256;

export function hashMemberInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isValidMemberInviteToken(token: string): boolean {
  return (
    token.length >= MIN_TOKEN_LENGTH &&
    token.length <= MAX_TOKEN_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(token)
  );
}

export async function createPermanentMemberInviteUrl(
  memberId: string,
): Promise<string> {
  const appUrl = getMemberInviteAppUrl();

  if (!appUrl) {
    throw new Error("URL pública do Fortuno Hub não configurada.");
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url");

  await prisma.organizationMemberInviteToken.create({
    data: {
      memberId,
      tokenHash: hashMemberInviteToken(token),
    },
  });

  return `${appUrl}/ativar-acesso#invite_token=${encodeURIComponent(token)}`;
}
