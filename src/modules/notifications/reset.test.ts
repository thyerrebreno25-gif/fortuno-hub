import {expect,it} from "vitest";
import {notificationAfterReset} from "./reset";
it("clears old notifications and today's recurring reminder without blocking new work or the next day's reminder",()=>{
  const cutoff=new Date("2026-11-08T23:00:00Z");
  expect(notificationAfterReset({createdAt:"2026-11-08T22:00:00Z"},cutoff)).toBe(false);
  const reminder={createdAt:"2026-11-08T23:10:00Z",originAt:"2026-11-07T12:00:00Z",reminderDay:"2026-11-08"};
  expect(notificationAfterReset(reminder,cutoff)).toBe(false);
  expect(notificationAfterReset({...reminder,originAt:"2026-11-08T23:05:00Z"},cutoff)).toBe(true);
  expect(notificationAfterReset({...reminder,createdAt:"2026-11-09T12:00:00Z",reminderDay:"2026-11-09"},cutoff)).toBe(true);
});
