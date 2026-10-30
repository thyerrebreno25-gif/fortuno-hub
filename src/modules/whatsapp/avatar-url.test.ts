import { expect, it } from "vitest";
import { safeAvatarUrl } from "./avatar-url";
it("accepts WhatsApp and Meta CDN photos preserving temporary signatures", () => {
  expect(safeAvatarUrl("https://pps.whatsapp.net/photo.jpg?sig=abc")).toBe("https://pps.whatsapp.net/photo.jpg?sig=abc");
  expect(safeAvatarUrl("https://scontent.xx.fbcdn.net/photo.jpg")).toBeTruthy();
});
it("rejects credentials, arbitrary hosts and non-HTTPS photos", () => {
  for (const value of [null, "", "http://pps.whatsapp.net/a", "data:image/png;base64,a", "https://whatsapp.net.evil.test/a", "https://user:secret@pps.whatsapp.net/a", "https://127.0.0.1/a"]) expect(safeAvatarUrl(value)).toBeNull();
});
