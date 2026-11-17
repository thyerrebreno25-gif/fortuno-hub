import {expect,it,vi} from "vitest";
import {deleteArchivedMailbox,ArchiveDeletionError} from "./delete-archived-mailbox";
const cutoff="2026-11-01T12:00:00.000Z";
it("deletes 2059 archived tickets through 42 confirmed, sequential batches with one cutoff",async()=>{
 let remaining=2059,active=0;const onProgress=vi.fn();
 const request=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{expect(active++).toBe(0);const body=JSON.parse(String(init?.body));expect(body.confirmation).toBe("EXCLUIR ARQUIVADOS");if(remaining===2059)expect(body.cutoff).toBeUndefined();else expect(body.cutoff).toBe(cutoff);const count=Math.min(50,remaining);remaining-=count;active--;return Response.json({count,remaining,cutoff});}) as typeof fetch;
 expect(await deleteArchivedMailbox({confirmation:"EXCLUIR ARQUIVADOS",request,onProgress})).toEqual({deleted:2059});expect(request).toHaveBeenCalledTimes(42);expect(onProgress).toHaveBeenLastCalledWith({deleted:2059,remaining:0});
});
it("stops after an unknown response, preserves confirmed progress and never blindly retries deletion",async()=>{
 const request=vi.fn().mockResolvedValueOnce(Response.json({count:50,remaining:100,cutoff})).mockResolvedValueOnce(new Response("",{status:504}));
 const error=await deleteArchivedMailbox({confirmation:"EXCLUIR ARQUIVADOS",request}).catch(error=>error);
 expect(error).toBeInstanceOf(ArchiveDeletionError);expect(error.confirmedDeleted).toBe(50);expect(error.message).not.toContain("JSON");expect(request).toHaveBeenCalledTimes(2);
});
it.each([{count:0,remaining:4,cutoff},{count:51,remaining:4,cutoff},{count:-1,remaining:4,cutoff},{count:1,remaining:4,cutoff:"invalid"}])("prevents an infinite loop or false success for invalid progress",async body=>{const request=vi.fn().mockResolvedValue(Response.json(body));await expect(deleteArchivedMailbox({confirmation:"EXCLUIR ARQUIVADOS",request})).rejects.toBeInstanceOf(ArchiveDeletionError);expect(request).toHaveBeenCalledTimes(1);});
it("rejects a changed deletion snapshot",async()=>{const request=vi.fn().mockResolvedValueOnce(Response.json({count:1,remaining:3,cutoff})).mockResolvedValueOnce(Response.json({count:1,remaining:2,cutoff:"2026-11-02T12:00:00.000Z"}));const error=await deleteArchivedMailbox({confirmation:"EXCLUIR ARQUIVADOS",request}).catch(error=>error);expect(error.confirmedDeleted).toBe(1);expect(request).toHaveBeenCalledTimes(2);});
