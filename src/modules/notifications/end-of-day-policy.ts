import { brazilDay, shiftDay } from "@/modules/operations/analytics";

export function endOfDayWindow(now = new Date()) {
  const day = brazilDay(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", {timeZone:"America/Sao_Paulo",hour:"2-digit",hourCycle:"h23"}).format(now));
  const weekday = new Date(day + "T12:00:00Z").getUTCDay();
  const tomorrow = shiftDay(day,1);
  return {day,tomorrow,due:weekday >= 1 && weekday <= 5 && hour >= 18,
    start:new Date(day+"T00:00:00-03:00"),end:new Date(tomorrow+"T00:00:00-03:00"),
    tomorrowEnd:new Date(shiftDay(day,2)+"T00:00:00-03:00")};
}
export type EndOfDaySummary = {
  day:string; tomorrow:string; eligible:boolean; acknowledged:boolean; viewerKey:string;
  calls:number|null; email:number|null; tasks:number|null; overdue:number|null; unread:number|null;
  agenda:Array<{id:string;title:string;startsAt:string;endsAt:string;href:string}>;
  agendaTotal:number; calendarAvailable:boolean;
};
