import type { onboardingSummary } from "./onboarding";
export type ExecutivePeriod = "today" | "week" | "month";
export type ExecutiveData = {
 generatedAt:string; period:{key:ExecutivePeriod;label:string;from:string;to:string};
 available:{onboarding:boolean;clients:boolean;whatsapp:boolean;email:boolean;support:boolean;operations:boolean;meetings:boolean;ca:boolean};
 onboarding:ReturnType<typeof onboardingSummary>;
 clients:{active:number;total:number};
 whatsapp:{open:number;unassigned:number;inProgress:number;resolvedPeriod:number;receivedPeriod:number;averageResolutionMinutes:number|null;resolutionSample:number;health:{targetMinutes:number;waiting:number;onTime:number;delayed:number;critical:number;oldestWaitingMinutes:number|null;averageFirstResponseMinutes:number|null;firstResponseSample:number}};
 email:{open:number;unassigned:number;resolvedPeriod:number;spamPeriod:number;receivedPeriod:number};
 support:{open:number;inProgress:number;resolvedPeriod:number;receivedPeriod:number};
 operations:{open:number;overdue:number;completedPeriod:number;scheduledPeriod:number;runningTimers:number};
 meetings:{today:number;upcoming:number;completedPeriod:number;agenda:Array<{id:string;title:string;startsAt:string;endsAt:string;status:string;participants:string[]}>};
 ca:{confirmedLines:number;failedLines:number;pendingLines:number;confirmedBatches:number;breakdown?:Array<{label:string;confirmed:number}>};
 operators:Array<{id:string;name:string;whatsappOpen:number;emailOpen:number;activitiesOpen:number;activitiesOverdue:number;completedPeriod:number;meetingsUpcoming:number}>;
 daily:Array<{date:string;whatsappReceived:number;emailReceived:number;activitiesCompleted:number;caConfirmed:number}>;
 notes:string[];
};
