import type {Prisma} from "@/generated/prisma/client";
import {analyticsPeriod,brazilDay,shiftDay} from "./analytics";
/** Scheduled dates are calendar dates stored in UTC; deadlines are instants in Brasília. */
export function resetPreservation(organizationId:string,now=new Date()){
 const day=brazilDay(now),period=analyticsPeriod(day,day),start=new Date(day+"T00:00:00Z"),end=new Date(shiftDay(day,1)+"T00:00:00Z");
 const base={organizationId,deletedAt:null};
 const protectedWhere:Prisma.OperationActivityWhereInput={...base,OR:[
  {scheduledDate:{gte:start,lt:end}}, {dueAt:{gte:period.start,lt:period.end}},
  {scheduledDate:null,dueAt:null,createdAt:{gte:period.start,lt:period.end}},
  {timeEntries:{some:{endedAt:null}}},
 ]};
 // Explicit nullable complements avoid SQL UNKNOWN silently keeping undated records.
 const removableWhere:Prisma.OperationActivityWhereInput={...base,AND:[
  {OR:[{scheduledDate:null},{scheduledDate:{lt:start}},{scheduledDate:{gte:end}}]},
  {OR:[{dueAt:null},{dueAt:{lt:period.start}},{dueAt:{gte:period.end}}]},
  {OR:[{scheduledDate:{not:null}},{dueAt:{not:null}},{createdAt:{lt:period.start}},{createdAt:{gte:period.end}}]},
  {timeEntries:{none:{endedAt:null}}},
 ]};
 return {day,protectedWhere,removableWhere};
}
