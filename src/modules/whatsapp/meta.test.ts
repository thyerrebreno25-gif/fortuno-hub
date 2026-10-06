import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isValidMetaSignature,
  metaMessageAttachment,
  metaMessageContent,
} from "./meta";

describe("Meta WhatsApp", () => {
  it("valida a assinatura enviada no webhook", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    const secret = "segredo-do-aplicativo";
    const signature = `sha256=${createHmac("sha256", secret)
      .update(body)
      .digest("hex")}`;

    expect(isValidMetaSignature(body, signature, secret)).toBe(true);
    expect(isValidMetaSignature(`${body}alterado`, signature, secret)).toBe(false);
    expect(isValidMetaSignature(body, null, secret)).toBe(false);
  });

  it("lê texto e opções interativas", () => {
    expect(
      metaMessageContent({ type: "text", text: { body: "Preciso de ajuda" } }),
    ).toBe("Preciso de ajuda");
    expect(
      metaMessageContent({
        type: "interactive",
        interactive: { button_reply: { id: "pagar", title: "Contas a pagar" } },
      }),
    ).toBe("Contas a pagar");
  });

  it("preserva a identificação de documentos recebidos", () => {
    const message = {
      type: "document",
      document: {
        id: "media-123",
        filename: "nota-fiscal.pdf",
        mime_type: "application/pdf",
        caption: "Segue a nota",
      },
    };

    expect(metaMessageContent(message)).toBe("Segue a nota");
    expect(metaMessageAttachment(message)).toEqual({
      externalId: "media-123",
      name: "nota-fiscal.pdf",
      mimeType: "application/pdf",
    });
  });
});
