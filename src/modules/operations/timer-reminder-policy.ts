export const TIMER_REVIEW_MS=45*60*1000;
export function timerReviewDue(running:boolean,startedAt:string|null,now:number,acknowledgedUntil=0){const start=Date.parse(startedAt||"");return running&&Number.isFinite(start)&&now-start>=TIMER_REVIEW_MS&&now>=acknowledgedUntil;}
