import { expect,it } from "vitest";
import { mergeBusy } from "./availability";
it("merges duplicated Hub/Google intervals and clips the visible period",()=>{
  const from=new Date("2026-11-13T09:00Z"),to=new Date("2026-11-13T18:00Z");
  expect(mergeBusy([{startsAt:"2026-11-13T08:00Z",endsAt:"2026-11-13T10:00Z"},{startsAt:"2026-11-13T09:00Z",endsAt:"2026-11-13T11:00Z"},{startsAt:"2026-11-13T17:00Z",endsAt:"2026-11-13T19:00Z"}],from,to)).toEqual([{startsAt:"2026-11-13T09:00:00.000Z",endsAt:"2026-11-13T11:00:00.000Z"},{startsAt:"2026-11-13T17:00:00.000Z",endsAt:"2026-11-13T18:00:00.000Z"}]);
});
