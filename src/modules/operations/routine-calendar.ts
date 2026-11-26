import {nextOperationBusinessDay,operationOccurrenceDay} from "./business-days";

type CalendarData={interval?:unknown};
/** The policy follows the cadence, including routines saved before this rule. */
export function nextBusinessRoutine(type:string,data?:CalendarData|null){
 return type==="MONTHLY"||type==="DAILY"&&Number(data?.interval)===15||type==="WEEKLY"&&Number(data?.interval)===2;
}
export function routineHolidayBehavior(type:string,data?:CalendarData|null){
 return nextBusinessRoutine(type,data)?"NEXT_BUSINESS_DAY" as const:"PREVIOUS_BUSINESS_DAY" as const;
}
export function routineOccurrenceDay(type:string,data:CalendarData|null|undefined,day:string,holidays:Set<string>){
 return nextBusinessRoutine(type,data)?nextOperationBusinessDay(day,holidays):operationOccurrenceDay(day,holidays);
}
export function routineCalendarDescription(type:string,data?:CalendarData|null){
 return nextBusinessRoutine(type,data)
  ?"Ocorrências em sábado, domingo ou feriado passam para o próximo dia útil. A referência das próximas ocorrências é mantida."
  :"Sábados e domingos não geram atividades nem antecipações. Apenas feriados em dias de semana são antecipados para o dia útil anterior.";
}
