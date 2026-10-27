import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "./crypto";
import { getGoogleGmailClientId, getGoogleGmailClientSecret } from "./oauth";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
type GmailPayload = { partId?: string; mimeType?: string; filename?: string; headers?: Array<{ name: string; value: string }>; body?: { size?: number; data?: string; attachmentId?: string }; parts?: GmailPayload[] };
type GmailResponse = { id?: string; threadId?: string; labelIds?: string[]; payload?: GmailPayload; snippet?: string; internalDate?: string; data?: string; historyId?: string; expiration?: string; nextPageToken?: string; messages?: Array<{ id: string }>; history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>; error?: { message?: string } };
export class GmailApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function getValidAccessToken(connection: { id:string; encryptedAccessToken:string|null; encryptedRefreshToken:string|null; tokenExpiresAt:Date|null }) {
  if (connection.encryptedAccessToken && connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() > Date.now()+60_000) return decryptSecret(connection.encryptedAccessToken);
  if (!connection.encryptedRefreshToken) throw new Error("Conexão Gmail sem refresh token.");
  const refreshToken=decryptSecret(connection.encryptedRefreshToken);
  const r=await fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},signal:AbortSignal.timeout(20000),body:new URLSearchParams({client_id:getGoogleGmailClientId(),client_secret:getGoogleGmailClientSecret(),refresh_token:refreshToken,grant_type:"refresh_token"}),cache:"no-store"});
  const b=await r.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if(!r.ok||!b.access_token) throw new GmailApiError(b.error === "invalid_grant" ? 401 : r.status, "Não foi possível renovar a autorização do Gmail.");
  const expiresAt=new Date(Date.now()+(Number(b.expires_in)||3600)*1000);
  await prisma.emailConnection.update({where:{id:connection.id},data:{encryptedAccessToken:encryptSecret(b.access_token),tokenExpiresAt:expiresAt}});
  return b.access_token as string;
}

export async function gmailFetch(token:string,path:string,init?:RequestInit){const r=await fetch(`${GMAIL}${path}`,{...init,signal:init?.signal ?? AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(init?.headers||{})},cache:"no-store"});const b=await r.json().catch(()=>({})) as GmailResponse;if(!r.ok)throw new GmailApiError(r.status,b.error?.message||`Gmail API ${r.status}`);return b;}

export async function startMailboxWatch(token:string){const topic=process.env.GMAIL_PUBSUB_TOPIC?.trim();if(!topic)throw new Error("GMAIL_PUBSUB_TOPIC não configurada.");return gmailFetch(token,"/watch",{method:"POST",body:JSON.stringify({topicName:topic,labelIds:["INBOX"],labelFilterBehavior:"INCLUDE"})});}
