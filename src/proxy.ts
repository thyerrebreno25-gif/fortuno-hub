import { signedInToday } from "@/modules/session/daily-policy";
import {RECOVERY_INTENT_COOKIE,recoveryReturnPath} from "@/lib/auth/recovery-return";
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
  "/api/whatsapp/uazapi/webhook",
  "/api/cron/atendimento-retention",
  "/api/cron/member-invite-reminders",
  "/api/cron/meeting-reminders",
  "/api/cron/management",
];

const AUTHENTICATION_ROUTES = ["/mfa", "/auth/signout", "/api/auth/mfa/daily"];

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
  const recoveryPath=recoveryReturnPath(request.url,request.cookies.get(RECOVERY_INTENT_COOKIE)?.value==="1");
  if(recoveryPath)return NextResponse.redirect(new URL(recoveryPath,request.url));
  if(["/api/auth/password-recovery","/api/auth/password-recovery/complete"].includes(request.nextUrl.pathname))return NextResponse.next({request});
  // The public recovery page validates its one-time token explicitly. Never run
  // login, daily-session or MFA redirects before that client-side exchange.
  if(matchesRoute(request.nextUrl.pathname,"/recuperar-senha"))return NextResponse.next({request});
  if(matchesRoute(request.nextUrl.pathname,"/satisfacao")||matchesRoute(request.nextUrl.pathname,"/api/satisfacao"))return NextResponse.next({request});
  // The public policy must remain readable even when the auth provider is unavailable.
  if (["/politica-de-privacidade", "/termos-de-servico"].includes(request.nextUrl.pathname)) return NextResponse.next({ request });
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

  const factorsResult = await supabase.auth.mfa.listFactors();

  const hasVerifiedTotp = Boolean(factorsResult.data?.totp.length);
  // A persisted AAL2 refresh token does not waive the next calendar day login.
  const hasDailyVerification = hasVerifiedTotp
    ? await verifyDailyMfaToken(
        request.cookies.get(DAILY_MFA_COOKIE_NAME)?.value,
        user.id,
      )
    : false;
  if (!hasDailyVerification && !signedInToday(user.last_sign_in_at)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({error:"Entre novamente para iniciar o acesso de hoje.",code:"DAILY_LOGIN_REQUIRED"},{status:401});
    return NextResponse.redirect(new URL("/auth/signout?reason=day",request.url));
  }
  const requiresMfa = !hasVerifiedTotp || !hasDailyVerification;

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
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
