import { DAILY_MFA_COOKIE_NAME } from "@/lib/auth/daily-mfa";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  await supabase.auth.signOut({scope:"local"});

  const loginUrl = new URL(request.nextUrl.searchParams.get("reason") === "day" ? "/login?day=1" : "/login", request.url);

  const response = NextResponse.redirect(loginUrl);
  response.cookies.set(DAILY_MFA_COOKIE_NAME,"",{path:"/",maxAge:0,httpOnly:true,sameSite:"lax",secure:request.nextUrl.protocol === "https:"});
  return response;
}