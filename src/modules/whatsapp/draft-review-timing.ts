export const draftReviewStorageKey = "fortuno:whatsapp:auto-review";
export function draftReviewDelay(text: string, lastStarted: number, now: number) {
  if (text.trim().length < 8 || text.length > 5000 || !/[a-zá-ú]/i.test(text)) return null;
  // Wait for typing to pause; avoid a model request on each keystroke or pause.
  return Math.max(1500, 8000 - (now - lastStarted));
}
