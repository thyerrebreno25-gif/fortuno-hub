import { timingSafeEqual } from "node:crypto";

/** Public scheduler endpoints must fail closed when their secret is missing. */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const actual = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
