function brazilDay(date:Date){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);}
export function notificationAfterReset(item:{createdAt:string;reminderDay?:string;originAt?:string},clearedAt:Date){
  if(new Date(item.createdAt)<=clearedAt)return false;
  // Reminders are computed on each request. Clear today's existing occurrence,
  // while allowing changed records and tomorrow's new reminder to appear.
  return !(item.reminderDay===brazilDay(clearedAt)&&item.originAt&&new Date(item.originAt)<=clearedAt);
}
