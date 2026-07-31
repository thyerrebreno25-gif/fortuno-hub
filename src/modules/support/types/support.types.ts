export type SupportMessage = {
  id: string;
  userId: string;
  userName: string;
  senderType: "USER" | "SUPPORT";
  text: string;
  createdAt: string;
  attachments?: SupportAttachment[];
};

export type SupportAttachment = {
  name: string;
  size: number;
  type: string;
};

export type SupportMetadata = {
  category?: string;
  module?: string;
  attachments?: SupportAttachment[];
  messages?: SupportMessage[];
  technicalContext?: Record<string, unknown>;
};

export function parseSupportMetadata(value: unknown): SupportMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as SupportMetadata;
}
