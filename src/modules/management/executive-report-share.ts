import "server-only";
import {createHash,createHmac,randomUUID} from "node:crypto";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {executiveReportData,executiveReportSchema} from "./executive-report-model";
import type {OperatorDayReport} from "./operator-report-model";
export const executivePublicPath=(token:string)=>`/relatorios/d/${token}`;
export const validExecutiveToken=(token:string)=>/^[A-Za-z0-9_-]{43}$/.test(token);
function shareToken(organizationId:string,sourceKey:string){
 const key=process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY||process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
 if(!key||key.length<16)throw new Error("A publicação dos relatórios está indisponível.");
 return createHmac("sha256",key).update(JSON.stringify(["fortuno-executive-readonly-v1",organizationId,sourceKey])).digest("base64url");
}
export async function publishExecutiveReport(organizationId:string,actorId:string,sourceKey:string,report:OperatorDayReport,now=new Date()){
 const snapshot=executiveReportData(report),token=shareToken(organizationId,sourceKey),tokenHash=createHash("sha256").update(token).digest("hex"),expiresAt=new Date(+now+90*86400000);
 await prisma.$executeRaw(Prisma.sql`INSERT INTO "ExecutiveReportView" (id,"organizationId","createdById","sourceKey","tokenHash",snapshot,"expiresAt") VALUES (${randomUUID()},${organizationId},${actorId},${sourceKey},${tokenHash},${JSON.stringify(snapshot)}::jsonb,${expiresAt}) ON CONFLICT ("organizationId","sourceKey") DO NOTHING`);
 const [row]=await prisma.$queryRaw<Array<{id:string;expiresAt:Date;revokedAt:Date|null}>>(Prisma.sql`SELECT id,"expiresAt","revokedAt" FROM "ExecutiveReportView" WHERE "organizationId"=${organizationId} AND "sourceKey"=${sourceKey} AND "tokenHash"=${tokenHash}`);
 if(!row||row.revokedAt||row.expiresAt<=now)throw new Error("Este link não está mais disponível. Gere outro relatório.");
 return {id:row.id,url:"https://app.hubsuporte.shop"+executivePublicPath(token),expiresAt:row.expiresAt.toISOString()};
}
export async function readExecutiveReport(token:string,now=new Date()){
 if(!validExecutiveToken(token))return null;
 const hash=createHash("sha256").update(token).digest("hex");
 const [row]=await prisma.$queryRaw<Array<{snapshot:unknown}>>(Prisma.sql`SELECT snapshot FROM "ExecutiveReportView" WHERE "tokenHash"=${hash} AND "revokedAt" IS NULL AND "expiresAt">${now} LIMIT 1`);
 const parsed=row?executiveReportSchema.safeParse(row.snapshot):null;return parsed?.success?parsed.data:null;
}
export async function revokeExecutiveReport(organizationId:string,id:string){return prisma.$executeRaw(Prisma.sql`UPDATE "ExecutiveReportView" SET "revokedAt"=CURRENT_TIMESTAMP WHERE id=${id} AND "organizationId"=${organizationId}`);}
