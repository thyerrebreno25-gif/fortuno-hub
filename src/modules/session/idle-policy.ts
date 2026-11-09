export const INACTIVITY_LIMIT_MS=30*60*1000;
export const WARNING_BEFORE_MS=2*60*1000;
const WARNING_AT_MS=INACTIVITY_LIMIT_MS-WARNING_BEFORE_MS;
type IdleContext={now:number;lastActivity:number;pathname:string;visibilityState:string;tvMode:boolean;keepAliveCount:number};
export function visibleWorkspaceKeepsSession(pathname:string,visibilityState:string,tvMode:boolean){
  return visibilityState==="visible"&&(pathname==="/whatsapp"||pathname==="/painel-gerencial"&&tvMode);
}
export function idleSessionDecision(context:IdleContext){
  if(context.keepAliveCount>0||visibleWorkspaceKeepsSession(context.pathname,context.visibilityState,context.tvMode))return {action:"KEEP_ALIVE" as const,remainingSeconds:WARNING_BEFORE_MS/1000};
  const idleFor=context.now-context.lastActivity;
  if(idleFor>=INACTIVITY_LIMIT_MS)return {action:"EXPIRE" as const,remainingSeconds:0};
  if(idleFor>=WARNING_AT_MS)return {action:"WARN" as const,remainingSeconds:Math.max(0,Math.ceil((INACTIVITY_LIMIT_MS-idleFor)/1000))};
  return {action:"ACTIVE" as const,remainingSeconds:WARNING_BEFORE_MS/1000};
}
