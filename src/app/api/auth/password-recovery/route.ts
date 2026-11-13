import { after, NextResponse } from "next/server";
import { z } from "zod";
import { deliverPasswordRecovery, queuePasswordRecovery, recoveryOrigin, RecoveryRequestError } from "@/modules/auth/password-recovery";
export const runtime="nodejs";
export const maxDuration=60;
export async function POST(request:Request){
  const headers={"Cache-Control":"no-store"};
  try{
    const origin=request.headers.get("origin");
    if(origin && origin!==recoveryOrigin())return NextResponse.json({error:"Origem da solicitação não permitida."},{status:403,headers});
    if(Number(request.headers.get("content-length")||0)>2048)return NextResponse.json({error:"Solicitação inválida."},{status:400,headers});
    const raw=await request.text();if(raw.length>2048)return NextResponse.json({error:"Solicitação inválida."},{status:400,headers});
    const {email}=z.object({email:z.string().trim().toLowerCase().email().max(254)}).parse(JSON.parse(raw));
    const ip=(request.headers.get("x-vercel-forwarded-for")||request.headers.get("x-real-ip")||request.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim().slice(0,100);
    const id=await queuePasswordRecovery(email,ip);
    if(id)after(()=>deliverPasswordRecovery(id));
    return NextResponse.json({ok:true},{status:202,headers});
  }catch(error){
    if(error instanceof z.ZodError || error instanceof SyntaxError)return NextResponse.json({error:"Informe um e-mail válido."},{status:400,headers});
    if(error instanceof RecoveryRequestError)return NextResponse.json({error:error.message},{status:error.status,headers:{...headers,"Retry-After":String(error.retryAfter)}});
    console.error("Password recovery request failed",{name:error instanceof Error?error.name:"Unknown"});
    return NextResponse.json({error:"Não foi possível solicitar o e-mail agora. Tente novamente em alguns instantes."},{status:503,headers});
  }
}
