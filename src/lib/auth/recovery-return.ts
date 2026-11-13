export const RECOVERY_INTENT_COOKIE="fortuno-password-recovery";
const landingPaths=new Set(["/","/login","/auth/callback","/auth/confirm","/reset-password","/update-password"]);
export function recoveryReturnPath(value:string,intended=false){
 const url=new URL(value,"https://app.hubsuporte.shop");
 // Integration callbacks and account activation have their own exchanges.
 if(!landingPaths.has(url.pathname))return null;
 const query=url.searchParams,hash=new URLSearchParams(url.hash.slice(1));
 const token=query.get("token_hash");
 if(token&&query.get("type")==="recovery")return "/recuperar-senha?"+new URLSearchParams({token_hash:token,type:"recovery"});
 // Supabase may fall back to Site URL. The recovery request cookie is not available
 // on the old domain, a different browser, or after clearing cookies.
 const code=query.get("code");
 if(code)return "/recuperar-senha?"+new URLSearchParams({code,recovery:"1"});
 if(hash.get("type")==="recovery"&&hash.get("access_token")&&hash.get("refresh_token"))return "/recuperar-senha?recovery=1#"+hash.toString();
 const failure=new URLSearchParams();
 for(const key of ["error","error_code"])if(query.has(key))failure.set(key,query.get(key)!);
 const expired=query.get("error_code")==="otp_expired"||hash.get("error_code")==="otp_expired";
 if((intended||expired||query.get("type")==="recovery"||hash.get("type")==="recovery")&&(failure.size||hash.has("error_code")||hash.has("error"))){
   failure.set("recovery","1");
   return "/recuperar-senha?"+failure.toString()+(hash.size?"#"+hash.toString():"");
 }
 return null;
}
