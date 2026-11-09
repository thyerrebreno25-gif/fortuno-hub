import "server-only";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
export async function storeOwnReaction(messageId:string,emoji:string,name:string){
  await prisma.$executeRaw(Prisma.sql`UPDATE "ServiceMessage" SET "providerMetadata"=jsonb_set(COALESCE("providerMetadata",'{}'::jsonb),'{hubReaction}',${JSON.stringify({emoji,name})}::jsonb,true) WHERE id=${messageId}`);
}
