ALTER TABLE "OrganizationMember"
ADD COLUMN "isTeamLeader" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "teamLeaderId" TEXT;

CREATE INDEX "OrganizationMember_teamLeaderId_idx"
ON "OrganizationMember"("teamLeaderId");

ALTER TABLE "OrganizationMember"
ADD CONSTRAINT "OrganizationMember_teamLeaderId_fkey"
FOREIGN KEY ("teamLeaderId") REFERENCES "OrganizationMember"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
