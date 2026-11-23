"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@mantine/core";
import {EndOfDayContent} from "./end-of-day-content";
import { endOfDayWindow, type EndOfDaySummary } from "./end-of-day-policy";

export function EndOfDayReminder({enabled}:{enabled:boolean}) {
  const [data,setData] = useState<EndOfDaySummary|null>(null),[opened,setOpened] = useState(false),[busy,setBusy] = useState(false),[error,setError] = useState("");
  const seen = useRef("");
  useEffect(()=>{
    if (!enabled || new URLSearchParams(window.location.search).get("tv") === "1") return;
    let active=true,fetching=false;
    const check=async()=>{
      if(document.hidden||fetching)return;
      const w=endOfDayWindow();
      if(!w.due){if(active){setOpened(false);setData(null);}seen.current="";return;}
      if(seen.current===w.day)return;
      fetching=true;
      try{
        const response=await fetch("/api/notifications/end-of-day",{cache:"no-store"});
        if(!response.ok)return;
        const body=await response.json() as EndOfDaySummary;
        if(!active)return;
        if(body.acknowledged){seen.current=w.day;return;}
        if(body.eligible){setData(body);setOpened(true);seen.current=w.day;}
      }catch{}finally{fetching=false;}
    };
    void check();const timer=window.setInterval(()=>void check(),30000);
    const visible=()=>{if(!document.hidden)void check();};document.addEventListener("visibilitychange",visible);
    // Shared TV windows keep their unattended presentation running.
    return()=>{active=false;clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[enabled]);
  useEffect(()=>{
    if(!data)return;
    const changed=(event:StorageEvent)=>{if(event.key===`fortuno:eod:${data.viewerKey}:${data.day}`)setOpened(false);};
    window.addEventListener("storage",changed);return()=>window.removeEventListener("storage",changed);
  },[data]);
  async function close(href?:string){
    if(busy)return;setBusy(true);setError("");
    try{const r=await fetch("/api/notifications/end-of-day",{method:"POST"});if(!r.ok)throw new Error();setOpened(false);if(data){try{localStorage.setItem(`fortuno:eod:${data.viewerKey}:${data.day}`,"read");}catch{}}if(href)window.location.assign(href);}
    catch{setError("Não foi possível registrar a leitura. Tente novamente.");}finally{setBusy(false);}
  }
  return <Modal fullScreen opened={opened&&enabled} onClose={()=>void close()} withCloseButton={false} closeOnEscape={false} closeOnClickOutside={false} zIndex={11000} styles={{header:{display:"none"},body:{padding:0}}}>{data&&<EndOfDayContent data={data} busy={busy} error={error} onContinue={href=>void close(href)}/>}</Modal>;
}
