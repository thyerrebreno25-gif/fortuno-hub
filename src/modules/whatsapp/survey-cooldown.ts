import type {Prisma} from "@/generated/prisma/client";
import {ANSWERED_SURVEY_COOLDOWN_DAYS} from "./survey-core";

/** Search all invitations: a newer unanswered invitation must not hide a recent answer. */
export function surveyCooldownWhere(cadenceDays:number,now:Date):Prisma.WhatsAppSurveyWhereInput{
 const sentCutoff=new Date(now.getTime()-cadenceDays*86400000);
 const answeredCutoff=new Date(now.getTime()-ANSWERED_SURVEY_COOLDOWN_DAYS*86400000);
 return {OR:[
  {status:{in:["PENDING","SENDING"]}},
  {status:{in:["SENT","ANSWERED","DECLINED","UNKNOWN","EXPIRED"]},OR:[{sentAt:{gt:sentCutoff}},{sentAt:null,createdAt:{gt:sentCutoff}}]},
  {status:"ANSWERED",OR:[{answeredAt:{gt:answeredCutoff}},{answeredAt:null,OR:[{sentAt:{gt:answeredCutoff}},{sentAt:null,createdAt:{gt:answeredCutoff}}]}]},
 ]};
}
