export type GroupParticipantBatchResult = { id: string; name: string; ok: boolean; message: string };
export async function addGroupParticipantBatch(
  groups: Array<{ id: string; name: string }>,
  input: { action: "add"; participant: string; requestId: string },
  onResult: (result: GroupParticipantBatchResult) => void,
  isActive: () => boolean,
  send: typeof fetch = fetch,
) {
  for (const group of groups.slice(0, 25)) {
    if (!isActive()) break;
    let result: GroupParticipantBatchResult;
    try {
      const response = await send(`/api/whatsapp/${encodeURIComponent(group.id)}/participants`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const body = await response.json();
      result = { ...group, ok: response.ok && body.ok === true, message: body.message || body.error || "Não foi possível confirmar. Confira os membros antes de repetir." };
    } catch {
      result = { ...group, ok: false, message: "Sem confirmação de resposta. Confira os membros antes de repetir." };
    }
    if (isActive()) onResult(result);
  }
}
