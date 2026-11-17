export const noteEmojis = ["👍", "❤️", "✅", "👀", "👏", "🙏", "🎉", "🤔"] as const;
export function noteReactions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, emoji]) => typeof emoji === "string" && (noteEmojis as readonly string[]).includes(emoji)));
}
export function toggleNoteReaction(value: unknown, userId: string, emoji: string) {
  if (!(noteEmojis as readonly string[]).includes(emoji)) throw new Error("Reação inválida.");
  const reactions = noteReactions(value);
  if (reactions[userId] === emoji) delete reactions[userId]; else reactions[userId] = emoji;
  return reactions;
}
export function canEditNote(authorId: string, userId: string) {return authorId === userId;}
export function canDeleteNote(authorId: string, userId: string, canManage: boolean) {return canEditNote(authorId, userId) || canManage;}
