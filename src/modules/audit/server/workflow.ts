import type {Prisma} from "@/generated/prisma/client";
export class AuditConflict extends Error {}
export async function lockAudit(tx:Prisma.TransactionClient,id:string,organizationId:string){
 const rows=await tx.$queryRaw<Array<{id:string,status:string}>>`SELECT "id", "status" FROM "Audit" WHERE "id"=${id} AND "organizationId"=${organizationId} FOR UPDATE`;
 if(!rows[0])throw new AuditConflict("Auditoria não encontrada.");
 if(rows[0].status==="COMPLETED")throw new AuditConflict("Esta auditoria já foi finalizada e seu relatório está fechado.");
}
