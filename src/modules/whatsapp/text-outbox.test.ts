import {afterEach, beforeEach, expect, it, vi} from "vitest";
vi.mock("server-only",()=>({}));
type Row={id:string;ticketId:string;externalMessageId:string|null;direction:string;deliveryStatus:string|null;receivedAt:Date;textBody:string;fromName:string;providerMetadata:Record<string,unknown>;attachments:Array<{id:string}>};
const m=vi.hoisted(()=>({send:vi.fn(),rows:new Map<string,Row>(),query:vi.fn(),create:vi.fn(),update:vi.fn(),history:vi.fn(),remove:vi.fn(),ticketUpdate:vi.fn(),owner:"operator",ticketStatus:"IN_PROGRESS",account:true,receivedAt:new Date(0),lock:vi.fn()}));
vi.mock("./server",()=>({resolveWhatsappTicketId:async(id:string)=>id}));
vi.mock("./uazapi-server",()=>({sendUazapiText:m.send}));
vi.mock("@/lib/prisma",()=>{
  const scope=(where:Record<string,unknown>)=>{const ticket=where.ticket as Record<string,unknown>|undefined;return !ticket||ticket.organizationId==="org"&&ticket.recipientEmail==="wa-account:c:5511"&&ticket.senderEmail==="wa-group:123@g.us";};
  const messages={
    findFirst:vi.fn(async({where}:{where:Record<string,unknown>})=>{
      if(!scope(where))return null;
      return [...m.rows.values()].find(row=>(!where.id||typeof where.id==="string"?(!where.id||row.id===where.id):row.id!==(where.id as {not:string}).not)&&(!where.externalMessageId||row.externalMessageId===where.externalMessageId))||null;
    }),
    create:m.create, update:m.update, delete:m.remove,
    updateMany:vi.fn(async({where,data}:{where:{id:string};data:Partial<Row>})=>{const row=m.rows.get(where.id);if(!row||row.externalMessageId)return {count:0};Object.assign(row,data);return {count:1};}),
  };
  const tx={serviceMessage:messages,serviceTicketHistory:{create:m.history},serviceTicket:{findFirst:vi.fn(async({where}:{where:{assignedToId?:string}})=>where.assignedToId&&where.assignedToId!==m.owner?null:{id:"ticket",status:m.ticketStatus,assignedToId:m.owner,receivedAt:m.receivedAt,lastMessageAt:new Date(0),firstResponseAt:null}),update:m.ticketUpdate},$executeRaw:m.lock,$queryRaw:m.query};
  return {prisma:{...tx,$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)}};
});
import {confirmRecordedText,reconcileTextEcho,sendRecordedText,type RecordedText} from "./text-outbox";
const input:RecordedText={organizationId:"org",connectionId:"c",instanceId:"instance",accountPhone:"5511",senderEmail:"wa-group:123@g.us",accountRecipient:"wa-account:c:5511",actor:{userId:"operator",user:{name:"Brunna Ferreira",email:"brunna@test"}},ticketId:"ticket",requestId:"d6a04b95-7ed1-4720-8b93-a20490e89d71",content:"Mensagem que não pode sumir",wireBody:"*Brunna Ferreira*\nMensagem que não pode sumir",to:"123@g.us"};
const scope=input;
beforeEach(()=>{
  vi.clearAllMocks();m.rows.clear();m.owner="operator";m.ticketStatus="IN_PROGRESS";m.account=true;m.receivedAt=new Date(0);
  vi.spyOn(console,"warn").mockImplementation(()=>{});
  m.query.mockImplementation(async(strings:TemplateStringsArray,...values:unknown[])=>strings.join("").includes("WhatsAppConnection")?m.account&&JSON.stringify(values)===JSON.stringify(["c","org","instance","5511"])?[{id:"c"}]:[]:[]);
  m.create.mockImplementation(async({data}:{data:Row})=>{const row={...data,externalMessageId:data.externalMessageId??null,attachments:data.attachments??[]};m.rows.set(row.id,row);return row;});
  m.update.mockImplementation(async({where,data}:{where:{id:string};data:Partial<Row>})=>{const row=m.rows.get(where.id)!;Object.assign(row,data);return row;});
  m.remove.mockImplementation(async({where}:{where:{id:string}})=>m.rows.delete(where.id));
  m.send.mockResolvedValue({messageId:"uazapi:5511:provider-id"});
});
afterEach(()=>vi.restoreAllMocks());
it("persists the author's text before dispatch, then confirms the same row without changing ownership",async()=>{
  m.send.mockImplementationOnce(async()=>{expect(m.rows.size).toBe(1);expect([...m.rows.values()][0]).toMatchObject({fromName:"Brunna Ferreira",textBody:input.content,deliveryStatus:"unconfirmed",externalMessageId:null});return {messageId:"uazapi:5511:provider-id"};});
  const result=await sendRecordedText(input);expect(result.confirmed).toBe(true);expect(m.rows.size).toBe(1);expect(m.rows.get(result.messageId)).toMatchObject({externalMessageId:"uazapi:5511:provider-id",deliveryStatus:"accepted",providerMetadata:{sendState:"CONFIRMED"}});
  expect(m.send.mock.calls[0][0]).toMatchObject({trackingId:result.messageId,body:input.wireBody,accountRecipient:input.accountRecipient});
  for(const call of m.ticketUpdate.mock.calls)expect(call[0].data).not.toHaveProperty("assignedToId");
  expect(m.history.mock.calls.filter(call=>call[0].data.type==="WHATSAPP_REPLIED")).toHaveLength(1);
});
it("keeps a timed-out send in durable history and never automatically resends an uncertain attempt",async()=>{
  m.send.mockRejectedValueOnce(new DOMException("secret provider URL", "TimeoutError"));
  const first=await sendRecordedText(input),second=await sendRecordedText(input);
  expect(first.confirmed).toBe(false);expect(second.messageId).toBe(first.messageId);expect(second.confirmed).toBe(false);expect(m.send).toHaveBeenCalledOnce();expect(m.rows.size).toBe(1);
  const row=m.rows.get(first.messageId)!;expect(row.providerMetadata).toMatchObject({sendState:"UNKNOWN",errorCode:"TIMEOUT"});expect(JSON.stringify(row)).not.toContain("secret provider URL");
  expect(m.ticketUpdate.mock.calls[0][0].data).not.toHaveProperty("firstResponseAt");
  expect(m.history.mock.calls.filter(call=>call[0].data.type==="WHATSAPP_REPLIED")).toHaveLength(0);
});
it("reconciles a delayed echo after timeout, retaining author and body across repeated echoes",async()=>{
  m.send.mockRejectedValueOnce(new Error("invalid JSON"));const result=await sendRecordedText(input);
  const echo={fromMe:true,trackingId:result.messageId,id:"provider-id",apiId:"owner:provider-id",providerStatus:"read"};
  expect(await reconcileTextEcho(scope,echo)).toBe(true);expect(await reconcileTextEcho(scope,echo)).toBe(true);
  expect(m.rows.size).toBe(1);expect(m.rows.get(result.messageId)).toMatchObject({fromName:"Brunna Ferreira",textBody:input.content,deliveryStatus:"read",externalMessageId:"uazapi:5511:provider-id"});
  expect(m.history.mock.calls.filter(call=>call[0].data.type==="WHATSAPP_REPLIED")).toHaveLength(1);
});
it("does not let a late HTTP error erase or downgrade an earlier provider echo",async()=>{
  m.send.mockImplementationOnce(async({trackingId}:{trackingId:string})=>{await reconcileTextEcho(scope,{fromMe:true,trackingId,id:"provider-id",apiId:"owner:provider-id",providerStatus:"read"});throw new Error("socket closed");});
  const result=await sendRecordedText(input);expect(result.confirmed).toBe(true);expect(m.rows.get(result.messageId)).toMatchObject({deliveryStatus:"read",providerMetadata:{sendState:"CONFIRMED"}});expect(m.send).toHaveBeenCalledOnce();
});
it("does not downgrade read receipts when the HTTP confirmation arrives after the echo",async()=>{
  m.send.mockImplementationOnce(async({trackingId}:{trackingId:string})=>{await reconcileTextEcho(scope,{fromMe:true,trackingId,id:"provider-id",apiId:"owner:provider-id",providerStatus:"read"});return {messageId:"uazapi:5511:provider-id"};});
  const result=await sendRecordedText(input);expect(m.rows.get(result.messageId)?.deliveryStatus).toBe("read");expect(m.history.mock.calls.filter(call=>call[0].data.type==="WHATSAPP_REPLIED")).toHaveLength(1);
});
it("does not resend a confirmed request or accept changed text with the same request id",async()=>{
  const first=await sendRecordedText(input);expect((await sendRecordedText(input)).messageId).toBe(first.messageId);await expect(sendRecordedText({...input,wireBody:"Other text"})).rejects.toThrow("outro conteúdo");expect(m.send).toHaveBeenCalledOnce();
});
it("refuses to dispatch when the owner or physical account changed",async()=>{
  m.owner="another-operator";await expect(sendRecordedText(input)).rejects.toThrow("atribuição");m.owner="operator";m.account=false;await expect(sendRecordedText(input)).rejects.toThrow("conexão mudou");expect(m.send).not.toHaveBeenCalled();expect(m.rows.size).toBe(0);
});
it("does not confirm an attempt from a different organization, account or conversation",async()=>{
  m.send.mockRejectedValueOnce(new Error("timeout"));const result=await sendRecordedText(input);m.update.mockClear();
  for(const changed of [{organizationId:"other"},{accountPhone:"5522"},{senderEmail:"wa-group:456@g.us"},{instanceId:"old"}])expect(await confirmRecordedText({...scope,...changed},result.messageId,"uazapi:5511:provider-id")).toBe(false);
  expect(m.update).not.toHaveBeenCalled();expect(m.remove).not.toHaveBeenCalled();
});
it("does not reopen a call finalized while sending or restore its former owner",async()=>{
  m.send.mockImplementationOnce(async()=>{m.ticketStatus="RESOLVED";return {messageId:"uazapi:5511:provider-id"};});await sendRecordedText(input);
  expect(m.ticketUpdate.mock.calls.at(-1)![0].data).not.toHaveProperty("status");expect(m.ticketUpdate.mock.calls.at(-1)![0].data).not.toHaveProperty("assignedToId");
});
it("merges only a proven duplicate text echo and carries forward its receipt",async()=>{
  m.send.mockImplementationOnce(async()=>{m.rows.set("generic-echo",{id:"generic-echo",ticketId:"ticket",direction:"OUTBOUND",externalMessageId:"uazapi:5511:provider-id",fromName:"Fortuno Gestão Financeira",textBody:input.wireBody,receivedAt:new Date(),deliveryStatus:"read",providerMetadata:{provider:"UAZAPI"},attachments:[]});return {messageId:"uazapi:5511:provider-id"};});
  const result=await sendRecordedText(input);expect(result.confirmed).toBe(true);expect(m.rows.size).toBe(1);expect(m.rows.get(result.messageId)).toMatchObject({fromName:"Brunna Ferreira",deliveryStatus:"read",providerMetadata:{reconciledEchoId:"generic-echo"}});
});
it("keeps the uncertain record if confirmation cannot match the current account",async()=>{
  m.send.mockImplementationOnce(async()=>{m.account=false;return {messageId:"uazapi:5511:provider-id"};});const result=await sendRecordedText(input);expect(result.confirmed).toBe(false);expect(m.rows.size).toBe(1);
});
it("never treats an incoming customer's tracking id as confirmation",async()=>{expect(await reconcileTextEcho(scope,{fromMe:false,trackingId:"wa-text:unknown",id:"id",apiId:"id"})).toBe(false);expect(m.query).not.toHaveBeenCalled();});
it("does not count a late confirmation as the first response to a newer reopened call",async()=>{
 m.send.mockImplementationOnce(async()=>{m.receivedAt=new Date(Date.now()+10000);return {messageId:"uazapi:5511:provider-id"};});await sendRecordedText(input);
 const change=m.ticketUpdate.mock.calls.at(-1)![0].data;expect(change).not.toHaveProperty("firstResponseAt");expect(change).not.toHaveProperty("status");
});
