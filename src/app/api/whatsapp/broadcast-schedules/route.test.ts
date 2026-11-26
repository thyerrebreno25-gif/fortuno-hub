import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),create:vi.fn(),list:vi.fn(),change:vi.fn(),details:vi.fn()}));
vi.mock("@/modules/atendimento/auth",()=>({getServiceCenterMember:m.member,getWhatsAppPermission:m.permission}));
vi.mock("@/modules/whatsapp/broadcast-schedule-server",()=>({scheduleBroadcast:m.create,listBroadcastSchedules:m.list,changeBroadcastSchedule:m.change,broadcastScheduleDetails:m.details,BroadcastScheduleError:class extends Error{constructor(message:string,public status=409){super(message);}}}));
import {GET,POST,PATCH} from "./route";
const id="5d28aa69-d6a3-48ba-a1dd-384084f33a9a",member={organizationId:"org",userId:"operator",role:"OPERATOR"};
const body={id,name:"Clientes",content:"Aviso",scheduledAt:"2026-11-26T19:00:00Z",recipients:Array.from({length:75},(_,i)=>({clientId:"c"+i,ticketId:"t"+i}))};
const post=(value:unknown)=>POST(new Request("https://hub.test/api/whatsapp/broadcast-schedules",{method:"POST",body:JSON.stringify(value)}));
beforeEach(()=>{vi.resetAllMocks();m.member.mockResolvedValue(member);m.permission.mockResolvedValue({canView:true,canEdit:true});m.create.mockResolvedValue({id,status:"SCHEDULED"});m.list.mockResolvedValue([]);});
it("requires current staff edit permission for scheduling and management",async()=>{
 m.member.mockResolvedValueOnce(null);expect((await post(body)).status).toBe(403);m.member.mockResolvedValueOnce({...member,role:"CLIENT"});expect((await GET(new Request("https://hub.test/api/whatsapp/broadcast-schedules"))).status).toBe(403);
 m.permission.mockResolvedValueOnce({canView:true,canEdit:false});expect((await PATCH(new Request("https://hub.test/api/whatsapp/broadcast-schedules",{method:"PATCH",body:JSON.stringify({id,action:"cancel"})}))).status).toBe(403);expect(m.create).not.toHaveBeenCalled();expect(m.change).not.toHaveBeenCalled();
});
it("passes the authenticated actor and validates the expanded recipient list",async()=>{
 expect((await post(body)).status).toBe(201);expect(m.create).toHaveBeenCalledWith(member,body);expect((await post({...body,recipients:[]})).status).toBe(400);
});
it("returns private uncached lists and does not trust a foreign actor supplied in the request",async()=>{
 const result=await GET(new Request("https://hub.test/api/whatsapp/broadcast-schedules"));expect(result.headers.get("Cache-Control")).toBe("private, no-store");expect(m.list).toHaveBeenCalledWith(member);
 expect((await post({...body,userId:"foreign",organizationId:"other"})).status).toBe(400);
});
