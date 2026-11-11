"use client";
import { useEffect } from "react";
import { sessionDay } from "@/modules/session/daily-policy";

// Inactivity no longer ends a session. Server-validated daily access still expires at the Brazil day boundary.
export function SessionTimeout() {
  useEffect(() => {
    const controller = new AbortController(); let checkedDay: string | null = null, running = false, lastCheck = 0, leaving = false;
    async function check(force = false) {
      if(running || leaving || (!force && checkedDay === sessionDay())) return;
      if(force && Date.now()-lastCheck < 60000) return;
      running = true; lastCheck = Date.now();
      try {
        const response = await fetch("/api/auth/mfa/daily",{cache:"no-store",signal:controller.signal});
        if(response.status === 401 || response.status === 403) { leaving = true; window.location.replace("/auth/signout?reason=day"); return; }
        if(response.ok) { const body = await response.json(); checkedDay = body.day; }
      } catch { /* A transient network error must not sign the operator out. The proxy still enforces daily access. */ }
      finally { running = false; }
    }
    void check();
    const timer = window.setInterval(()=>void check(),60000);
    const visible = () => { if(document.visibilityState === "visible") void check(true); };
    document.addEventListener("visibilitychange",visible); window.addEventListener("focus",visible);
    return () => { controller.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",visible);window.removeEventListener("focus",visible); };
  },[]);
  return null;
}
