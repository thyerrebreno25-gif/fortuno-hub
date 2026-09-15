CREATE TYPE "AssistantConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AssistantMessageRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "AssistantConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Nova conversa',
    "status" "AssistantConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastOpenAiResponseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AssistantMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantConversation_organizationId_userId_status_updatedAt_idx"
    ON "AssistantConversation"("organizationId", "userId", "status", "updatedAt");
CREATE INDEX "AssistantConversation_clientId_updatedAt_idx"
    ON "AssistantConversation"("clientId", "updatedAt");
CREATE INDEX "AssistantMessage_conversationId_createdAt_idx"
    ON "AssistantMessage"("conversationId", "createdAt");

ALTER TABLE "AssistantConversation" ADD CONSTRAINT "AssistantConversation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantConversation" ADD CONSTRAINT "AssistantConversation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantConversation" ADD CONSTRAINT "AssistantConversation_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
