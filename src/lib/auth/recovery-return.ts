export const RECOVERY_INTENT_COOKIE="fortuno-password-recovery";
export function recoveryReturnPath(value:string,intended=false){
 const url=new URL(value,"https://app.hubsuporte.shop");
 if(url.pathname==="/recuperar-senha")return null;
 const query=url.searchParams,hash=new URLSearchParams(url.hash.slice(1));
 const token=query.get("token_hash");
 if(token&&query.get("type")==="recovery")return "/recuperar-senha?"+new URLSearchParams({token_hash:token,type:"recovery"});
 const code=query.get("code");
 if(code&&(query.get("type")==="recovery"||query.get("recovery")==="1"||intended&&["/","/login","/auth/callback"].includes(url.pathname)))return "/recuperar-senha?"+new URLSearchParams({code,recovery:"1"});
 if(hash.get("type")==="recovery"&&hash.get("access_token")&&hash.get("refresh_token"))return "/recuperar-senha?recovery=1#"+hash.toString();
 if(intended&&(hash.has("error_code")||hash.has("error")))return "/recuperar-senha?recovery=1#"+hash.toString();
 return null;
}
