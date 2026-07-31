import type { DashboardData } from "@/modules/dashboard/types/dashboard.types";

interface DashboardErrorResponse {
  error?: string;
}

export async function getDashboardData(signal?: AbortSignal): Promise<DashboardData> {
  const response = await fetch("/api/dashboard", {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    let message = "Não foi possível carregar o Dashboard.";

    try {
      const payload = (await response.json()) as DashboardErrorResponse;
      if (payload.error) message = payload.error;
    } catch {
      // Mantém a mensagem padrão quando a resposta não for JSON.
    }

    throw new Error(message);
  }

  return (await response.json()) as DashboardData;
}
