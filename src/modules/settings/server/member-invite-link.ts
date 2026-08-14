import "server-only";

type GeneratedLinkProperties = {
  action_link?: string;
  hashed_token?: string;
  verification_type?: string;
};

export function getMemberInviteAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
}

export function getMemberInviteRedirectTo(appUrl: string) {
  return appUrl ? `${appUrl}/ativar-acesso` : undefined;
}

export function buildMemberActivationUrl(
  appUrl: string,
  properties?: GeneratedLinkProperties | null,
): string {
  const actionLink = properties?.action_link ?? "";
  const tokenHash = properties?.hashed_token ?? "";
  const type = properties?.verification_type;

  if (
    !appUrl ||
    !tokenHash ||
    (type !== "invite" && type !== "recovery")
  ) {
    return actionLink;
  }

  const params = new URLSearchParams({
    token_hash: tokenHash,
    type,
  });

  return `${appUrl}/ativar-acesso?${params.toString()}`;
}
