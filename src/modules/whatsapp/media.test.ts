import { describe, expect, it } from "vitest";
import { byteRange, mediaKind, previewMime } from "./media";
describe("WhatsApp inline media and audio ranges", () => {
  it("recognizes existing attachments without stored MIME types", () => {
    expect(mediaKind(null, "AudioMessage", "[AudioMessage]")).toBe("audio");
    expect(mediaKind(null, "ImageMessage")).toBe("image");
    expect(mediaKind(null, "arquivo.mp4")).toBe("video");
    expect(mediaKind("application/pdf", "contrato.pdf")).toBe("file");
    expect(mediaKind("audio/ogg; codecs=opus", "voz")).toBe("audio");
  });
  it("sniffs actual JPEG, Ogg and WebP content for legacy attachments", () => {
    expect(previewMime(new Uint8Array([255, 216, 255, 0]), "")).toBe("image/jpeg");
    expect(previewMime(new TextEncoder().encode("OggSrest"), "application/octet-stream")).toBe("audio/ogg");
    expect(previewMime(new TextEncoder().encode("RIFF0000WEBPrest"), "")).toBe("image/webp");
  });
  it("does not preview HTML, SVG or unknown files as active content", () => {
    expect(previewMime(new TextEncoder().encode("<html>"), "text/html")).toBeNull();
    expect(previewMime(new TextEncoder().encode("<svg>"), "image/svg+xml")).toBeNull();
    expect(previewMime(new Uint8Array([0, 1]), "application/octet-stream")).toBeNull();
  });
  it("supports seeking, open-ended and suffix audio requests", () => {
    expect(byteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(byteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange("bytes=90-1000", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange(null, 100)).toBeNull();
  });
  it.each(["bytes=100-", "bytes=5-1", "bytes=-0", "bytes=", "bytes=0-2,4-6", "anything"])("rejects invalid ranges: %s", (value) => expect(byteRange(value, 100)).toBe(false));
});
