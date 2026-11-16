import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({entry:vi.fn(),ticket:vi.fn(),resolve:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{whatsAppDirectoryEntry:{findFirst:m.entry},serviceTicket:{findFirst:m.ticket}}}));
vi.mock("./server",()=>({resolveWhatsappTicketId:m.resolve}));
import {groupTarget} from "./group-target";
const account={recipient:"wa-account:c:5511",connection:{id:"c",phone:"5511",instanceId:"i"},where:{organizationId:"org",source:"WHATSAPP_API",recipientEmail:"wa-account:c:5511"}} as never;
const actor={organizationId:"org",userId:"op",role:"OPERATOR"},permission={canView:true,canEdit:true};
beforeEach(()=>{vi.resetAllMocks();m.entry.mockResolvedValue({externalId:"123456@g.us"});m.ticket.mockResolvedValue({senderEmail:"wa-group:123456@g.us",assignedToId:"op",status:"IN_PROGRESS"});m.resolve.mockResolvedValue("ticket");});
it("limits directory reads to active entries on the current organization, connection and number",async()=>{
 expect(await groupTarget("directory:entry",account,actor,permission)).toBe("123456@g.us");expect(m.entry.mock.calls[0][0].where).toMatchObject({id:"entry",organizationId:"org",connectionId:"c",accountPhone:"5511",active:true,kind:"GROUP"});expect(m.ticket.mock.calls[0][0].where.recipientEmail).toBe("wa-account:c:5511");
});
it("never lets an operator edit another person's group or an unknown directory record",async()=>{
 m.ticket.mockResolvedValueOnce({assignedToId:"other",status:"IN_PROGRESS"});await expect(groupTarget("directory:entry",account,actor,permission)).rejects.toThrow("Assuma");m.entry.mockResolvedValueOnce(null);await expect(groupTarget("directory:foreign",account,actor,permission)).rejects.toThrow("Grupo não encontrado");
});
it("allows managers to use directory groups without creating calls and rejects a plain contact ticket",async()=>{
 m.ticket.mockResolvedValueOnce(null);expect(await groupTarget("directory:entry",account,{...actor,role:"MANAGER"},permission)).toBe("123456@g.us");expect(m.resolve).not.toHaveBeenCalled();m.ticket.mockResolvedValueOnce({assignedToId:"op",status:"IN_PROGRESS",senderEmail:"wa-contact:5511"});await expect(groupTarget("ticket",account,actor,permission)).rejects.toThrow("não é um grupo");
});
