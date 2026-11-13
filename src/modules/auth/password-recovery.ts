import "server-only";
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePlatformEmailFrom } from "@/lib/email/platform-sender";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";

const minute=60000;
export class RecoveryRequestError extends Error {
  constructor(message:string,public status=503,public retryAfter=60){super(message);}
}
export function recoveryOrigin(){
  const url=new URL(process.env.PASSWORD_RECOVERY_APP_URL || "https://app.hubsuporte.shop");
  if(url.protocol!=="https:" && !(process.env.NODE_ENV!=="production" && url.hostname==="localhost"))throw Error("Invalid recovery origin");
  return url.origin;
}
function hash(kind:string,value:string){
  const key=process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if(!key)throw Error("Recovery hashing unavailable");
  return createHmac("sha256",key).update(kind+":"+value).digest("hex");
}
function configured(){return Boolean(process.env.RESEND_API_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || process.env.GMAIL_TOKEN_ENCRYPTION_KEY));}
export async function queuePasswordRecovery(email:string,ip:string,now=new Date()){
  if(!configured())throw new RecoveryRequestError("O envio de recuperação está temporariamente indisponível. Tente novamente em alguns instantes.");
  const recipientHash=hash("email",email),ipHash=hash("ip",ip);
  return prisma.$transaction(async tx=>{
    // Durable shared limits across Vercel instances; no email or IP stored in plaintext.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fortuno-password-recovery-queue'))`;
    await tx.passwordRecoveryRequest.deleteMany({where:{createdAt:{lt:new Date(+now-7*86400000)}}});
    const [total,perIp,perEmail,recent]=await Promise.all([
      tx.passwordRecoveryRequest.count({where:{createdAt:{gte:new Date(+now-60*minute)}}}),
      tx.passwordRecoveryRequest.count({where:{ipHash,createdAt:{gte:new Date(+now-15*minute)}}}),
      tx.passwordRecoveryRequest.count({where:{recipientHash,createdAt:{gte:new Date(+now-60*minute)}}}),
      tx.passwordRecoveryRequest.count({where:{recipientHash,createdAt:{gte:new Date(+now-minute)}}}),
    ]);
    if(perIp>=20)throw new RecoveryRequestError("Muitas tentativas de recuperação. Aguarde 15 minutos antes de tentar novamente.",429,900);
    if(total>=100)throw new RecoveryRequestError("O envio está com muitas solicitações. Aguarde alguns minutos e tente novamente.",503,300);
    // Uniform response for an unknown account, a duplicate click or an email cooldown.
    if(perEmail>=3 || recent>0)return null;
    const user=await tx.user.findFirst({where:{email:{equals:email,mode:"insensitive"},memberships:{some:{}}},select:{id:true}});
    const request=await tx.passwordRecoveryRequest.create({data:{recipientHash,ipHash,userId:user?.id || null,status:user?"PENDING":"SKIPPED"},select:{id:true}});
    return request.id;
  },{timeout:10000,maxWait:10000});
}
function pending(now:Date){return {createdAt:{gte:new Date(+now-15*minute)},attempts:{lt:3},nextAttemptAt:{lte:now},OR:[{status:{in:["PENDING","FAILED"]},OR:[{leaseUntil:null},{leaseUntil:{lt:now}}]},{status:"SENDING",leaseUntil:{lt:now}}]};}
export async function deliverPasswordRecovery(id:string,now=new Date()){
  const claimed=await prisma.passwordRecoveryRequest.updateMany({where:{id,...pending(now)},data:{status:"SENDING",leaseUntil:new Date(+now+2*minute),attempts:{increment:1}}});
  if(!claimed.count)return;
  try{
    const row=await prisma.passwordRecoveryRequest.findUniqueOrThrow({where:{id}});
    const user=row.userId?await prisma.user.findFirst({where:{id:row.userId,memberships:{some:{}}},select:{id:true,email:true}}):null;
    if(!user || hash("email",user.email.trim().toLowerCase())!==row.recipientHash){await prisma.passwordRecoveryRequest.update({where:{id},data:{status:"SKIPPED",encryptedToken:null,leaseUntil:null}});return;}
    let encryptedToken=row.encryptedToken;
    if(!encryptedToken){
      const admin=createAdminClient();if(!admin)throw Error("AUTH_UNAVAILABLE");
      const generated=await admin.auth.admin.generateLink({type:"recovery",email:user.email,options:{redirectTo:recoveryOrigin()+"/recuperar-senha"}});
      const token=generated.data?.properties?.hashed_token;
      if(generated.error || !token || generated.data?.properties?.verification_type!=="recovery")throw Error("TOKEN_GENERATION_FAILED");
      encryptedToken=encryptIntegrationSecret(token);
      await prisma.passwordRecoveryRequest.update({where:{id},data:{encryptedToken}});
    }
    const url=new URL("/recuperar-senha",recoveryOrigin());url.searchParams.set("token_hash",decryptIntegrationSecret(encryptedToken));url.searchParams.set("type","recovery");
    const actionUrl=url.href,htmlUrl=actionUrl.replace(/&/g,"&amp;");
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":`password-recovery:${id}`},body:JSON.stringify({from:resolvePlatformEmailFrom([process.env.PASSWORD_RECOVERY_FROM_EMAIL,process.env.MEMBERS_FROM_EMAIL,process.env.SUPPORT_FROM_EMAIL,process.env.OPERATIONS_FROM_EMAIL]),to:[user.email],subject:"Redefina sua senha do Fortuno Hub",text:`Recebemos uma solicitação para redefinir sua senha do Fortuno Hub.

Acesse o link para criar uma nova senha:
${actionUrl}

Se você não solicitou a alteração, ignore este e-mail. Sua senha permanece a mesma.`,html:`<h2>Redefinir senha do Fortuno Hub</h2><p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="${htmlUrl}">Criar nova senha</a></p><p>Se você não solicitou a alteração, ignore este e-mail. Sua senha permanece a mesma.</p>`,tags:[{name:"module",value:"auth"},{name:"event",value:"password_recovery"}]}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error("EMAIL_HTTP_"+response.status);
    await prisma.passwordRecoveryRequest.update({where:{id},data:{status:"SENT",sentAt:new Date(),encryptedToken:null,leaseUntil:null,lastErrorCode:null}});
  }catch(error){
    const message=error instanceof Error?error.message:"";
    const code=/^(AUTH_UNAVAILABLE|TOKEN_GENERATION_FAILED|EMAIL_HTTP_\d{3})$/.test(message)?message:"DELIVERY_FAILED";
    console.warn("Password recovery delivery",{requestId:id,code});
    await prisma.passwordRecoveryRequest.update({where:{id},data:{status:"FAILED",lastErrorCode:code,leaseUntil:null,nextAttemptAt:new Date(Date.now()+minute)}});
  }
}
export async function processPasswordRecoveryQueue(now=new Date()){
  if(!configured())return;
  const rows=await prisma.passwordRecoveryRequest.findMany({where:pending(now),select:{id:true},orderBy:{createdAt:"asc"},take:10});
  for(let index=0;index<rows.length;index+=3)await Promise.allSettled(rows.slice(index,index+3).map(row=>deliverPasswordRecovery(row.id,now)));
}
