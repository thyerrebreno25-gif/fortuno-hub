import {expect,it} from "vitest";
import {readMailboxResponse} from "./mailbox-response";
it.each([200,502,503,504])("does not expose a JSON parser exception on empty status %s",async status=>{
 const response=new Response("",{status});await expect(readMailboxResponse(response,"Não foi possível atualizar.")).rejects.toThrow(/servidor/i);
});
it("keeps the server's actionable JSON error",async()=>{await expect(readMailboxResponse(Response.json({error:"Sem permissão."},{status:403}),"Falha")).rejects.toThrow("Sem permissão.");});
it.each([null,[],"ok"])("rejects malformed successful payloads",async payload=>{await expect(readMailboxResponse(Response.json(payload),"Falha")).rejects.toThrow("incompleta");});
it("accepts valid success JSON",async()=>expect(await readMailboxResponse(Response.json({count:2}),"Falha")).toEqual({count:2}));
