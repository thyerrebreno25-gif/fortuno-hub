/** Mailbox endpoints return JSON. Empty proxy/time-out responses are not success. */
export async function readMailboxResponse<T = Record<string, unknown>>(response: Response, fallback: string): Promise<T> {
  let payload: unknown;
  try { payload = await response.json(); }
  catch {
    if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
    if ([502, 503, 504].includes(response.status)) throw new Error("O servidor não confirmou a operação a tempo. Atualize a caixa antes de tentar novamente.");
    throw new Error(`${fallback} O servidor não enviou uma confirmação válida. Atualize a caixa antes de tentar novamente.`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`${fallback} A resposta do servidor está incompleta.`);
  if (!response.ok) {
    const error = (payload as Record<string, unknown>).error;
    throw new Error(typeof error === "string" && error.length <= 600 ? error : fallback);
  }
  return payload as T;
}
