export const DEFAULT_PLATFORM_FROM_EMAIL =
  "Fortuno Hub <notificacoes@hubsuporte.shop>";

type ResolvePlatformEmailFromOptions = {
  production?: boolean;
  fallback?: string;
};

function senderDomain(value: string): string | null {
  const match = value.match(/@([^>\s,]+)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function isResendSandboxSender(value: string): boolean {
  const domain = senderDomain(value);
  return domain === "resend.dev" || domain?.endsWith(".resend.dev") === true;
}

function isProductionEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.APP_ENV === "production"
  );
}

export function resolvePlatformEmailFrom(
  candidates: Array<string | null | undefined>,
  options: ResolvePlatformEmailFromOptions = {},
): string {
  const production = options.production ?? isProductionEnvironment();

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    if (production && isResendSandboxSender(value)) continue;
    return value;
  }

  return options.fallback?.trim() || DEFAULT_PLATFORM_FROM_EMAIL;
}
