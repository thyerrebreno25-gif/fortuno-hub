import { expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

it("executes PostgreSQL void-returning locks without asking the installed adapter to deserialize them",async()=>{
  // Use the real installed adapter with an in-memory driver result. No DB/network connection.
  const pool=new Pool({connectionString:"postgresql://unused:unused@127.0.0.1:5432/unused"});
  vi.spyOn(pool,"query").mockResolvedValue({fields:[{name:"pg_advisory_xact_lock",dataTypeID:2278}],rows:[[""]],rowCount:1} as never);
  const adapter=await new PrismaPg(pool).connect();
  const query={sql:"SELECT pg_advisory_xact_lock(hashtext($1))",args:["organization:meeting:request"],argTypes:[{scalarType:"string" as const,dbType:"TEXT",arity:"scalar" as const}]};
  try {
    await expect(adapter.queryRaw(query)).rejects.toMatchObject({cause:{kind:"UnsupportedNativeDataType",type:"void"}});
    await expect(adapter.executeRaw(query)).resolves.toBe(1);
  } finally {await adapter.dispose();await pool.end();}
});
