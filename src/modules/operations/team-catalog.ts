import { prisma } from "@/lib/prisma";
import { operationTeamOptions } from "./teams";

export async function operationTeamCatalog(organizationId: string) {
  const [activities, routines] = await Promise.all([
    prisma.operationActivity.findMany({ where: { organizationId, deletedAt: null, team: { not: null } }, distinct: ["team"], select: { team: true } }),
    prisma.operationClientProcess.findMany({ where: { client: { organizationId }, active: true, team: { not: null } }, distinct: ["team"], select: { team: true } }),
  ]);
  const values = [...activities, ...routines].map(row => row.team);
  return { values, options: operationTeamOptions(values) };
}
