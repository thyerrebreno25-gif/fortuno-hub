import {createHmac} from "node:crypto";
import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({connection:vi.fn(),import:vi.fn(),process:vi.fn(),after:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{fathomConnection:{findUnique:m.connection}}}));
vi.mock("next/server",async original=>({...await original<typeof import("next/server")>(),after:m.after}));
vi.mock("@/modules/purchase-invoices/server/crypto",()=>({decryptIntegrationSecret:(value:string)=>value}));
vi.mock("@/modules/meetings/fathom",()=>({importFathomMeeting:m.import}));
vi.mock("@/modules/meetings/reports",()=>({processMeetingReport:m.process}));
import {POST} from "./route";
const secret="whsec_"+Buffer.from("test-only-secret").toString("base64");
const payload={recording_id:123,title:"Teste",url:"https://fathom.video/calls/test",recording_start_time:"2026-11-04T12:00:00Z"};
function request(signed=true,body=JSON.stringify(payload)){const timestamp=String(Math.floor(Date.now()/1000)),id="msg_test",signature=createHmac("sha256",Buffer.from("test-only-secret")).update(id+"."+timestamp+"."+body).digest("base64");return POST(new Request("https://hub.test/api/meetings/fathom/webhook/callback",{method:"POST",headers:{"webhook-id":id,"webhook-timestamp":timestamp,"webhook-signature":signed?"v1,"+signature:"v1,bad"},body}),{params:Promise.resolve({callbackId:"callback"})});}
beforeEach(()=>{vi.clearAllMocks();m.connection.mockResolvedValue({id:"connection",enabled:true,encryptedWebhookSecret:secret});m.import.mockResolvedValue({imported:true,meetingId:"meeting"});});
it("rejects invalid signatures before any content import",async()=>{expect((await request(false)).status).toBe(401);expect(m.import).not.toHaveBeenCalled();});
it("rejects callbacks for a disconnected account",async()=>{m.connection.mockResolvedValue({enabled:false});expect((await request()).status).toBe(401);expect(m.import).not.toHaveBeenCalled();});
it("requires a valid provider payload even after signature validation",async()=>{expect((await request(true,"{}" )).status).toBe(400);expect(m.import).not.toHaveBeenCalled();});
it("acknowledges only after the import is persisted and resumes its report",async()=>{expect((await request()).status).toBe(200);expect(m.import).toHaveBeenCalledWith("connection",payload);expect(m.process).not.toHaveBeenCalled();await m.after.mock.calls[0][0]();expect(m.process).toHaveBeenCalledWith("meeting");});
