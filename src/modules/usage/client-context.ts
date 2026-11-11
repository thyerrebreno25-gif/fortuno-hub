"use client";
import { useEffect } from "react";
import { USAGE_CLIENT_EVENT } from "./catalog";

let context: { pathname: string; clientId: string | null } | null = null;
export function currentUsageClient(pathname: string) { return context?.pathname === pathname ? context.clientId : null; }

// Only the selected client ID is measured; never message bodies, documents or search terms.
export function useUsageClient(clientId: string | null | undefined) {
  useEffect(() => {
    context = { pathname: window.location.pathname, clientId: clientId || null };
    window.dispatchEvent(new CustomEvent(USAGE_CLIENT_EVENT, { detail: { clientId: clientId || null } }));
    return () => { context = null; window.dispatchEvent(new CustomEvent(USAGE_CLIENT_EVENT, { detail: { clientId: null } })); };
  }, [clientId]);
}
