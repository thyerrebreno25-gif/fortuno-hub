import {z} from "zod";
const id=z.string().max(180),search=z.string().max(200);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(`${value}T12:00:00Z`);return !Number.isNaN(+date)&&date.toISOString().slice(0,10)===value;});
const custom=z.object({mode:z.literal("custom"),from:day,to:day}).refine(value=>value.from<=value.to);
const activityPeriod=z.union([z.object({mode:z.enum(["today","tomorrow","next7"])}),custom]);
const analyticsPeriod=z.union([z.object({mode:z.enum(["today","week","month","previous","30days"])}),custom]);
export const activityFilterFields=z.object({responsibleId:id,clientId:id,processId:id,status:z.enum(["","OPEN","IN_PROGRESS","PAUSED","BLOCKED","COMPLETED","DISREGARDED"]),team:id,priority:z.enum(["","LOW","MEDIUM","HIGH","CRITICAL"]),cluster:z.enum(["","A","B","C"]),search});
const analyticsFields=z.object({clientId:id,operatorId:id,processId:id,team:id,cluster:z.enum(["","A","B","C"])});
const activitySchema=z.object({version:z.literal(1),kind:z.literal("activities"),period:activityPeriod,mine:z.boolean(),pendingPrevious:z.boolean(),filters:activityFilterFields});
const analyticsSchema=z.object({version:z.literal(1),kind:z.literal("analytics"),period:analyticsPeriod,filters:analyticsFields});
export type ActivityFilters=z.infer<typeof activityFilterFields>;
export type ActivityPinnedFilters=z.infer<typeof activitySchema>;
export type AnalyticsPinnedFilters=z.infer<typeof analyticsSchema>;
export function pinnedFilterKey(scope:string,kind:"activities"|"analytics"){return `fortuno:operations:pinned:${scope}:${kind}:v1`;}
function decode<T>(value:string,schema:z.ZodType<T>){try{const result=schema.safeParse(JSON.parse(value));return result.success?result.data:null;}catch{return null;}}
export const decodeActivityPinnedFilters=(value:string)=>decode(value,activitySchema);
export const decodeAnalyticsPinnedFilters=(value:string)=>decode(value,analyticsSchema);
export function shiftFilterDay(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
export function captureActivityFilters(value:{from:string;to:string;mine:boolean;pendingPrevious:boolean;filters:ActivityFilters},today:string):ActivityPinnedFilters{
 const mode=value.from===today&&value.to===today?"today":value.from===shiftFilterDay(today,1)&&value.to===value.from?"tomorrow":value.from===today&&value.to===shiftFilterDay(today,6)?"next7":"custom";
 return {version:1,kind:"activities",period:mode==="custom"?{mode,from:value.from,to:value.to}:{mode},mine:value.mine,pendingPrevious:value.pendingPrevious,filters:value.filters};
}
export function restoreActivityFilters(value:ActivityPinnedFilters,today:string){
 const period=value.period,from=period.mode==="custom"?period.from:period.mode==="tomorrow"?shiftFilterDay(today,1):today,to=period.mode==="custom"?period.to:period.mode==="next7"?shiftFilterDay(today,6):from;
 return {from,to,mine:value.mine,pendingPrevious:value.pendingPrevious,filters:value.filters};
}
export function captureAnalyticsFilters(value:{from:string;to:string;preset:string;filters:AnalyticsPinnedFilters["filters"]}):AnalyticsPinnedFilters{
 const mode=value.preset as AnalyticsPinnedFilters["period"]["mode"];
 return {version:1,kind:"analytics",period:mode==="custom"?{mode,from:value.from,to:value.to}:{mode},filters:value.filters};
}
export function restoreAnalyticsFilters(value:AnalyticsPinnedFilters,today:string){
 const period=value.period,mode=period.mode,previous=shiftFilterDay(`${today.slice(0,7)}-01`,-1);
 const from=mode==="custom"?period.from:mode==="today"?today:mode==="week"?shiftFilterDay(today,-6):mode==="30days"?shiftFilterDay(today,-29):`${(mode==="previous"?previous:today).slice(0,7)}-01`;
 return {from,to:mode==="custom"?period.to:mode==="previous"?previous:today,preset:mode,filters:value.filters};
}
