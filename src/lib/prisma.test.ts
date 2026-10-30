import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({pool:vi.fn(),adapter:vi.fn(),client:vi.fn(),attach:vi.fn()}));
vi.mock("pg",()=>({Pool:class{on=vi.fn();constructor(config:unknown){m.pool(config);}}}));
vi.mock("@prisma/adapter-pg",()=>({PrismaPg:class{constructor(pool:unknown){m.adapter(pool);}}}));
vi.mock("@/generated/prisma/client",()=>({PrismaClient:class{constructor(config:unknown){m.client(config);}}}));
vi.mock("@vercel/functions",()=>({attachDatabasePool:m.attach}));
const runtime=globalThis as unknown as {prisma?:unknown;fortunoDatabasePool?:unknown};
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();delete runtime.prisma;delete runtime.fortunoDatabasePool;vi.stubEnv("DATABASE_URL","postgresql://localhost/test");vi.stubEnv("NODE_ENV","production");vi.stubEnv("VERCEL","1");});
afterEach(()=>{delete runtime.prisma;delete runtime.fortunoDatabasePool;vi.unstubAllEnvs();});
it("reuses one pool and Prisma client across production module loads",async()=>{
  const first=await import("./prisma");vi.resetModules();const second=await import("./prisma");
  expect(first.prisma).toBe(second.prisma);expect(m.pool).toHaveBeenCalledTimes(1);expect(m.client).toHaveBeenCalledTimes(1);expect(m.attach).toHaveBeenCalledTimes(1);
});
it("caps connections and releases idle clients through the Vercel lifecycle",async()=>{
  await import("./prisma");expect(m.pool).toHaveBeenCalledWith(expect.objectContaining({max:2,min:0,idleTimeoutMillis:5000,connectionTimeoutMillis:10000,allowExitOnIdle:true}));expect(m.attach).toHaveBeenCalledWith(runtime.fortunoDatabasePool);
});
it("does not require Vercel lifecycle hooks outside Vercel",async()=>{vi.stubEnv("VERCEL","");await import("./prisma");expect(m.attach).not.toHaveBeenCalled();});
