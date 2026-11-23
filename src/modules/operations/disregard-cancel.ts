import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { disregardReview } from "./disregard-policy";
/** Deleting an activity also resolves its approval notice so no orphan decision remains. */
export async function cancelDisregardNotices(tx: Pick<Prisma.TransactionClient, "notice" | "noticeRecipient">, organizationId: string, rows: Array<{ disregardReview?: unknown }>, now: Date) {
  const ids = rows.flatMap(row => { const review = disregardReview(row.disregardReview); return review?.status === "PENDING" && review.noticeId?.startsWith("operation-disregard:") ? [review.noticeId] : []; });
  if (!ids.length) return;
  await tx.notice.updateMany({ where: { id: { in: ids }, organizationId, closedAt: null }, data: { closedAt: now } });
  await tx.noticeRecipient.updateMany({ where: { noticeId: { in: ids }, notice: { organizationId } }, data: { completedAt: now, viewedAt: now } });
}
