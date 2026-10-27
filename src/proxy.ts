import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  DAILY_MFA_COOKIE_NAME,
  verifyDailyMfaToken,
} from "@/lib/auth/daily-mfa";

const PUBLIC_ROUTES = [
  "/login",
  "/recuperar-senha",
  "/ativar-acesso",
  "/api/auth/member-invite",
  "/api/atendimento/gmail/webhook",
  "/api/whatsapp/webhook",
  "/api/cron/atendimento-retention",
  "/api/cron/member-invite-reminders",
  "/api/cron/meeting-reminders",
];

const AUTHENTICATION_ROUTES = ["/mfa", "/auth/signout"];

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicRoute = PUBLIC_ROUTES.some((route) =>
    matchesRoute(pathname, route),
  );
  const isAuthenticationRoute = AUTHENTICATION_ROUTES.some((route) =>
    matchesRoute(pathname, route),
  );
  const isLoginPage = pathname === "/login";
  const isMfaPage = pathname === "/mfa";

  if (!user && !isPublicRoute) {
    return redirectTo(request, "/login");
  }

  // Convites, webhook e encerramento de sessão não dependem do segundo fator.
  if (
    !user ||
    (isPublicRoute && !isLoginPage) ||
    (isAuthenticationRoute && !isMfaPage)
  ) {
    return response;
  }

  const [factorsResult, assuranceResult] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  const hasVerifiedTotp = Boolean(factorsResult.data?.totp.length);
  const hasAssuranceLevelTwo =
    assuranceResult.data?.currentLevel === "aal2";
  const hasDailyVerification = hasVerifiedTotp
    ? await verifyDailyMfaToken(
        request.cookies.get(DAILY_MFA_COOKIE_NAME)?.value,
        user.id,
      )
    : false;
  const requiresMfa =
    !hasVerifiedTotp || (!hasAssuranceLevelTwo && !hasDailyVerification);

  if (requiresMfa && !isMfaPage) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: "Confirme o código do autenticador para continuar.",
          code: hasVerifiedTotp
            ? "MFA_CHALLENGE_REQUIRED"
            : "MFA_ENROLLMENT_REQUIRED",
        },
        { status: 403 },
      );
    }

    return redirectTo(request, "/mfa");
  }

  if (!requiresMfa && (isLoginPage || isMfaPage)) {
    return redirectTo(request, "/inicio");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
