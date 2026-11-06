import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({connection:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{whatsAppConnection:{findUnique:m.connection}}}));
import { accountMessageWhere, accountTicketWhere, currentWhatsAppAccount, type WhatsAppAccount } from "./account-scope";
const account:WhatsAppAccount={id:"conn",organizationId:"org",instanceId:"permanent",phone:"5561999999999",status:"CONNECTED",expiresAt:null,webhookConfiguredAt:new Date()};
beforeEach(()=>{vi.clearAllMocks();m.connection.mockResolvedValue(account);});
it("binds every ticket query to the current physical phone, including after reuse of the same instance",async()=>{
 const first=await currentWhatsAppAccount("org");m.connection.mockResolvedValue({...account,phone:"5561888888888"});const next=await currentWhatsAppAccount("org");
 expect(next.where).toEqual({organizationId:"org",source:"WHATSAPP_API",recipientEmail:"wa-account:conn:5561888888888"});
 expect(next.accountKey).not.toBe(first.accountKey);expect(next.where).not.toHaveProperty("OR");expect(m.connection.mock.calls[0][0].select).not.toHaveProperty("tokenEncrypted");
});
it("fails closed for missing, expired, disconnected or foreign accounts",()=>{
 for(const value of [null,{...account,status:"DISCONNECTED"},{...account,phone:null},{...account,expiresAt:new Date(0)},{...account,organizationId:"other"}])expect(accountTicketWhere("org",value)).toHaveProperty("id",{in:[]});
});
it("restricts historical messages and media to the new account's stamped phone or message id",()=>{
 expect(accountMessageWhere(account)).toEqual({OR:[{providerMetadata:{path:["accountPhone"],equals:account.phone}},{externalMessageId:{startsWith:"uazapi:"+account.phone+":"}}]});
});
