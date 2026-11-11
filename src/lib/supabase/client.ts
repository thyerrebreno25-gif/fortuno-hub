import { createBrowserClient } from "@supabase/ssr";
import { recoveryReturnPath, RECOVERY_INTENT_COOKIE } from "@/lib/auth/recovery-return";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {auth:{detectSessionInUrl: typeof window === "undefined" || !(window.location.pathname === "/recuperar-senha" || recoveryReturnPath(window.location.href, document.cookie.split(";").some(part=>part.trim()===`${RECOVERY_INTENT_COOKIE}=1`))) }},
  );
}
// Recovery consumes each one-time token explicitly, once, instead of racing URL auto-detection.
export function createRecoveryClient(){
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{isSingleton:false,auth:{detectSessionInUrl:false}});
}
