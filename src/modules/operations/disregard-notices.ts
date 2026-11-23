import "server-only";
import {prisma} from "@/lib/prisma";
import {disregardReview} from "./disregard-policy";
export async function attachDisregardNotices<T extends {id:string}>(notices:T[],organizationId:string){
 const ids=notices.filter(notice=>notice.id.startsWith("operation-disregard:")).map(notice=>notice.id);
 if(!ids.length)return notices;
 const activities=await prisma.operationActivity.findMany({where:{organizationId,OR:ids.map(id=>({disregardReview:{path:["noticeId"],equals:id}}))},select:{id:true,deletedAt:true,disregardReview:true}});
 const reviews=new Map(activities.flatMap(activity=>{const review=disregardReview(activity.disregardReview);return review?[[review.noticeId,{activityId:activity.id,requestId:review.requestId,status:activity.deletedAt?"CANCELLED":review.status}] as const]:[];}));
 return notices.map(notice=>({...notice,operationApproval:reviews.get(notice.id)}));
}
