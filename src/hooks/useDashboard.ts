"use client";

import { useCallback, useEffect, useState } from "react";
import { getDashboardData } from "@/modules/dashboard/services/dashboard.service";
import type { DashboardData } from "@/modules/dashboard/types/dashboard.types";
import type { DashboardPeriodCode } from "@/modules/dashboard/usage-analytics";

export function useDashboard(period: DashboardPeriodCode = "30D") {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const result = await getDashboardData(period, controller.signal);
        setData(result);
      } catch (requestError) {
        if (controller.signal.aborted) return;

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Não foi possível carregar o Dashboard.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();

    return () => controller.abort();
  }, [period, reloadKey]);

  return { data, loading, error, reload };
}
