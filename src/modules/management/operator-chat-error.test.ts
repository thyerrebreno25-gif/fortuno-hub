import {expect,it} from "vitest";
import {googleChatFailure,operatorChatErrorBody} from "./operator-chat-error";
it("distinguishes a disabled API from OAuth and offers only a fixed Google Cloud link to the project",()=>{
 const failure=googleChatFailure(403,{error:{message:"private raw provider text",details:[{reason:"SERVICE_DISABLED",metadata:{consumer:"projects/123456",service:"chat.googleapis.com"}}]}});expect(failure).toMatchObject({code:"CHAT_API_DISABLED",status:409,actionUrl:"https://console.cloud.google.com/apis/api/chat.googleapis.com/overview?project=123456"});expect(operatorChatErrorBody(failure).error).toContain("conta Google está conectada");expect(JSON.stringify(operatorChatErrorBody(failure))).not.toContain("private raw");
});
it("identifies a missing Chat app configuration without confusing it with an unknown space",()=>{expect(googleChatFailure(404,{error:{message:"Google Chat app not found. private-token"}})).toMatchObject({code:"CHAT_APP_NOT_CONFIGURED",status:409});expect(googleChatFailure(404,{}).code).toBe("CHAT_SPACE_NOT_FOUND");});
it.each([[401,"CHAT_RECONNECT_REQUIRED"],[403,"CHAT_ACCESS_DENIED"],[429,"CHAT_RATE_LIMITED"],[500,"CHAT_UNAVAILABLE"]])("classifies HTTP %s safely",(status,code)=>{const body=operatorChatErrorBody(googleChatFailure(Number(status),{error:{message:"private-token"}}));expect(body.code).toBe(code);expect(JSON.stringify(body)).not.toContain("private-token");});
it("distinguishes missing scopes and never passes arbitrary provider URLs or metadata to the browser",()=>{
 const failure=googleChatFailure(403,{error:{message:"private-token",details:[{reason:"ACCESS_TOKEN_SCOPE_INSUFFICIENT",metadata:{activationUrl:"https://evil.test/?token=private-token"}}]}});expect(failure.code).toBe("CHAT_SCOPE_MISSING");expect(failure.actionUrl).toBeUndefined();expect(operatorChatErrorBody(new Error("private-token"))).toEqual({code:"CHAT_UNAVAILABLE",error:"Não foi possível consultar o Google Chat agora. Tente novamente."});
});
