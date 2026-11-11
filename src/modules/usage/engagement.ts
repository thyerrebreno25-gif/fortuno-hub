export const USAGE_IDLE_MS = 90_000;
export function engagementSeconds(elapsedMs: number, idleMs: number, visible: boolean, focused: boolean) {
  if (!visible || !focused || idleMs >= USAGE_IDLE_MS) return 0;
  // A suspended browser must not turn a long gap into time worked.
  return Math.max(0, Math.min(15, elapsedMs / 1000, (USAGE_IDLE_MS - idleMs) / 1000));
}
