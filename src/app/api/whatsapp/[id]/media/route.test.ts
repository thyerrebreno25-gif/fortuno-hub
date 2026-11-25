import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({access:vi.fn(),send:vi.fn(),draft:vi.fn(),claim:vi.fn(),update:vi.fn(),create:vi.fn(),count:vi.fn(),upload:vi.fn(),download:vi.fn(),signed:vi.fn(),getBucket:vi.fn(),message:vi.fn(),attachment:vi.fn(),ticket:vi.fn(),target:vi.fn(),profile:vi.fn()}));
vi.mock("@/modules/whatsapp/contact-profile",()=>({resolvedChatProfile:m.profile}));
vi.mock("@/modules/whatsapp/outbound-access",async original=>({...await original<typeof import("@/modules/whatsapp/outbound-access")>(),whatsappSendAccess:m.access}));
vi.mock("@/modules/whatsapp/reply-target",()=>({findReplyTarget:m.target,ReplyTargetError:class extends Error{status=404;}}));
vi.mock("@/modules/whatsapp/uazapi-server",()=>({sendUazapiMedia:m.send,whatsappConnection:async()=>({id:"conn",phone:"5511"})}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({storage:{getBucket:m.getBucket,from:()=>({createSignedUploadUrl:m.upload,download:m.download,createSignedUrl:m.signed})}})}));
vi.mock("@/lib/prisma",()=>{const tx={serviceTicketHistory:{findFirst:m.draft,updateMany:m.claim,update:m.update,create:m.create,count:m.count},serviceMessage:{upsert:m.message},serviceAttachment:{upsert:m.attachment},serviceTicket:{updateMany:m.ticket}};return {prisma:{...tx,$transaction:(fn:(t:typeof tx)=>unknown)=>fn(tx)}};});
import {POST} from "./route";
import {WhatsAppSendError} from "@/modules/whatsapp/outbound-access";
const context={params:Promise.resolve({id:"ticket"})};
const meta={state:"READY",path:"org/ticket/upload/arquivo.pdf",name:"arquivo.pdf",size:9,mimeType:"application/pdf",accountRecipient:"wa-account:conn:5511"};
const post=(body:unknown)=>POST(new Request("https://hub/api/whatsapp/ticket/media",{method:"POST",body:JSON.stringify(body)}),context);
beforeEach(()=>{vi.clearAllMocks();m.access.mockResolvedValue({member:{organizationId:"org",userId:"me",user:{name:"Ana",email:"ana@example.com"}},ticket:{id:"ticket",senderEmail:"wa-contact:5522"},account:{recipient:meta.accountRecipient}});m.count.mockResolvedValue(0);m.getBucket.mockResolvedValue({data:{public:false}});m.upload.mockResolvedValue({data:{token:"scoped-upload-token"}});m.create.mockResolvedValue({id:"upload"});m.draft.mockResolvedValue({id:"upload",createdAt:new Date(),metadata:{...meta}});m.download.mockResolvedValue({data:new Blob(["%PDF-1.7\n"])});m.signed.mockResolvedValue({data:{signedUrl:"https://storage.example/signed-private-file"}});m.claim.mockResolvedValue({count:1});m.send.mockResolvedValue({messageId:"uazapi:5511:sent",providerMessageId:"sent",instanceId:"instance",connectionId:"conn",accountPhone:"5511"});m.message.mockResolvedValue({id:"message"});});
it("prepares a private scoped direct upload, without sending to WhatsApp",async()=>{const response=await post({action:"prepare",name:"arquivo.pdf",size:9});expect(response.status).toBe(200);expect((await response.json()).token).toBe("scoped-upload-token");expect(m.create.mock.calls[0][0].data).toMatchObject({ticketId:"ticket",userId:"me",metadata:{accountRecipient:meta.accountRecipient,state:"READY"}});expect(m.send).not.toHaveBeenCalled();});
it("sends a verified uploaded document once and stores its authorized attachment",async()=>{expect((await post({action:"send",uploadId:"upload",caption:"Segue"})).status).toBe(200);expect(m.send.mock.calls[0][0]).toMatchObject({organizationId:"org",accountRecipient:meta.accountRecipient,to:"5522",type:"document",file:"https://storage.example/signed-private-file",caption:"*Ana*\nSegue"});expect(m.attachment.mock.calls[0][0].create).toMatchObject({messageId:"message",storagePath:meta.path,mimeType:"application/pdf"});expect(m.update.mock.calls[0][0].data.metadata.state).toBe("SENT");});
it("prepares and sends a fiscal XML as the original document, preserving its bytes, name and download metadata",async()=>{
 const name="nota-fiscal.XML",xml='<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe/></nfeProc>',file=new Blob([xml],{type:"application/xml"});
 const prepared=await post({action:"prepare",name,size:file.size});expect(prepared.status).toBe(200);expect(await prepared.json()).toMatchObject({mimeType:"application/xml"});expect(m.create.mock.calls[0][0].data.metadata).toMatchObject({name,mimeType:"application/xml",size:file.size});expect(m.send).not.toHaveBeenCalled();
 const xmlMeta={...meta,name,mimeType:"application/xml",path:"org/ticket/upload/nota-fiscal.XML",size:file.size};m.draft.mockResolvedValueOnce({id:"upload",createdAt:new Date(),metadata:xmlMeta});m.download.mockResolvedValueOnce({data:file});
 expect((await post({action:"send",uploadId:"upload",caption:"Segue o XML da nota"})).status).toBe(200);
 expect(m.send.mock.calls[0][0]).toMatchObject({type:"document",name,mimeType:"application/xml",file:"https://storage.example/signed-private-file",caption:"*Ana*\nSegue o XML da nota"});
 expect(m.attachment.mock.calls[0][0].create).toMatchObject({name,mimeType:"application/xml",size:file.size,storagePath:xmlMeta.path});expect(await file.text()).toBe(xml);
});
it("rejects non-XML content renamed to XML before claiming the upload or contacting the provider",async()=>{
 const file=new Blob(["MZnot-an-xml"]);m.draft.mockResolvedValueOnce({id:"upload",createdAt:new Date(),metadata:{...meta,name:"nota.xml",mimeType:"application/xml",size:file.size}});m.download.mockResolvedValueOnce({data:file});
 expect((await post({action:"send",uploadId:"upload"})).status).toBe(400);expect(m.claim).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});
it("never sends an already sent or uncertain upload twice",async()=>{m.draft.mockResolvedValueOnce({id:"upload",createdAt:new Date(),metadata:{...meta,state:"SENT",messageId:"existing"}});expect((await post({action:"send",uploadId:"upload"})).status).toBe(200);m.draft.mockResolvedValueOnce({id:"upload",createdAt:new Date(),metadata:{...meta,state:"UNCONFIRMED"}});expect((await post({action:"send",uploadId:"upload"})).status).toBe(409);expect(m.send).not.toHaveBeenCalled();});
it("rejects a different account, corrupt file and a concurrent claim before sending",async()=>{m.draft.mockResolvedValueOnce({id:"upload",createdAt:new Date(),metadata:{...meta,accountRecipient:"old-number"}});expect((await post({action:"send",uploadId:"upload"})).status).toBe(404);m.download.mockResolvedValueOnce({data:new Blob(["bad-file!"])});expect((await post({action:"send",uploadId:"upload"})).status).toBe(400);m.claim.mockResolvedValueOnce({count:0});expect((await post({action:"send",uploadId:"upload"})).status).toBe(409);expect(m.send).not.toHaveBeenCalled();});
it("preserves an uncertain state when the provider response is lost",async()=>{m.send.mockRejectedValueOnce(new Error("timeout"));expect((await post({action:"send",uploadId:"upload"})).status).toBe(502);expect(m.claim.mock.calls.at(-1)![0].data.metadata.state).toBe("UNCONFIRMED");expect(m.message).not.toHaveBeenCalled();});
it("enforces ownership again just before external send",async()=>{m.access.mockResolvedValueOnce(await m.access()).mockRejectedValueOnce(new WhatsAppSendError("Transferido para outro operador.",403));expect((await post({action:"send",uploadId:"upload"})).status).toBe(403);expect(m.send).not.toHaveBeenCalled();});

it("keeps a pasted image or document attached to the explicitly selected original message",async()=>{
 m.target.mockResolvedValueOnce({providerId:"quoted-provider",quote:{id:"quoted-hub"}});expect((await post({action:"send",uploadId:"upload",replyToMessageId:"quoted-hub"})).status).toBe(200);
 expect(m.send.mock.calls[0][0].replyToMessageId).toBe("quoted-provider");expect(m.message.mock.calls[0][0].create.providerMetadata.replyToMessageId).toBe("quoted-hub");
});
it("validates named caption mentions against this group's current members and keeps the names in history",async()=>{
 const access=await m.access();m.access.mockResolvedValue({...access,ticket:{...access.ticket,senderEmail:"wa-group:123@g.us"},account:{...access.account,connection:{id:"conn"}}});
 m.profile.mockResolvedValue({participants:[{phone:"5561999999999",name:"João",lid:"987654321@lid"}]});
 expect((await post({action:"send",uploadId:"upload",caption:"Confira @João, por favor",mentionTargets:[{phone:"5561999999999",name:"João"}]})).status).toBe(200);
 expect(m.send.mock.calls[0][0]).toMatchObject({to:"123@g.us",caption:"*Ana*\nConfira @5561999999999, por favor"});
 expect(m.message.mock.calls[0][0].create).toMatchObject({textBody:"Confira @João, por favor",providerMetadata:{mentionTargets:[{phone:"5561999999999",name:"João",lid:"987654321@lid"}]}});
});
it("rejects mentions in individual chats, forged participants and excessive targets before claiming or sending",async()=>{
 const targets=[{phone:"5561999999999",name:"João"}];
 expect((await post({action:"send",uploadId:"upload",caption:"@João",mentionTargets:targets})).status).toBe(400);
 const access=await m.access();m.access.mockResolvedValue({...access,ticket:{...access.ticket,senderEmail:"wa-group:123@g.us"},account:{...access.account,connection:{id:"conn"}}});m.profile.mockResolvedValue({participants:[]});
 expect((await post({action:"send",uploadId:"upload",caption:"@João",mentionTargets:targets})).status).toBe(400);
 expect((await post({action:"send",uploadId:"upload",caption:"@João",mentionTargets:Array(51).fill(targets[0])})).status).toBe(400);
 expect(m.claim).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});
