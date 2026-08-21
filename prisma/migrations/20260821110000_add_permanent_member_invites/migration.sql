CREATE TABLE "OrganizationMemberInviteToken" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMemberInviteToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationMemberInviteToken_tokenHash_key"
ON "OrganizationMemberInviteToken"("tokenHash");

CREATE INDEX "OrganizationMemberInviteToken_memberId_idx"
ON "OrganizationMemberInviteToken"("memberId");

ALTER TABLE "OrganizationMemberInviteToken"
ADD CONSTRAINT "OrganizationMemberInviteToken_memberId_fkey"
FOREIGN KEY ("memberId") REFERENCES "OrganizationMember"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
