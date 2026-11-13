import { expect, it } from "vitest";
import { meetingListFilter } from "./list-filters";
const now=new Date("2026-11-13T18:00:00Z");
const filter=(query:string)=>meetingListFilter(new URLSearchParams(query),"me",false,now);
it("defaults to my scheduled upcoming meetings in ascending order",()=>{
  expect(filter("")).toEqual({personal:{OR:[{createdById:"me"},{responsibleId:"me"},{participants:{some:{userId:"me"}}}]},dates:{endsAt:{gte:now},status:"SCHEDULED"},direction:"asc"});
  expect(filter("scope=all").personal).toEqual({});expect(filter("scope=responsible").personal).toEqual({responsibleId:"me"});
});
it("calculates today, Monday-based week and next month in Brasilia",()=>{
  expect(filter("period=today").dates).toEqual({startsAt:{gte:new Date("2026-11-13T03:00Z"),lt:new Date("2026-11-14T03:00Z")}});
  expect(filter("period=week").dates).toEqual({startsAt:{gte:new Date("2026-11-09T03:00Z"),lt:new Date("2026-11-16T03:00Z")}});
  expect(filter("period=nextMonth").dates).toEqual({startsAt:{gte:new Date("2026-12-01T03:00Z"),lt:new Date("2027-01-01T03:00Z")}});
});
it("uses inclusive custom end dates and rejects impossible dates",()=>{
  expect(filter("period=custom&from=2026-11-01&to=2026-11-30").dates).toEqual({startsAt:{gte:new Date("2026-11-01T03:00Z"),lt:new Date("2026-12-01T03:00Z")}});
  for(const query of ["period=custom","period=custom&from=2026-02-30&to=2026-03-01","period=custom&from=2026-11-20&to=2026-11-10","period=bad"])expect(()=>filter(query)).toThrow();
});
it("shows past meetings newest first and does not hide deleted meetings by future dates",()=>{
  expect(filter("period=past")).toMatchObject({dates:{endsAt:{lt:now}},direction:"desc"});
  expect(meetingListFilter(new URLSearchParams(),"me",true,now)).toMatchObject({dates:{},direction:"desc"});
});
