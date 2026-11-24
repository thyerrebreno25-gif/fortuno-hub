import {afterEach,expect,it} from "vitest";
import {createNotificationsStore,notifications} from "@mantine/notifications";
import {enforceNotificationGate,notificationsAllowed,setNotificationsAllowed} from "./notification-gate";
afterEach(()=>setNotificationsAllowed(false));
it("discards all module toasts and queued alerts while muted, without replay after enabling",()=>{
 const store=createNotificationsStore();setNotificationsAllowed(false);const unsubscribe=enforceNotificationGate(store,()=>notifications.clean(store));
 for(const origin of ["whatsapp","daily","operations","support","imports","notices"])notifications.show({id:origin,message:origin,autoClose:false},store);
 expect(store.getState().notifications).toEqual([]);expect(store.getState().queue).toEqual([]);
 setNotificationsAllowed(true);expect(store.getState().notifications).toEqual([]);notifications.show({id:"new",message:"New alert"},store);expect(store.getState().notifications.map(item=>item.id)).toEqual(["new"]);
 setNotificationsAllowed(false);notifications.show({id:"silenced",message:"Muted"},store);expect(store.getState().notifications).toEqual([]);unsubscribe();
});
it("exposes a single guard for every notification sound and automatic reminder",()=>{setNotificationsAllowed(false);expect(notificationsAllowed()).toBe(false);setNotificationsAllowed(true);expect(notificationsAllowed()).toBe(true);});
