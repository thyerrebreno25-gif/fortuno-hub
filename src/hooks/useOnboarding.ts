"use client";

import { useCallback, useEffect, useState } from "react";
import type { OnboardingTemplate } from "@/components/onboarding/TemplateManager";

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Erro inesperado.");
  return body;
}

export function useOnboarding() {
  const [onboardings, setOnboardings] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [onboardingData, dashboardData, templateData] = await Promise.all([
        api<{ onboardings: any[] }>("/api/onboarding"),
        api<any>("/api/onboarding/dashboard"),
        api<{ templates: OnboardingTemplate[] }>("/api/onboarding/templates"),
      ]);
      setOnboardings(onboardingData.onboardings); setDashboard(dashboardData); setTemplates(templateData.templates);
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao carregar onboarding."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return {
    onboardings, dashboard, templates, loading, error, refresh,
    createOnboarding: async (payload: any) => { await api("/api/onboarding", { method: "POST", body: JSON.stringify(payload) }); await refresh(); },
    updateTask: async (taskId: string, payload: any) => { await api(`/api/onboarding/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(payload) }); await refresh(); },
    addComment: async (taskId: string, content: string) => { await api(`/api/onboarding/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ content }) }); await refresh(); },
    startTimer: async (taskId: string) => { await api(`/api/onboarding/tasks/${taskId}/timer/start`, { method: "POST" }); await refresh(); },
    stopTimer: async (taskId: string) => { await api(`/api/onboarding/tasks/${taskId}/timer/stop`, { method: "POST" }); await refresh(); },
  };
}
