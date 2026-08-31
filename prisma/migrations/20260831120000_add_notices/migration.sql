CREATE TYPE "NoticeKind" AS ENUM ('ALERT', 'REMINDER', 'NOTE');
CREATE TYPE "NoticeScope" AS ENUM ('PERSONAL', 'CLIENTS', 'GENERAL');
CREATE TYPE "NoticePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorMemberId" TEXT NOT NULL,
    "kind" "NoticeKind" NOT NULL DEFAULT 'ALERT',
    "scope" "NoticeScope" NOT NULL DEFAULT 'PERSONAL',
    "priority" "NoticePriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "targetsAllClients" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoticeClient" (
    "noticeId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "NoticeClient_pkey" PRIMARY KEY ("noticeId", "clientId")
);

CREATE TABLE "NoticeRecipient" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notice_organizationId_scope_createdAt_idx" ON "Notice"("organizationId", "scope", "createdAt");
CREATE INDEX "Notice_authorMemberId_createdAt_idx" ON "Notice"("authorMemberId", "createdAt");
CREATE INDEX "Notice_expiresAt_idx" ON "Notice"("expiresAt");
CREATE INDEX "NoticeClient_clientId_idx" ON "NoticeClient"("clientId");
CREATE UNIQUE INDEX "NoticeRecipient_noticeId_memberId_key" ON "NoticeRecipient"("noticeId", "memberId");
CREATE INDEX "NoticeRecipient_memberId_completedAt_viewedAt_idx" ON "NoticeRecipient"("memberId", "completedAt", "viewedAt");
CREATE INDEX "NoticeRecipient_noticeId_completedAt_idx" ON "NoticeRecipient"("noticeId", "completedAt");

ALTER TABLE "Notice" ADD CONSTRAINT "Notice_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notice" ADD CONSTRAINT "Notice_authorMemberId_fkey"
FOREIGN KEY ("authorMemberId") REFERENCES "OrganizationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoticeClient" ADD CONSTRAINT "NoticeClient_noticeId_fkey"
FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoticeClient" ADD CONSTRAINT "NoticeClient_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoticeRecipient" ADD CONSTRAINT "NoticeRecipient_noticeId_fkey"
FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoticeRecipient" ADD CONSTRAINT "NoticeRecipient_memberId_fkey"
FOREIGN KEY ("memberId") REFERENCES "OrganizationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
