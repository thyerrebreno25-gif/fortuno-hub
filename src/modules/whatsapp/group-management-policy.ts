import { z } from "zod";
import type { GroupMember } from "./group-members";
import { memberAliases } from "./group-members";

export const groupParticipantInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), participant: z.string().trim().max(40).transform(value => value.replace(/[+\s()\-]/g, "")).pipe(z.string().regex(/^[1-9]\d{7,14}$/)), requestId: z.uuid() }),
  z.object({ action: z.literal("remove"), participant: z.string().regex(/^\d{8,20}@(s\.whatsapp\.net|lid)$/), requestId: z.uuid() }),
]);

export function canManageGroupInHub(role: string, permission: { canView?: boolean; canEdit?: boolean; canManage?: boolean }, userId: string, ticket: { assignedToId: string | null; status: string }) {
  return role !== "CLIENT" && permission.canView === true && permission.canEdit === true &&
    (["MASTER", "ADMIN", "MANAGER"].includes(role) || permission.canManage === true ||
      ticket.assignedToId === userId && !["RESOLVED", "SPAM"].includes(ticket.status));
}

export function groupAccountIsAdmin(profile: { accountIsAdmin: boolean; participants: GroupMember[] }, phone: string) {
  return profile.accountIsAdmin || profile.participants.some(person => person.phone === phone && (person.isAdmin || person.isSuperAdmin));
}

export function canRemoveGroupMember(person: GroupMember, phone: string, ownerId: string | null) {
  return person.phone !== phone && !person.isSuperAdmin && (!ownerId || !memberAliases(person).includes(ownerId));
}

// A 200 response can still contain an individual rejection, especially for privacy.
export function participantOperationResult(body: unknown, aliases: string[], action: "add" | "remove") {
  const root = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const rows = Array.isArray(root.groupUpdated) ? root.groupUpdated : [];
  const row = rows.find(value => value && typeof value === "object" && aliases.includes(String((value as Record<string, unknown>).JID)));
  const code = row && typeof row === "object" ? (row as Record<string, unknown>).Error : undefined;
  if (code === 0) return { ok: true, message: action === "add" ? "Participante adicionado ao grupo." : "Participante removido do grupo." };
  if (action === "add" && code === 403) return { ok: false, message: "A privacidade desse contato impede a adição direta. Adicione-o por convite pelo WhatsApp." };
  return { ok: false, message: code === undefined ? "O WhatsApp não confirmou a alteração. Atualize os membros antes de tentar novamente." : "O WhatsApp recusou a alteração deste participante. Confira as permissões e atualize os membros." };
}
