// Start closed until the signed-in user's preference has been loaded.
let allowed=false;
export function notificationsAllowed(){return allowed;}
export function setNotificationsAllowed(value:boolean){allowed=value;}
export function enforceNotificationGate(store:{getState:()=>{notifications:unknown[];queue:unknown[]};subscribe:(callback:()=>void)=>()=>void},clear:()=>void){
  const clean=()=>{const state=store.getState();if(!allowed&&(state.notifications.length||state.queue.length))clear();};
  const unsubscribe=store.subscribe(clean);clean();return unsubscribe;
}
