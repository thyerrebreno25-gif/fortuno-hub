export type DisregardReview={requestId:string;status:"PENDING"|"APPROVED"|"REJECTED";reason:string;requestedById:string;requestedAt:string;noticeId:string;decidedById?:string;decidedAt?:string};
export function disregardReview(value:unknown):DisregardReview|null{if(!value||typeof value!=="object")return null;const row=value as Record<string,unknown>;return typeof row.requestId==="string"&&typeof row.status==="string"&&["PENDING","APPROVED","REJECTED"].includes(row.status)?row as DisregardReview:null;}
export const pendingDisregard=(value:unknown)=>disregardReview(value)?.status==="PENDING";
