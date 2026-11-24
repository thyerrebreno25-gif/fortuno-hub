import { brazilDay, shiftDay } from "@/modules/operations/analytics";

export const END_OF_DAY_TIME = "17:30";
const [startHour, startMinute] = END_OF_DAY_TIME.split(":").map(Number);

export function endOfDayWindow(now = new Date()) {
  const day = brazilDay(now);
  const [hour, minute] = new Intl.DateTimeFormat("en-GB", {timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(now).split(":").map(Number);
  const weekday = new Date(day + "T12:00:00Z").getUTCDay();
  const tomorrow = shiftDay(day,1);
  return {day,tomorrow,due:weekday >= 1 && weekday <= 5 && hour * 60 + minute >= startHour * 60 + startMinute,
    start:new Date(day+"T00:00:00-03:00"),end:new Date(tomorrow+"T00:00:00-03:00"),
    tomorrowEnd:new Date(shiftDay(day,2)+"T00:00:00-03:00")};
}
export type EndOfDaySummary = {
  day:string; tomorrow:string; eligible:boolean; acknowledged:boolean; viewerKey:string;
  calls:number|null; email:number|null; tasks:number|null; overdue:number|null; unread:number|null;
  agenda:Array<{id:string;title:string;startsAt:string;endsAt:string;href:string}>;
  agendaTotal:number; calendarAvailable:boolean;
};
