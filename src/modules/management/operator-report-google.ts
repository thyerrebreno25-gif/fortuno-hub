import "server-only";
import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {getMemberForModule} from "@/modules/assistant/auth";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {encryptIntegrationSecret,decryptIntegrationSecret} from "@/modules/purchase-invoices/server/crypto";
import {googleChatFailure,OperatorChatError} from "./operator-chat-error";
export const reportChatScopes=["https://www.googleapis.com/auth/chat.messages.create","https://www.googleapis.com/auth/chat.spaces.readonly"];
const cookieName="fortuno-report-chat-oauth";
type Provider="CHAT"|"CALENDAR";
function credentials(provider?:Provider){
 const selected=provider||(process.env.GOOGLE_CHAT_CLIENT_ID&&process.env.GOOGLE_CHAT_CLIENT_SECRET?"CHAT":"CALENDAR");
 const clientId=process.env[selected==="CHAT"?"GOOGLE_CHAT_CLIENT_ID":"GOOGLE_CALENDAR_CLIENT_ID"],secret=process.env[selected==="CHAT"?"GOOGLE_CHAT_CLIENT_SECRET":"GOOGLE_CALENDAR_CLIENT_SECRET"];
 if(!clientId||!secret)throw new OperatorChatError("CHAT_OAUTH_NOT_CONFIGURED","A integração Google precisa ser configurada para conectar o Chat.");
 return {provider:selected,clientId,secret};
}
function callbackUri(request:Request,provider:Provider){return provider==="CHAT"?process.env.GOOGLE_CHAT_REDIRECT_URI?.trim()||new URL("/api/management/operator-report/google/callback",process.env.NEXT_PUBLIC_APP_URL||request.url).href:process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim()||new URL("/api/calendar/google/callback",process.env.NEXT_PUBLIC_APP_URL||request.url).href;}
export async function reportConfigurationMember(){
 const member=await getMemberForModule("MANAGEMENT");if(!member||!["MASTER","ADMIN"].includes(member.role))throw new OperatorChatError("CHAT_PERMISSION_DENIED","Somente Master e administradores podem configurar o envio.",403);
 const permissions=await getRolePermissions(member.organizationId,member.role);if(!permissions.MANAGEMENT.canManage||!permissions.MANAGEMENT.canExport)throw new OperatorChatError("CHAT_PERMISSION_DENIED","Sem permissão para configurar e exportar relatórios.",403);return member;
}
export async function beginReportChatConnection(request:Request){
 const member=await reportConfigurationMember(),oauth=credentials(),state="report-chat."+randomBytes(32).toString("hex"),verifier=randomBytes(32).toString("base64url"),redirectUri=callbackUri(request,oauth.provider);
 const jar=await cookies();jar.set(cookieName,encryptIntegrationSecret(JSON.stringify({state,verifier,provider:oauth.provider,redirectUri,userId:member.userId,organizationId:member.organizationId,expires:Date.now()+600000})),{httpOnly:true,sameSite:"lax",secure:new URL(request.url).protocol==="https:",maxAge:600,path:"/api"});
 const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");url.search=new URLSearchParams({client_id:oauth.clientId,redirect_uri:redirectUri,response_type:"code",scope:reportChatScopes.join(" "),access_type:"offline",prompt:"consent",state,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256"}).toString();return {url:url.href};
}
export async function completeReportChatConnection(request:Request){
 const target=new URL("/gestao/relatorio-diario",request.url),jar=await cookies(),cookie=jar.get(cookieName)?.value;jar.delete({name:cookieName,path:"/api"});
 try{
  const member=await reportConfigurationMember(),url=new URL(request.url),code=url.searchParams.get("code"),received=url.searchParams.get("state")||"";
  if(!cookie||!code||url.searchParams.has("error"))throw new Error("cancelled");
  const saved=JSON.parse(decryptIntegrationSecret(cookie));
  if(typeof saved.state!=="string"||typeof saved.verifier!=="string"||!["CHAT","CALENDAR"].includes(saved.provider)||saved.userId!==member.userId||saved.organizationId!==member.organizationId||!Number.isFinite(saved.expires)||saved.expires<Date.now()||Buffer.byteLength(saved.state)!==Buffer.byteLength(received)||!timingSafeEqual(Buffer.from(saved.state),Buffer.from(received)))throw new Error("state");
  const oauth=credentials(saved.provider),redirectUri=callbackUri(request,oauth.provider);if(saved.redirectUri!==redirectUri)throw new Error("redirect");
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",body:new URLSearchParams({client_id:oauth.clientId,client_secret:oauth.secret,code,code_verifier:saved.verifier,redirect_uri:redirectUri,grant_type:"authorization_code"}),signal:AbortSignal.timeout(15000),redirect:"error"});
  const token=await response.json(),scopes=String(token.scope||"").split(" ");
  if(!response.ok||typeof token.access_token!=="string"||typeof token.refresh_token!=="string"||!reportChatScopes.every(scope=>scopes.includes(scope)))throw new Error("scope");
  await prisma.$transaction(async tx=>{
   await tx.$executeRaw(Prisma.sql`INSERT INTO "OperatorReportGoogleConnection" ("organizationId","userId","encryptedAccessToken","encryptedRefreshToken","expiresAt",provider,status) VALUES (${member.organizationId},${member.userId},${encryptIntegrationSecret(token.access_token)},${encryptIntegrationSecret(token.refresh_token)},${new Date(Date.now()+Math.max(60,Math.min(Number(token.expires_in)||3600,86400))*1000)},${oauth.provider},'CONNECTED')
    ON CONFLICT ("organizationId","userId") DO UPDATE SET "encryptedAccessToken"=EXCLUDED."encryptedAccessToken","encryptedRefreshToken"=EXCLUDED."encryptedRefreshToken","expiresAt"=EXCLUDED."expiresAt",provider=EXCLUDED.provider,status='CONNECTED',"lastError"=NULL,"updatedAt"=CURRENT_TIMESTAMP`);
   await tx.$executeRaw(Prisma.sql`UPDATE "OperatorReportConfig" SET enabled=false,revision=${randomBytes(16).toString("hex")},"updatedAt"=CURRENT_TIMESTAMP WHERE "organizationId"=${member.organizationId} AND "configuredById"=${member.userId}`);
   await tx.auditLog.create({data:{userId:member.userId,action:"OPERATOR_REPORT_CHAT_CONNECTED",entity:"Organization",entityId:member.organizationId}});
  });target.searchParams.set("chat","connected");
 }catch{target.searchParams.set("chat","error");}
 return NextResponse.redirect(target);
}
type Connection={encryptedAccessToken:string;encryptedRefreshToken:string;expiresAt:Date;provider:Provider;status:string};
export async function reportGoogleStatus(organizationId:string,userId:string){
 const [connection]=await prisma.$queryRaw<Array<{status:string}>>(Prisma.sql`SELECT status FROM "OperatorReportGoogleConnection" WHERE "organizationId"=${organizationId} AND "userId"=${userId}`);
 let configured=true;try{credentials();}catch{configured=false;}return {configured,connected:connection?.status==="CONNECTED"};
}
export async function reportChatAccessToken(organizationId:string,userId:string){
 const [connection]=await prisma.$queryRaw<Connection[]>(Prisma.sql`SELECT "encryptedAccessToken","encryptedRefreshToken","expiresAt",provider,status FROM "OperatorReportGoogleConnection" WHERE "organizationId"=${organizationId} AND "userId"=${userId}`);
 if(!connection||connection.status!=="CONNECTED")throw new OperatorChatError("CHAT_NOT_CONNECTED","Conecte o Google Chat para consultar os espaços e enviar o PDF.",409);
 if(+connection.expiresAt>Date.now()+60000)return decryptIntegrationSecret(connection.encryptedAccessToken);
 const oauth=credentials(connection.provider),response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",body:new URLSearchParams({client_id:oauth.clientId,client_secret:oauth.secret,refresh_token:decryptIntegrationSecret(connection.encryptedRefreshToken),grant_type:"refresh_token"}),redirect:"error",signal:AbortSignal.timeout(15000)}),token=await response.json();
 if(!response.ok||typeof token.access_token!=="string"){
  if(response.status===400||response.status===401)await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportGoogleConnection" SET status='RECONNECT',"lastError"='Autorize o Google Chat novamente.' WHERE "organizationId"=${organizationId} AND "userId"=${userId}`);
  if(response.status===400||response.status===401)throw new OperatorChatError("CHAT_RECONNECT_REQUIRED","Não foi possível renovar a conexão do Google Chat. Reconecte a conta.",401);
  throw new OperatorChatError("CHAT_UNAVAILABLE","O Google não renovou a conexão agora. Tente novamente em alguns instantes.",503);
 }
 const updated=await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportGoogleConnection" SET "encryptedAccessToken"=${encryptIntegrationSecret(token.access_token)},"expiresAt"=${new Date(Date.now()+Math.max(60,Math.min(Number(token.expires_in)||3600,86400))*1000)},"updatedAt"=CURRENT_TIMESTAMP WHERE "organizationId"=${organizationId} AND "userId"=${userId} AND status='CONNECTED' AND "encryptedRefreshToken"=${connection.encryptedRefreshToken}`);if(!updated)throw new Error("A conexão Google foi alterada. Conecte novamente.");return token.access_token as string;
}
export const validReportSpace=(value:string)=>/^spaces\/[A-Za-z0-9_-]{1,200}$/.test(value);
export async function readReportSpace(token:string,name:string){
 if(!validReportSpace(name))throw new Error("Selecione um espaço válido.");
 const response=await fetch(`https://chat.googleapis.com/v1/${name}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)}),space=await response.json();
 if(!response.ok)throw googleChatFailure(response.status,space);
 if(space.name!==name||!["SPACE","GROUP_CHAT"].includes(space.spaceType))throw new OperatorChatError("CHAT_SPACE_NOT_FOUND","O espaço não está disponível para esta conta Google.",404);
 return {name:space.name as string,displayName:typeof space.displayName==="string"?space.displayName.slice(0,120):"Grupo de gestores"};
}
export async function listReportSpaces(organizationId:string,userId:string){
 const token=await reportChatAccessToken(organizationId,userId),spaces:Array<{name:string;displayName:string}>=[];let pageToken="";
 for(let page=0;page<10;page++){
  const url=new URL("https://chat.googleapis.com/v1/spaces");url.search=new URLSearchParams({pageSize:"100",...(pageToken?{pageToken}:{})}).toString();
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)}),body=await response.json();if(!response.ok)throw googleChatFailure(response.status,body);
  for(const space of Array.isArray(body.spaces)?body.spaces:[])if(typeof space.name==="string"&&validReportSpace(space.name)&&["SPACE","GROUP_CHAT"].includes(space.spaceType))spaces.push({name:space.name,displayName:typeof space.displayName==="string"?space.displayName.slice(0,120):space.name});
  pageToken=typeof body.nextPageToken==="string"?body.nextPageToken:"";if(!pageToken)break;
 }
 return spaces;
}
