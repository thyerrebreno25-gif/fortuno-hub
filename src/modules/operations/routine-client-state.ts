import "server-only";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
export type RoutineClientState={clientId:string;suspended:boolean;onboarding:boolean};
export async function routineClientStates(organizationId:string){return prisma.$queryRaw<RoutineClientState[]>(Prisma.sql`SELECT "clientId",suspended,onboarding FROM "OperationClientRoutineState" WHERE "organizationId"=${organizationId}`);}
export async function routineClientSuspended(tx:Prisma.TransactionClient,organizationId:string,clientId:string){const [row]=await tx.$queryRaw<{suspended:boolean}[]>(Prisma.sql`SELECT suspended FROM "OperationClientRoutineState" WHERE "organizationId"=${organizationId} AND "clientId"=${clientId}`);return row?.suspended===true;}
