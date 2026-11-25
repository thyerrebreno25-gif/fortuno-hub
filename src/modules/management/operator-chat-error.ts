export class OperatorChatError extends Error{
 constructor(public code:string,message:string,public status=503,public actionUrl?:string){super(message);}
}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function googleChatFailure(status:number,payload:unknown){
 const error=record(record(payload).error),details=Array.isArray(error.details)?error.details:[],entries=details.map(record);
 const reasons=entries.map(entry=>String(entry.reason||"")),metadata=entries.map(entry=>record(entry.metadata));
 let project=metadata.map(item=>String(item.consumer||item.project||item.projectId||"").replace(/^projects\//,"")).find(value=>/^[A-Za-z0-9_-]{1,100}$/.test(value));
 if(!project)for(const item of metadata){try{const url=new URL(String(item.activationUrl||item.activation_url||""));if(url.protocol==="https:"&&["console.developers.google.com","console.cloud.google.com"].includes(url.hostname)){const value=url.searchParams.get("project")||"";if(/^[A-Za-z0-9_-]{1,100}$/.test(value))project=value;}}catch{/* Ignore unknown provider metadata. */}}
 const actionUrl="https://console.cloud.google.com/apis/api/chat.googleapis.com/overview"+(project?"?project="+encodeURIComponent(project):"");
 const message=typeof error.message==="string"?error.message:"";
 if(reasons.includes("SERVICE_DISABLED")||reasons.includes("API_DISABLED")||/Google Chat API.*(?:has not been used|disabled)/i.test(message))return new OperatorChatError("CHAT_API_DISABLED","A conta Google está conectada, mas a API Google Chat está desativada no projeto da integração. Ative a API e carregue os espaços novamente.",409,actionUrl);
 if(/chat app not found|chat application.*not (?:found|configured)|app.*not configured/i.test(message))return new OperatorChatError("CHAT_APP_NOT_CONFIGURED","A conta Google está conectada, mas falta configurar o aplicativo Google Chat no projeto da integração. Conclua a configuração e carregue os espaços novamente.",409,actionUrl);
 if(reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")||/insufficient authentication scopes/i.test(message))return new OperatorChatError("CHAT_SCOPE_MISSING","A autorização Google não liberou os acessos necessários ao Chat. Reconecte e autorize o envio e a consulta dos espaços.",403);
 if(status===401)return new OperatorChatError("CHAT_RECONNECT_REQUIRED","A autorização do Google Chat expirou ou foi revogada. Reconecte a conta Google.",401);
 if(status===403)return new OperatorChatError("CHAT_ACCESS_DENIED","O Google recusou o acesso aos espaços desta conta. Confira as permissões do Google Chat e as restrições do administrador do Google Workspace.",403);
 if(status===404)return new OperatorChatError("CHAT_SPACE_NOT_FOUND","O espaço do Google Chat não foi encontrado ou não está disponível para a conta conectada.",404);
 if(status===429)return new OperatorChatError("CHAT_RATE_LIMITED","O Google Chat limitou as consultas. Aguarde alguns instantes e tente novamente.",429);
 return new OperatorChatError("CHAT_UNAVAILABLE","Não foi possível consultar o Google Chat agora. Tente novamente em alguns instantes.",503);
}
export function operatorChatErrorBody(error:unknown){return error instanceof OperatorChatError?{error:error.message,code:error.code,...(error.actionUrl?{actionUrl:error.actionUrl}:{})}:{error:"Não foi possível consultar o Google Chat agora. Tente novamente.",code:"CHAT_UNAVAILABLE"};}
