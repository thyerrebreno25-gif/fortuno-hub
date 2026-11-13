export const draftReviewStorageKey = "fortuno:whatsapp:local-review";
export function draftReviewDelay(text: string) {
  if (text.trim().length < 2 || text.length > 5000 || !/[a-zá-ú]/i.test(text)) return null;
  return 300;
}
