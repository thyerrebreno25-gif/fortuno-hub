"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { usageDay, usagePage, USAGE_CLIENT_EVENT } from "./catalog";
import { currentUsageClient } from "./client-context";
import { engagementSeconds } from "./engagement";

export function UsageTracker({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  useEffect(() => {
    const page = usagePage(pathname);
    if (!enabled || !page) return;
    let clientId = page.key === "clients" ? pathname.split("/")[2] || null : currentUsageClient(pathname);
    let id = crypto.randomUUID(), seconds = 0, sentSeconds = -1, lastInput = Date.now(), lastTick = Date.now(), lastFlush = 0, day = usageDay();
    let stopped = false;
    function flush() {
      if (sentSeconds === Math.floor(seconds)) return;
      const body = JSON.stringify({ id, pageKey: page!.key, clientId, activeSeconds: Math.floor(seconds) });
      sentSeconds = Math.floor(seconds); lastFlush = Date.now();
      // Cumulative values + a stable ID make a retried/unload request idempotent.
      void fetch("/api/usage/session", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).then(r => { if (!r.ok) sentSeconds = -1; }).catch(() => { sentSeconds = -1; });
    }
    function rotate(nextClient = clientId) { flush(); id = crypto.randomUUID(); seconds = 0; sentSeconds = -1; clientId = nextClient; lastFlush = 0; }
    function tick() {
      const now = Date.now();
      if (usageDay() !== day) { rotate(); day = usageDay(); }
      seconds += engagementSeconds(now - lastTick, now - lastInput, document.visibilityState === "visible", document.hasFocus()); lastTick = now;
      if (document.visibilityState === "visible" && document.hasFocus() && (now - lastFlush >= 60_000 || lastFlush === 0)) flush();
    }
    const input = () => { lastInput = Date.now(); };
    const visibility = () => { tick(); if (document.visibilityState !== "visible") flush(); };
    const context = (event: Event) => { const next = (event as CustomEvent<{clientId?: string}>).detail?.clientId || null; if (clientId !== next) { tick(); rotate(next); } };
    const exit = () => { if (!stopped) { tick(); flush(); } };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach(e => window.addEventListener(e, input, { passive: true }));
    window.addEventListener(USAGE_CLIENT_EVENT, context);
    window.addEventListener("pagehide", exit); window.addEventListener("blur", exit);
    document.addEventListener("visibilitychange", visibility);
    tick(); const timer = window.setInterval(tick, 15_000);
    return () => { exit(); stopped = true; window.clearInterval(timer); events.forEach(e => window.removeEventListener(e, input)); window.removeEventListener(USAGE_CLIENT_EVENT, context); window.removeEventListener("pagehide", exit); window.removeEventListener("blur", exit); document.removeEventListener("visibilitychange", visibility); };
  }, [pathname, enabled]);
  return null;
}
