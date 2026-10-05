export const WHATSAPP_SOURCES = [
  "WHATSAPP_SIMULATOR",
  "WHATSAPP_API",
] as const;

export type WhatsAppIdentityKind = "CONTACT" | "GROUP";
export type WhatsAppRoutingArea =
  | "ACCOUNTS_PAYABLE"
  | "ACCOUNTS_RECEIVABLE"
  | "GENERAL"
  | "UNKNOWN";

export type WhatsAppRoutingClient = {
  operationLeaderId?: string | null;
  payableResponsibleId?: string | null;
  receivableResponsibleId?: string | null;
  generalResponsibleId?: string | null;
};

export function normalizeWhatsappIdentity(
  kind: WhatsAppIdentityKind,
  value: string,
) {
  const trimmed = value.trim();

  if (kind === "GROUP") {
    return trimmed.toLocaleLowerCase("pt-BR").replace(/\s+/g, "-");
  }

  return trimmed.replace(/\D/g, "");
}

export function whatsappChannelAddress(
  kind: WhatsAppIdentityKind,
  externalId: string,
) {
  return kind === "GROUP"
    ? `wa-group:${externalId}`
    : `wa-contact:${externalId}`;
}

export function parseWhatsappChannelAddress(address: string) {
  if (address.startsWith("wa-group:")) {
    return {
      kind: "GROUP" as const,
      externalId: address.slice("wa-group:".length),
    };
  }

  return {
    kind: "CONTACT" as const,
    externalId: address.replace(/^wa-contact:/, ""),
  };
}

export function responsibleForRoutingArea(
  client: WhatsAppRoutingClient,
  routingArea: WhatsAppRoutingArea,
) {
  if (routingArea === "ACCOUNTS_PAYABLE") {
    return (
      client.payableResponsibleId ||
      client.generalResponsibleId ||
      client.operationLeaderId ||
      null
    );
  }

  if (routingArea === "ACCOUNTS_RECEIVABLE") {
    return (
      client.receivableResponsibleId ||
      client.generalResponsibleId ||
      client.operationLeaderId ||
      null
    );
  }

  return (
    client.generalResponsibleId || client.operationLeaderId || null
  );
}

export function minutesBetween(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
) {
  if (!start || !end) return null;
  const difference = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Math.round(difference / 60000));
}

export function average(values: Array<number | null | undefined>) {
  const valid = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );

  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}
