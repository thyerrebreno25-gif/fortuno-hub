import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ department:vi.fn(),client: vi.fn(), member: vi.fn(), permission: vi.fn(), change: vi.fn(), history: vi.fn(), message: vi.fn(), relink: vi.fn(), identity: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {whatsAppDepartment:{findFirst:m.department}, client: { findFirst: m.client }, organizationMember: { findFirst: m.member }, $transaction: m.transaction } }));
vi.mock("@/modules/atendimento/auth", () => ({ getWhatsAppPermission: m.permission }));
import { transferWhatsappTicket } from "./transfer";
import type { getWhatsappTicket } from "./server";
type Ticket = NonNullable<Awaited<ReturnType<typeof getWhatsappTicket>>>;
const current = { id: "ticket", organizationId: "org", status: "IN_PROGRESS", assignedToId: "me", clientId: "client", senderEmail: "wa-group:group@g.us", senderName: "Grupo do cliente", routingArea: "GENERAL", routingSquad: "SQUAD_1" } as Ticket;
const actor = { organizationId: "org", userId: "me", user: { name: "Operador", email: "operator@example.test" } };

beforeEach(() => {
  vi.clearAllMocks(); m.member.mockResolvedValue({ role: "OPERATOR", user: { name: "Responsável", email: "target@example.test" } }); m.permission.mockResolvedValue({ canView: true, canEdit: true }); m.change.mockResolvedValue({ count: 1 });
  m.transaction.mockImplementation(async (fn) => fn({ serviceTicket: { updateMany: m.change }, serviceTicketHistory: { create: m.history }, serviceMessage: { create: m.message }, clientWhatsAppIdentity: { updateMany: m.relink, upsert: m.identity } }));
});
const destination={mode:"OPERATOR",assignedToId:"other",routingArea:"ACCOUNTS_PAYABLE"};
describe("WhatsApp conversation transfers",()=>{
 it("transfers to the explicitly selected collaborator and sector without changing client ownership or identities",async()=>{
  await transferWhatsappTicket(current,actor,false,{...destination,note:"Conferir boleto"});
  const change=m.change.mock.calls[0][0];expect(change.data).toMatchObject({assignedToId:"other",routingArea:"ACCOUNTS_PAYABLE",status:"IN_PROGRESS"});expect(change.data).not.toHaveProperty("clientId");expect(change.data).not.toHaveProperty("routingSquad");expect(change.where).toMatchObject({clientId:"client",assignedToId:"me"});
  expect(m.client).not.toHaveBeenCalled();expect(m.relink).not.toHaveBeenCalled();expect(m.identity).not.toHaveBeenCalled();
  expect(m.history.mock.calls[0][0].data.metadata).toMatchObject({clientId:"client",previousAssignedToId:"me",assignedToId:"other",routingArea:"ACCOUNTS_PAYABLE",note:"Conferir boleto"});
  expect(m.message.mock.calls[0][0].data).toMatchObject({direction:"INTERNAL",toEmails:[]});expect(m.message.mock.calls[0][0].data.textBody).toContain("Contas a pagar");expect(m.message.mock.calls[0][0].data.textBody).toContain("Conferir boleto");
 });
 it("also transfers a contact without a linked client",async()=>{
  await transferWhatsappTicket({...current,clientId:null},actor,false,destination);expect(m.change.mock.calls[0][0].where.clientId).toBeNull();expect(m.change.mock.calls[0][0].data.assignedToId).toBe("other");expect(m.client).not.toHaveBeenCalled();
 });
 it("keeps manual collaborator selection for receivables instead of resolving a client default",async()=>{
  await transferWhatsappTicket(current,actor,false,{...destination,routingArea:"ACCOUNTS_RECEIVABLE",assignedToId:"chosen"});expect(m.change.mock.calls[0][0].data).toMatchObject({assignedToId:"chosen",routingArea:"ACCOUNTS_RECEIVABLE"});expect(m.client).not.toHaveBeenCalled();
 });
 it("rejects an attempt to replace the linked client through the transfer payload",async()=>{
  await expect(transferWhatsappTicket(current,actor,true,{...destination,clientId:"foreign"})).rejects.toMatchObject({status:400});expect(m.transaction).not.toHaveBeenCalled();expect(m.identity).not.toHaveBeenCalled();
 });
 it("requires both sector and collaborator and rejects legacy automatic routing",async()=>{
  for(const input of [{mode:"AREA",routingArea:"ACCOUNTS_PAYABLE"},{assignedToId:"other"},{routingArea:"GENERAL"},{...destination,routingArea:"UNKNOWN"}])await expect(transferWhatsappTicket(current,actor,false,input)).rejects.toMatchObject({status:400});
  expect(m.transaction).not.toHaveBeenCalled();
 });
 it("prevents an operator from transferring another operator's conversation",async()=>{
  await expect(transferWhatsappTicket({...current,assignedToId:"occupied"},actor,false,destination)).rejects.toMatchObject({status:403});expect(m.transaction).not.toHaveBeenCalled();
 });
 it("allows an authorized manager to transfer an occupied conversation",async()=>{
  await transferWhatsappTicket({...current,assignedToId:"occupied"},actor,true,destination);expect(m.change.mock.calls[0][0].where.assignedToId).toBe("occupied");
 });
 it("refuses conversations and destinations outside the organization",async()=>{
  await expect(transferWhatsappTicket({...current,organizationId:"foreign"},actor,true,destination)).rejects.toMatchObject({status:404});m.member.mockResolvedValueOnce(null);await expect(transferWhatsappTicket(current,actor,true,destination)).rejects.toMatchObject({status:400});expect(m.member.mock.calls[0][0].where).toMatchObject({organizationId:"org",role:{not:"CLIENT"}});expect(m.transaction).not.toHaveBeenCalled();
 });
 it("refuses destinations without permission to attend WhatsApp",async()=>{
  m.permission.mockResolvedValueOnce({canView:true,canEdit:false});await expect(transferWhatsappTicket(current,actor,true,destination)).rejects.toMatchObject({status:400});expect(m.transaction).not.toHaveBeenCalled();
 });
 it("refuses finalized or spam calls",async()=>{
  for(const status of ["RESOLVED","SPAM"])await expect(transferWhatsappTicket({...current,status} as Ticket,actor,true,destination)).rejects.toMatchObject({status:400});expect(m.transaction).not.toHaveBeenCalled();
 });
 it("preserves a simultaneous assignment or client-link change",async()=>{
  m.change.mockResolvedValueOnce({count:0});await expect(transferWhatsappTicket(current,actor,false,destination)).rejects.toMatchObject({status:409});expect(m.history).not.toHaveBeenCalled();expect(m.message).not.toHaveBeenCalled();
 });
 it("rejects oversized internal notes before any mutation",async()=>{
  await expect(transferWhatsappTicket(current,actor,false,{...destination,note:"x".repeat(1001)})).rejects.toMatchObject({status:400});expect(m.transaction).not.toHaveBeenCalled();
 });
});

it("uses an active custom sector from this organization and records it without changing the client",async()=>{
 m.department.mockResolvedValue({id:"fiscal",name:"Fiscal"});await transferWhatsappTicket(current,actor,false,{...destination,departmentId:"fiscal"});
 expect(m.department.mock.calls[0][0].where).toEqual({id:"fiscal",organizationId:"org",active:true});expect(m.change.mock.calls[0][0].data).toMatchObject({routingArea:"GENERAL",whatsappDepartmentId:"fiscal",whatsappDepartmentName:"Fiscal",assignedToId:"other"});expect(m.change.mock.calls[0][0].data).not.toHaveProperty("clientId");expect(m.message.mock.calls[0][0].data.textBody).toContain("Fiscal");
});
it("rejects inactive or foreign custom sectors before any transfer is written",async()=>{m.department.mockResolvedValue(null);await expect(transferWhatsappTicket(current,actor,true,{...destination,departmentId:"foreign"})).rejects.toMatchObject({status:400});expect(m.transaction).not.toHaveBeenCalled();});
it("clears the previous custom sector when transferring to a standard sector",async()=>{await transferWhatsappTicket({...current,whatsappDepartmentId:"old",whatsappDepartmentName:"Antigo"},actor,false,destination);expect(m.change.mock.calls[0][0].data).toMatchObject({whatsappDepartmentId:null,whatsappDepartmentName:null,routingArea:"ACCOUNTS_PAYABLE"});});
