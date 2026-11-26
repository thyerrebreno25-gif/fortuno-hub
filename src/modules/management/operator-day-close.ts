type DayEvent={type:string;message:string;metadata:unknown;createdAt:Date};
type DayActivity={responsibleId:string|null;status:string;completedAt:Date|null;deletedAt:Date|null;updatedAt:Date;events:DayEvent[]};
/** Replays recorded states and ownership; it never treats a completion today as yesterday's delivery. */
export function activityAtDayClose(activity:DayActivity,end:Date){
 const recorded=[...activity.events];if(activity.completedAt)recorded.unshift({type:"COMPLETED",message:"",metadata:null,createdAt:activity.completedAt});
 const events=recorded.sort((a,b)=>+b.createdAt-+a.createdAt),before=events.filter(event=>event.createdAt<end);
 const assignment=before.find(event=>event.type==="ASSIGNED"&&(event.metadata as {toResponsibleId?:unknown})?.toResponsibleId!==undefined);
 const future=[...events].reverse().find(event=>event.createdAt>=end&&event.type==="ASSIGNED"&&(event.metadata as {fromResponsibleId?:unknown})?.fromResponsibleId!==undefined);
 const responsibleId=assignment?(assignment.metadata as {toResponsibleId:string|null}).toResponsibleId:future?(future.metadata as {fromResponsibleId:string|null}).fromResponsibleId:activity.responsibleId;
 if(activity.deletedAt&&activity.deletedAt<end)return {responsibleId,status:"REMOVED"};
 const states:Record<string,string>={CREATED:"OPEN",STARTED:"IN_PROGRESS",RESUMED:"IN_PROGRESS",PAUSED:"PAUSED",BLOCKED:"BLOCKED",DISREGARDED:"DISREGARDED",COMPLETED:"COMPLETED",ACTIVITY_DELETED:"REMOVED"};
 for(const event of before){if(states[event.type])return {responsibleId,status:states[event.type]};if(event.type==="STATUS_CHANGED"){const match=event.message.match(/status para (OPEN|BLOCKED|IN_PROGRESS|PAUSED|COMPLETED|DISREGARDED)\b/);if(match)return {responsibleId,status:match[1]};}}
 if(activity.updatedAt<end)return {responsibleId,status:activity.status};
 if(activity.completedAt&&activity.completedAt<end)return {responsibleId,status:"COMPLETED"};
 return {responsibleId,status:"UNKNOWN"};
}
