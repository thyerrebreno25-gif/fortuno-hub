import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({account:vi.fn(),query:vi.fn()}));
vi.mock("./account-scope",()=>({currentWhatsAppAccount:m.account}));
vi.mock("@/lib/prisma",()=>({prisma:{$queryRaw:m.query}}));
import {readWhatsAppConversation,ConversationCursorError} from "./conversation-read";
beforeEach(()=>{vi.clearAllMocks();m.account.mockResolvedValue({recipient:"wa-account:c:5511",connection:{phone:"5511"}});m.query.mockResolvedValue([{cursorValid:true,payload:{id:"canonical",messages:[]}}]);});
it("reads the conversation and latest message page in one database snapshot, without audit history or provider payload in the response projection",async()=>{
  const messages=Array.from({length:51},(_,i)=>({id:String(100-i),receivedAt:"2026-11-08T23:00:00.000Z",attachments:[]}));m.query.mockResolvedValueOnce([{cursorValid:true,payload:{id:"canonical",messages}}]);
  const result=await readWhatsAppConversation("old","org");expect(m.query).toHaveBeenCalledOnce();expect(result).toMatchObject({id:"canonical",hasOlderMessages:true,history:[]});expect(result?.messages).toHaveLength(50);expect(result?.messages[0].id).toBe("51");expect(result?.messages.at(-1)?.id).toBe("100");
  const sql=m.query.mock.calls[0][0];expect(sql.sql).toContain("LIMIT 51");expect(sql.sql).not.toContain("ServiceTicketHistory");expect(sql.sql).not.toContain("htmlBody");expect(sql.sql).toContain("to_char(m.\"receivedAt\"");
});
it("scopes both canonical and merged aliases to the organization and current connected phone",async()=>{await readWhatsAppConversation("old","org");const sql=m.query.mock.calls[0][0];expect(sql.values.filter((v:unknown)=>v==="org").length).toBeGreaterThanOrEqual(2);expect(sql.values.filter((v:unknown)=>v==="wa-account:c:5511").length).toBe(2);expect(sql.sql).toContain("NOT(t.id=ANY(a.path))");expect(sql.sql).toContain("a.depth<4");});
it("keeps SQL parameters separate from hostile identifiers and uses a scoped keyset cursor",async()=>{const id="x' OR true --";await readWhatsAppConversation(id,"org","before");const sql=m.query.mock.calls[0][0];expect(sql.sql).not.toContain(id);expect(sql.values).toContain(id);expect(sql.values).toContain("before");expect(sql.sql).toContain('(m."receivedAt",m.id)<(SELECT "receivedAt",id FROM cursor_row)');});
it("rejects a cursor outside the conversation instead of reading another ticket's messages",async()=>{m.query.mockResolvedValueOnce([{cursorValid:false,payload:{id:"canonical",messages:[]}}]);await expect(readWhatsAppConversation("t","org","foreign")).rejects.toBeInstanceOf(ConversationCursorError);});
it("does not query messages for a disconnected account and reuses an already checked account",async()=>{m.account.mockResolvedValueOnce({recipient:null,connection:null});expect(await readWhatsAppConversation("t","org")).toBeNull();expect(m.query).not.toHaveBeenCalled();await readWhatsAppConversation("t","org",undefined,{recipient:"wa-account:c:5511",connection:{phone:"5511"}} as Awaited<ReturnType<typeof m.account>>);expect(m.account).toHaveBeenCalledTimes(1);});
