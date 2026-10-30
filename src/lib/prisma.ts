import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";

const runtime = globalThis as unknown as { prisma?: PrismaClient; fortunoDatabasePool?: Pool };
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não configurada.");
  // Each Fluid Compute instance must release idle connections before suspension.
  const pool = runtime.fortunoDatabasePool ?? new Pool({
    connectionString,
    max: 2,
    min: 0,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
    maxLifetimeSeconds: 300,
    allowExitOnIdle: true,
    application_name: "fortuno-hub-runtime",
  });
  if (!runtime.fortunoDatabasePool) {
    pool.on("error", (error: Error & { code?: string }) => console.error("Database pool connection closed:", error.code || "CONNECTION_ERROR"));
    if (process.env.VERCEL) attachDatabasePool(pool);
    runtime.fortunoDatabasePool = pool;
  }
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}
export const prisma = runtime.prisma ?? createPrismaClient();
runtime.prisma = prisma;
