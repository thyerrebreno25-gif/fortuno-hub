"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
const WARNING_BEFORE_MS = 2 * 60 * 1000;
const WARNING_AT_MS = INACTIVITY_LIMIT_MS - WARNING_BEFORE_MS;
const ACTIVITY_WRITE_THROTTLE_MS = 15 * 1000;
const STORAGE_KEY = "fortuno:last-activity";

export function SessionTimeout() {
  const supabase = createClient();
  const [warningOpen, setWarningOpen] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(
    Math.floor(WARNING_BEFORE_MS / 1000),
  );

  const lastActivityRef = useRef(Date.now());
  const lastWriteRef = useRef(0);
  const signingOutRef = useRef(false);

  const persistActivity = useCallback((timestamp: number) => {
    lastActivityRef.current = timestamp;

    if (
      timestamp - lastWriteRef.current >=
      ACTIVITY_WRITE_THROTTLE_MS
    ) {
      lastWriteRef.current = timestamp;
      localStorage.setItem(STORAGE_KEY, String(timestamp));
    }
  }, []);

  const markActivity = useCallback(() => {
    if (signingOutRef.current) return;

    persistActivity(Date.now());

    if (warningOpen) {
      setWarningOpen(false);
    }
  }, [persistActivity, warningOpen]);

  const signOut = useCallback(async () => {
    if (signingOutRef.current) return;

    signingOutRef.current = true;
    localStorage.removeItem(STORAGE_KEY);

    try {
      await supabase.auth.signOut();
    } finally {
      window.location.href = "/login";
    }
  }, [supabase]);

  const continueSession = useCallback(() => {
    const now = Date.now();
    persistActivity(now);
    setWarningOpen(false);
    setRemainingSeconds(
      Math.floor(WARNING_BEFORE_MS / 1000),
    );
  }, [persistActivity]);

  useEffect(() => {
    const stored = Number(
      localStorage.getItem(STORAGE_KEY),
    );

    const initial =
      Number.isFinite(stored) && stored > 0
        ? stored
        : Date.now();

    lastActivityRef.current = initial;
    lastWriteRef.current = initial;
    localStorage.setItem(STORAGE_KEY, String(initial));

    const activityEvents = [
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ] as const;

    const onActivity = () => markActivity();

    activityEvents.forEach((eventName) => {
      window.addEventListener(
        eventName,
        onActivity,
        { passive: true },
      );
    });

    const onStorage = (event: StorageEvent) => {
      if (
        event.key === STORAGE_KEY &&
        event.newValue
      ) {
        const timestamp = Number(event.newValue);

        if (
          Number.isFinite(timestamp) &&
          timestamp > lastActivityRef.current
        ) {
          lastActivityRef.current = timestamp;
          setWarningOpen(false);
        }
      }
    };

    window.addEventListener("storage", onStorage);

    const interval = window.setInterval(() => {
      const now = Date.now();
      const idleFor =
        now - lastActivityRef.current;

      if (idleFor >= INACTIVITY_LIMIT_MS) {
        void signOut();
        return;
      }

      if (idleFor >= WARNING_AT_MS) {
        const seconds = Math.max(
          0,
          Math.ceil(
            (INACTIVITY_LIMIT_MS - idleFor) / 1000,
          ),
        );

        setRemainingSeconds(seconds);
        setWarningOpen(true);
      }
    }, 1000);

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(
          eventName,
          onActivity,
        );
      });

      window.removeEventListener(
        "storage",
        onStorage,
      );

      window.clearInterval(interval);
    };
  }, [markActivity, signOut]);

  if (!warningOpen) return null;

  const minutes = Math.floor(
    remainingSeconds / 60,
  );
  const seconds = remainingSeconds % 60;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-warning-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "rgba(15, 23, 42, 0.48)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        style={{
          width: "min(460px, 100%)",
          borderRadius: 20,
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          boxShadow:
            "0 24px 70px rgba(15, 23, 42, 0.22)",
          padding: 24,
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            display: "grid",
            placeItems: "center",
            borderRadius: 14,
            background: "#fff7ed",
            color: "#c2410c",
            fontSize: 22,
            marginBottom: 16,
          }}
        >
          ⏱
        </div>

        <h2
          id="session-warning-title"
          style={{
            margin: 0,
            color: "#0f172a",
            fontSize: 22,
          }}
        >
          Sua sessão está prestes a expirar
        </h2>

        <p
          style={{
            margin: "10px 0 0",
            color: "#64748b",
            lineHeight: 1.55,
          }}
        >
          Por segurança, o Fortuno Hub encerra
          sessões após 30 minutos sem atividade.
        </p>

        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 14,
            background: "#f8fafc",
            textAlign: "center",
            color: "#0f172a",
            fontWeight: 800,
            fontSize: 24,
          }}
        >
          {String(minutes).padStart(2, "0")}:
          {String(seconds).padStart(2, "0")}
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 20,
          }}
        >
          <button
            type="button"
            onClick={() => void signOut()}
            style={{
              border: "1px solid #dbe3ec",
              background: "#ffffff",
              color: "#334155",
              borderRadius: 10,
              padding: "10px 16px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Sair agora
          </button>

          <button
            type="button"
            onClick={continueSession}
            style={{
              border: 0,
              background: "#2563eb",
              color: "#ffffff",
              borderRadius: 10,
              padding: "10px 16px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Continuar conectado
          </button>
        </div>
      </div>
    </div>
  );
}
