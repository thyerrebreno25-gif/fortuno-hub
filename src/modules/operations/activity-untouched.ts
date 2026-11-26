type Work={status:string;disregardReview?:unknown;timeEntries:unknown[];comments:unknown[];attachments:unknown[];checklistItems:{completed:boolean;disregardedAt:Date|null;comment:string|null}[]};
export function untouchedRoutineActivity(activity:Work){
 return activity.status==="OPEN"&&!activity.disregardReview&&!activity.timeEntries.length&&!activity.comments.length&&!activity.attachments.length&&activity.checklistItems.every(item=>!item.completed&&!item.disregardedAt&&!item.comment);
}
