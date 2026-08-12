const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"] as const;
function env(name:string){const v=process.env[name]?.trim();if(!v)throw new Error(`${name} não configurada.`);return v;}
export const getGoogleGmailClientId=()=>env("GOOGLE_GMAIL_CLIENT_ID");
export const getGoogleGmailClientSecret=()=>env("GOOGLE_GMAIL_CLIENT_SECRET");
export function getGoogleGmailRedirectUri(request?:Request){const v=process.env.GOOGLE_GMAIL_REDIRECT_URI?.trim();if(v)return v;if(!request)throw new Error("GOOGLE_GMAIL_REDIRECT_URI não configurada.");return `${new URL(request.url).origin}/api/atendimento/gmail/callback`;}
export function buildGmailAuthorizationUrl({state,redirectUri}:{state:string;redirectUri:string}){const p=new URLSearchParams({client_id:getGoogleGmailClientId(),redirect_uri:redirectUri,response_type:"code",access_type:"offline",include_granted_scopes:"true",prompt:"consent",state,scope:GMAIL_SCOPES.join(" ")});return `${AUTH_URL}?${p}`;}
export async function exchangeCodeForTokens({code,redirectUri}:{code:string;redirectUri:string}){const r=await fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:getGoogleGmailClientId(),client_secret:getGoogleGmailClientSecret(),redirect_uri:redirectUri,grant_type:"authorization_code"}),cache:"no-store"});const b=await r.json() as any;if(!r.ok||!b.access_token)throw new Error(b.error_description||b.error||"Falha no OAuth do Google.");return b;}
export async function getGmailProfile(token:string){const r=await fetch(PROFILE_URL,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});const b=await r.json() as any;if(!r.ok||!b.emailAddress)throw new Error(b.error?.message||"Não foi possível identificar a conta Gmail.");return b;}
export async function revokeGoogleToken(token:string){await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},cache:"no-store"}).catch(()=>undefined);}
