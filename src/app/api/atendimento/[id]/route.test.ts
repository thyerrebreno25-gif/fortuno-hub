import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),find:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{serviceTicket:{findFirst:m.find}}}));
vi.mock("@/modules/atendimento/auth",()=>({getServiceCenterMember:m.member,getServiceCenterPermission:m.permission,SERVICE_CENTER_MANAGER_ROLES:new Set(['MASTER','ADMIN','MANAGER'])}));
import { GET, PATCH } from "./route";
const context={params:Promise.resolve({id:'whatsapp-ticket'})};
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({organizationId:'org',userId:'user',role:'MASTER'});m.permission.mockResolvedValue({canView:true,canEdit:true});m.find.mockResolvedValue(null);});
it('does not open a WhatsApp ticket through the email API',async()=>{expect((await GET(new Request('https://hub.test/api/atendimento/whatsapp-ticket'),context)).status).toBe(404);expect(m.find.mock.calls[0][0].where).toEqual({id:'whatsapp-ticket',organizationId:'org',source:{in:['GMAIL','MANUAL']}});});
it('does not change a WhatsApp ticket through email actions',async()=>{expect((await PATCH(new Request('https://hub.test/api/atendimento/whatsapp-ticket',{method:'PATCH',body:JSON.stringify({action:'resolve'})}),context)).status).toBe(404);expect(m.find.mock.calls[0][0].where.source).toEqual({in:['GMAIL','MANUAL']});});
