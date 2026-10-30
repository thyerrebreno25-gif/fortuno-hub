CREATE TABLE IF NOT EXISTS "WhatsAppReadState" (
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "ticketId" TEXT NOT NULL REFERENCES "ServiceTicket"("id") ON DELETE CASCADE,
 "readAt" TIMESTAMP(3) NOT NULL,
 "lastMessageId" TEXT NOT NULL,
 PRIMARY KEY ("organizationId", "userId", "ticketId")
);
CREATE INDEX IF NOT EXISTS "ServiceMessage_ticket_direction_received_id_idx" ON "ServiceMessage"("ticketId", "direction", "receivedAt", "id");
