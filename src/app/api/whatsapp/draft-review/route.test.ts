import {afterEach,expect,it,vi} from "vitest";
import {POST} from "./route";
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("retires remote review even for previously loaded clients, without calling a provider",async()=>{
 const network=vi.fn(()=>{throw Error("No remote review allowed");});vi.stubGlobal("fetch",network);vi.stubEnv("OPENAI_API_KEY","configured-but-unused");
 const response=await POST();expect(response.status).toBe(410);expect(response.headers.get("Cache-Control")).toBe("no-store");expect(await response.json()).toEqual({error:"Atualize a página para usar o revisor automático local, sem IA externa."});expect(network).not.toHaveBeenCalled();
});
