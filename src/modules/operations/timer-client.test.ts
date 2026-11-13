import {expect,it} from "vitest";
import {operationTimerSeconds,timerDuration} from "./timer-client";
const timer={activityId:"task",title:"Conciliação",clientName:"Cliente",status:"IN_PROGRESS",running:true,startedAt:"2026-11-13T12:00:00Z",seconds:120,canPause:true,canResume:true,canComplete:true};
it("counts from the persisted server timestamp even after navigation or component remount",()=>{expect(operationTimerSeconds(timer,Date.parse("2026-11-13T12:10:00Z"))).toBe(720);expect(timerDuration(720)).toBe("00:12:00");});
it("does not continue counting paused entries or produce negative elapsed time",()=>{expect(operationTimerSeconds({...timer,running:false,startedAt:null},Date.parse("2026-11-13T12:10:00Z"))).toBe(120);expect(operationTimerSeconds(timer,Date.parse("2026-11-13T11:59:00Z"))).toBe(120);});
