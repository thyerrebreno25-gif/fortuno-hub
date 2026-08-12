import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getServiceCenterMember,getServiceCenterPermission } from "@/modules/atendimento/auth";
import { buildGmailAuthorizationUrl,getGoogleGmailRedirectUri } from "@/modules/atendimento/gmail/oauth";
const COOKIE="fortuno_gmail_oauth_state";
export async function GET(request:Request){const m=await getServiceCenterMember();if(!m)return NextResponse.redirect(new URL("/login",request.url));const p=await getServiceCenterPermission(m.organizationId,m.role);if(!p.canManage)return NextResponse.redirect(new URL("/atendimento?gmail_error=permission",request.url));try{const state=crypto.randomBytes(32).toString("hex");const redirectUri=getGoogleGmailRedirectUri(request);const res=NextResponse.redirect(buildGmailAuthorizationUrl({state,redirectUri}));res.cookies.set(COOKIE,state,{httpOnly:true,secure:new URL(request.url).protocol==="https:",sameSite:"lax",path:"/",maxAge:600});return res}catch(e){console.error("Erro OAuth Gmail:",e);return NextResponse.redirect(new URL("/atendimento?gmail_error=config",request.url));}}
