"use client";
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import {Notifications,notifications,notificationsStore} from "@mantine/notifications";
import {createClient} from "@/lib/supabase/client";
import {enforceNotificationGate,notificationsAllowed,setNotificationsAllowed} from "./notification-gate";

type Preference={userId:string|null;notificationsMuted:boolean};
type ContextValue={ready:boolean;muted:boolean;enabled:boolean;busy:boolean;error:string;changeMuted:(muted:boolean)=>Promise<void>};
const Context=createContext<ContextValue>({ready:false,muted:true,enabled:false,busy:false,error:"",changeMuted:async()=>{}});
const storageKey=(userId:string)=>"fortuno:all-notifications:"+userId;
export function NotificationPreferencesProvider({children}:{children:ReactNode}){
  const [preference,setPreference]=useState<Preference>({userId:null,notificationsMuted:true}),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const generation=useRef(0),changing=useRef(false),viewer=useRef<string|null>(null);
  const invalidate=useCallback(()=>{++generation.current;},[]);
  const apply=useCallback((value:Preference)=>{
    if(value.notificationsMuted||!notificationsAllowed())notifications.clean();
    setNotificationsAllowed(!value.notificationsMuted);viewer.current=value.userId;setPreference(value);setReady(true);
  },[]);
  const refresh=useCallback(async(force=false)=>{
    if(changing.current&&!force)return;
    const sequence=++generation.current;
    try{
      const response=await fetch("/api/notifications/preferences",{cache:"no-store"});
      if(sequence!==generation.current)return;
      if(response.status===401){apply({userId:null,notificationsMuted:false});setError("");return;}
      const body=await response.json();
      if(!response.ok||typeof body.userId!=="string"||typeof body.notificationsMuted!=="boolean")throw new Error();
      if(sequence!==generation.current)return;
      apply(body);setError("");
    }catch{if(sequence===generation.current)setError("Não foi possível carregar sua preferência de notificações.");}
  },[apply]);
  useEffect(()=>{
    const unsubscribe=enforceNotificationGate(notificationsStore,()=>notifications.clean());
    const initial=setTimeout(()=>void refresh(),0),timer=setInterval(()=>{if(!document.hidden)void refresh();},60000);
    const focus=()=>{if(!document.hidden)void refresh();};
    const storage=(event:StorageEvent)=>{
      if(!viewer.current||event.key!==storageKey(viewer.current))return;
      try{const value=JSON.parse(event.newValue||"null");if(typeof value?.notificationsMuted==="boolean"){++generation.current;changing.current=false;setBusy(false);apply({userId:viewer.current,notificationsMuted:value.notificationsMuted});}}catch{}
    };
    window.addEventListener("focus",focus);document.addEventListener("visibilitychange",focus);window.addEventListener("storage",storage);
    const supabase=createClient(),{data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
      if((session?.user?.id||null)!==viewer.current){++generation.current;changing.current=false;setBusy(false);setNotificationsAllowed(false);notifications.clean();setReady(false);viewer.current=session?.user?.id||null;void refresh(true);}
    });
    return()=>{invalidate();clearTimeout(initial);clearInterval(timer);unsubscribe();subscription.unsubscribe();window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",focus);window.removeEventListener("storage",storage);setNotificationsAllowed(false);};
  },[apply,refresh,invalidate]);
  const changeMuted=useCallback(async(muted:boolean)=>{
    if(!ready||!viewer.current||changing.current)return;
    const previous=preference,sequence=++generation.current;changing.current=true;setBusy(true);setError("");apply({...preference,notificationsMuted:muted});
    try{
      const response=await fetch("/api/notifications/preferences",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({notificationsMuted:muted})});
      const body=await response.json();
      if(sequence!==generation.current)return;
      if(!response.ok||body.userId!==previous.userId||body.notificationsMuted!==muted)throw new Error(body.error||"Não foi possível salvar a preferência.");
      apply(body);try{localStorage.setItem(storageKey(body.userId),JSON.stringify({notificationsMuted:muted,at:Date.now()}));}catch{}
    }catch(cause){if(sequence===generation.current){apply(previous);setError(cause instanceof Error?cause.message:"Não foi possível salvar a preferência.");}}
    finally{if(sequence===generation.current){changing.current=false;setBusy(false);}}
  },[apply,preference,ready]);
  return <Context.Provider value={{ready,muted:preference.notificationsMuted,enabled:ready&&!preference.notificationsMuted,busy,error,changeMuted}}>{children}</Context.Provider>;
}
export const useNotificationPreferences=()=>useContext(Context);
export function NotificationToasts(){const {enabled}=useNotificationPreferences();return enabled?<Notifications position="top-right" limit={4}/>:null;}
