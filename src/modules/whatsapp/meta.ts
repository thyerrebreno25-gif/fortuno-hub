import { createHmac, timingSafeEqual } from "node:crypto";

export type MetaWhatsAppContact = {
  wa_id?: string;
  profile?: { name?: string };
};

export type MetaWhatsAppMedia = {
  id?: string;
  caption?: string;
  filename?: string;
  mime_type?: string;
};

export type MetaWhatsAppMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  image?: MetaWhatsAppMedia;
  document?: MetaWhatsAppMedia;
  audio?: MetaWhatsAppMedia;
  video?: MetaWhatsAppMedia;
  sticker?: MetaWhatsAppMedia;
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  contacts?: unknown[];
  reaction?: { message_id?: string; emoji?: string };
};

export type MetaWhatsAppStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  conversation?: unknown;
  pricing?: unknown;
  errors?: unknown;
};

export type MetaWhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        contacts?: MetaWhatsAppContact[];
        messages?: MetaWhatsAppMessage[];
        statuses?: MetaWhatsAppStatus[];
      };
    }>;
  }>;
};

export type MetaWhatsAppAttachment = {
  externalId: string;
  name: string;
  mimeType: string | null;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não configurada.`);
  return value;
}

function graphVersion() {
  const value = requiredEnv("WHATSAPP_GRAPH_API_VERSION");
  if (!/^v\d+\.\d+$/.test(value)) {
    throw new Error("WHATSAPP_GRAPH_API_VERSION deve seguir o formato v00.0.");
  }
  return value;
}

function metaApiUrl(path: string) {
  return `https://graph.facebook.com/${graphVersion()}/${path.replace(/^\/+/, "")}`;
}

async function readMetaResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string; code?: number; error_subcode?: number } }
    | null;

  if (!response.ok) {
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`WhatsApp recusou a solicitação: ${detail}`);
  }

  return payload;
}

export function isWhatsAppMetaConfigured() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
      process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() &&
      process.env.WHATSAPP_APP_SECRET?.trim() &&
      process.env.WHATSAPP_VERIFY_TOKEN?.trim() &&
      process.env.WHATSAPP_GRAPH_API_VERSION?.trim(),
  );
}

export function getWhatsAppVerifyToken() {
  return requiredEnv("WHATSAPP_VERIFY_TOKEN");
}

export function getWhatsAppPhoneNumberId() {
  return requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
}

export function isValidMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret = process.env.WHATSAPP_APP_SECRET?.trim() || "",
) {
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const received = signatureHeader.slice("sha256=".length).toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(received)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

export function metaMessageContent(message: MetaWhatsAppMessage) {
  const type = message.type || "unknown";

  if (type === "text") return message.text?.body?.trim() || "[Mensagem sem texto]";
  if (type === "button") return message.button?.text?.trim() || "[Botão selecionado]";
  if (type === "interactive") {
    const reply = message.interactive?.button_reply || message.interactive?.list_reply;
    return reply?.title?.trim() || "[Opção selecionada]";
  }
  if (type === "location") {
    const location = message.location;
    const label = [location?.name, location?.address].filter(Boolean).join(" — ");
    const coordinates =
      typeof location?.latitude === "number" && typeof location.longitude === "number"
        ? `${location.latitude}, ${location.longitude}`
        : "";
    return `[Localização recebida] ${label || coordinates}`.trim();
  }
  if (type === "reaction") {
    return `[Reação recebida] ${message.reaction?.emoji || ""}`.trim();
  }
  if (type === "contacts") return "[Contato compartilhado]";

  const media = message[type as keyof MetaWhatsAppMessage] as
    | MetaWhatsAppMedia
    | undefined;
  const labels: Record<string, string> = {
    image: "Imagem",
    document: "Documento",
    audio: "Áudio",
    video: "Vídeo",
    sticker: "Figurinha",
  };
  if (labels[type]) {
    return media?.caption?.trim() || `[${labels[type]} recebido]`;
  }

  return `[Mensagem do tipo ${type} recebida]`;
}

export function metaMessageAttachment(
  message: MetaWhatsAppMessage,
): MetaWhatsAppAttachment | null {
  const type = message.type || "";
  if (!["image", "document", "audio", "video", "sticker"].includes(type)) {
    return null;
  }

  const media = message[type as keyof MetaWhatsAppMessage] as
    | MetaWhatsAppMedia
    | undefined;
  if (!media?.id) return null;

  const names: Record<string, string> = {
    image: "imagem-whatsapp",
    document: "documento-whatsapp",
    audio: "audio-whatsapp",
    video: "video-whatsapp",
    sticker: "figurinha-whatsapp",
  };

  return {
    externalId: media.id,
    name: media.filename?.trim() || names[type] || "arquivo-whatsapp",
    mimeType: media.mime_type?.trim() || null,
  };
}

export async function sendWhatsAppText(input: {
  to: string;
  body: string;
  replyToMessageId?: string | null;
}) {
  const accessToken = requiredEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = getWhatsAppPhoneNumberId();
  const to = input.to.replace(/\D/g, "");
  if (!to) throw new Error("Destinatário do WhatsApp inválido.");

  const response = await fetch(metaApiUrl(`${phoneNumberId}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: input.body },
      ...(input.replyToMessageId
        ? { context: { message_id: input.replyToMessageId } }
        : {}),
    }),
    cache: "no-store",
  });

  const payload = (await readMetaResponse(response)) as {
    messages?: Array<{ id?: string }>;
  } | null;
  const messageId = payload?.messages?.[0]?.id;
  if (!messageId) throw new Error("WhatsApp não retornou o identificador da mensagem.");
  return { messageId };
}

export async function downloadWhatsAppMedia(mediaId: string) {
  const accessToken = requiredEnv("WHATSAPP_ACCESS_TOKEN");
  const metadataResponse = await fetch(metaApiUrl(encodeURIComponent(mediaId)), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const metadata = (await readMetaResponse(metadataResponse)) as {
    url?: string;
    mime_type?: string;
    file_size?: number;
  } | null;
  if (!metadata?.url) throw new Error("Arquivo não localizado no WhatsApp.");

  const fileResponse = await fetch(metadata.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!fileResponse.ok) {
    throw new Error(`WhatsApp não liberou o arquivo (HTTP ${fileResponse.status}).`);
  }

  return {
    body: await fileResponse.arrayBuffer(),
    mimeType:
      fileResponse.headers.get("content-type") || metadata.mime_type || "application/octet-stream",
    size: Number(fileResponse.headers.get("content-length") || metadata.file_size || 0) || null,
  };
}
