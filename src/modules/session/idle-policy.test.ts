import {expect,it} from "vitest";
import {idleSessionDecision,visibleWorkspaceKeepsSession} from "./idle-policy";
const minute=60000;
const idle={now:31*minute,lastActivity:0,pathname:"/inicio",visibilityState:"visible",tvMode:false,keepAliveCount:0};
it("keeps a visible WhatsApp central alive after more than thirty minutes without clicks",()=>{
 expect(idleSessionDecision({...idle,pathname:"/whatsapp",now:90*minute}).action).toBe("KEEP_ALIVE");
});
it("does not exempt a hidden WhatsApp tab or other routes from the inactivity timeout",()=>{
 for(const context of [{...idle,pathname:"/whatsapp",visibilityState:"hidden"},idle,{...idle,pathname:"/whatsapp-admin"}])expect(idleSessionDecision(context).action).toBe("EXPIRE");
});
it("starts the usual idle window after leaving the visible WhatsApp central",()=>{
 const pulse=90*minute;
 expect(idleSessionDecision({...idle,pathname:"/whatsapp",now:pulse}).action).toBe("KEEP_ALIVE");
 expect(idleSessionDecision({...idle,lastActivity:pulse,now:pulse+27*minute}).action).toBe("ACTIVE");
 expect(idleSessionDecision({...idle,lastActivity:pulse,now:pulse+29*minute})).toEqual({action:"WARN",remainingSeconds:60});
 expect(idleSessionDecision({...idle,lastActivity:pulse,now:pulse+30*minute}).action).toBe("EXPIRE");
});
it("preserves the visible TV-mode exception without extending it to hidden dashboards",()=>{
 expect(idleSessionDecision({...idle,pathname:"/painel-gerencial",tvMode:true}).action).toBe("KEEP_ALIVE");
 expect(idleSessionDecision({...idle,pathname:"/painel-gerencial",tvMode:false}).action).toBe("EXPIRE");
 expect(idleSessionDecision({...idle,pathname:"/painel-gerencial",tvMode:true,visibilityState:"hidden"}).action).toBe("EXPIRE");
});
it("preserves an existing upload keep-alive until it is released",()=>{
 expect(idleSessionDecision({...idle,visibilityState:"hidden",keepAliveCount:1}).action).toBe("KEEP_ALIVE");
 expect(idleSessionDecision({...idle,visibilityState:"hidden",keepAliveCount:0}).action).toBe("EXPIRE");
});
it("recognizes only the exact WhatsApp route while visible",()=>{
 expect(visibleWorkspaceKeepsSession("/whatsapp","visible",false)).toBe(true);
 expect(visibleWorkspaceKeepsSession("/whatsapp","hidden",false)).toBe(false);
 expect(visibleWorkspaceKeepsSession("/whatsapp-other","visible",false)).toBe(false);
});
