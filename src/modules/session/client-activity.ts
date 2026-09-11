export const SESSION_KEEP_ALIVE_EVENT = "fortuno:session-keep-alive";

type KeepAliveDetail = {
  delta: 1 | -1;
};

export function beginSessionKeepAlive() {
  if (typeof window === "undefined") return () => undefined;

  window.dispatchEvent(new CustomEvent<KeepAliveDetail>(SESSION_KEEP_ALIVE_EVENT, {
    detail: { delta: 1 },
  }));

  let released = false;
  return () => {
    if (released) return;
    released = true;
    window.dispatchEvent(new CustomEvent<KeepAliveDetail>(SESSION_KEEP_ALIVE_EVENT, {
      detail: { delta: -1 },
    }));
  };
}
