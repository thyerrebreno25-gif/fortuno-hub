import "server-only";

import { prisma } from "@/lib/prisma";
import { activeMailbox } from "./mailbox-archive";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export async function purgeExpiredServiceTickets(now = new Date()) {
  const spamCutoff = new Date(now.getTime() - 2 * DAY_IN_MS);
  const resolvedCutoff = new Date(now.getTime() - 5 * DAY_IN_MS);

  const retentionFilter = {
    ...activeMailbox,
    OR: [
      {
        status: "SPAM" as const,
        updatedAt: { lte: spamCutoff },
      },
      {
        isSpam: true,
        updatedAt: { lte: spamCutoff },
      },
      {
        status: "RESOLVED" as const,
        resolvedAt: { not: null, lte: resolvedCutoff },
      },
    ],
  };

  const [expiredSpam, expiredResolved] = await Promise.all([
    prisma.serviceTicket.count({
      where: {
        ...activeMailbox,
        OR: [{ status: "SPAM" }, { isSpam: true }],
        updatedAt: { lte: spamCutoff },
      },
    }),
    prisma.serviceTicket.count({
      where: {
        ...activeMailbox,
        status: "RESOLVED",
        resolvedAt: { not: null, lte: resolvedCutoff },
      },
    }),
  ]);

  const deleted = await prisma.serviceTicket.deleteMany({
    where: retentionFilter,
  });

  return {
    deleted: deleted.count,
    expiredSpam,
    expiredResolved,
    spamCutoff: spamCutoff.toISOString(),
    resolvedCutoff: resolvedCutoff.toISOString(),
  };
}
