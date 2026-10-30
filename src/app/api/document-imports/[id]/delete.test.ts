import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({access:vi.fn(),company:vi.fn(),find:vi.fn(),update:vi.fn(),lock:vi.fn(),audit:vi.fn(),upsert:vi.fn()}));
vi.mock("@/modules/document-imports/server",()=>({importAccess:m.access,authorizedCompany:m.company,simulateReview:vi.fn()}));
vi.mock("@/lib/prisma",()=>{const tx={documentImportReview:{findFirst:m.find,updateMany:m.update},documentImportDispatchLease:{upsert:m.upsert,updateMany:m.lock},auditLog:{create:m.audit}};return{prisma:{...tx,$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)}};});
import { DELETE } from "./route";
const remove=()=>DELETE(new Request("https://example.test/api/document-imports/review",{method:"DELETE",body:JSON.stringify({version:2})}),{params:Promise.resolve({id:"review"})});
beforeEach(()=>{vi.clearAllMocks();m.access.mockResolvedValue({member:{organizationId:"org",userId:"user"},permission:{canDelete:true}});m.company.mockResolvedValue(true);m.find.mockResolvedValue({id:"review",clientId:"client",version:2,status:"SENT",fileName:"contract.pdf"});m.lock.mockResolvedValue({count:1});m.update.mockResolvedValue({count:1});});
it("soft deletes only the scoped contract review and retains its delivery history",async()=>{
  expect((await remove()).status).toBe(200);
  expect(m.find).toHaveBeenCalledWith({where:{id:"review",organizationId:"org",kind:"CONTRACT",status:{not:"DELETED"}}});
  expect(m.update).toHaveBeenCalledWith({where:{id:"review",organizationId:"org",version:2,status:{not:"DELETED"}},data:{status:"DELETED",version:{increment:1}}});
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({afterData:{status:"DELETED",caContractPreserved:true}})}));
});
it("enforces delete permission",async()=>{m.access.mockResolvedValue({member:{organizationId:"org"},permission:{canDelete:false}});expect((await remove()).status).toBe(403);expect(m.update).not.toHaveBeenCalled();});
it("blocks removal while the company is sending",async()=>{m.lock.mockResolvedValueOnce({count:0});expect((await remove()).status).toBe(409);expect(m.update).not.toHaveBeenCalled();});
it("rejects stale versions and releases its lease",async()=>{m.update.mockResolvedValue({count:0});expect((await remove()).status).toBe(409);expect(m.audit).not.toHaveBeenCalled();expect(m.lock).toHaveBeenLastCalledWith(expect.objectContaining({where:expect.objectContaining({clientId:"client"}),data:{expiresAt:new Date(0)}}));});
