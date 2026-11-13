"use client";
export const OPERATION_TIMER_CHANGED="fortuno:operation-timer-changed";
export const OPERATION_TIMER_STORAGE="fortuno-operation-timer-update";
export function announceOperationTimerChange(origin="page"){
 window.dispatchEvent(new CustomEvent(OPERATION_TIMER_CHANGED,{detail:{origin}}));
 try{localStorage.setItem(OPERATION_TIMER_STORAGE,String(Date.now())+":"+Math.random());}catch{}
}
export type OperationTimerSnapshot={activityId:string;title:string;clientName:string;status:string;running:boolean;startedAt:string|null;seconds:number;canPause:boolean;canResume:boolean;canComplete:boolean};
export function operationTimerSeconds(timer:OperationTimerSnapshot,now:number){return Math.max(0,timer.seconds+(timer.running&&timer.startedAt?Math.max(0,Math.floor((now-Date.parse(timer.startedAt))/1000)):0));}
export const timerDuration=(seconds:number)=>`${String(Math.floor(seconds/3600)).padStart(2,"0")}:${String(Math.floor(seconds%3600/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
