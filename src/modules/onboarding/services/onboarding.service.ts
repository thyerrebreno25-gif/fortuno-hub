import { prisma } from "@/lib/prisma";
import { onboardingRepository } from "../repositories/onboarding.repository";
import type { CreateOnboardingInput, UpdateTaskInput } from "../types/onboarding.types";

const progress = (tasks: { status: string }[]) => {
  const applicable = tasks.filter((task) => task.status !== "NOT_APPLICABLE");
  return applicable.length
    ? Math.round((applicable.filter((task) => task.status === "COMPLETED").length / applicable.length) * 100)
    : 0;
};

const seconds = (entries: { seconds: number; startedAt: Date; endedAt: Date | null }[]) =>
  entries.reduce((sum, entry) => {
    if (entry.endedAt) return sum + entry.seconds;
    return sum + Math.max(0, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000));
  }, 0);

export const onboardingService = {
  async list(organizationId: string) {
    const rows = await onboardingRepository.list(organizationId);
    return rows.map((item) => ({
      ...item,
      progress: progress(item.tasks),
      trackedSeconds: item.tasks.reduce((sum, task) => sum + seconds(task.timeEntries), 0),
      blockedTasks: item.tasks.filter((task) => task.status === "BLOCKED").length,
    }));
  },

  create(organizationId: string, userId: string, input: CreateOnboardingInput) {
    return onboardingRepository.create(organizationId, userId, input);
  },

  updateTask(taskId: string, organizationId: string, userId: string, input: UpdateTaskInput) {
    return onboardingRepository.updateTask(taskId, organizationId, userId, input);
  },

  async dashboard(organizationId: string) {
    const rows = await this.list(organizationId);
    const completed = rows.filter((item) => item.status === "COMPLETED" && item.completedAt);
    const averageDays = completed.length
      ? Math.round(completed.reduce((sum, item) => sum + Math.max(0, Math.round((item.completedAt!.getTime() - item.startDate.getTime()) / 86400000)), 0) / completed.length)
      : 0;

    const clientHours = rows
      .map((item) => ({ clientId: item.clientId, clientName: item.client?.name ?? item.companyName ?? "Implantação sem cliente", seconds: item.trackedSeconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 10);

    const activityMap = new Map<string, number>();
    rows.forEach((item) => item.tasks.forEach((task) => {
      activityMap.set(task.activityName, (activityMap.get(task.activityName) ?? 0) + seconds(task.timeEntries));
    }));

    const activities = [...activityMap.entries()]
      .map(([name, totalSeconds]) => ({ name, seconds: totalSeconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 10);

    const responsibleMap = new Map<string, { name: string; total: number; progressSum: number }>();
    rows.forEach((item) => {
      const key = item.responsible?.id ?? "UNASSIGNED";
      const current = responsibleMap.get(key) ?? { name: item.responsible?.name ?? "Sem responsável", total: 0, progressSum: 0 };
      current.total += 1;
      current.progressSum += item.progress;
      responsibleMap.set(key, current);
    });

    return {
      open: rows.filter((item) => item.status === "OPEN").length,
      inProgress: rows.filter((item) => item.status === "IN_PROGRESS").length,
      completed: rows.filter((item) => item.status === "COMPLETED").length,
      overdue: rows.filter((item) => item.risk === "OVERDUE").length,
      averageDays,
      overallProgress: rows.length ? Math.round(rows.reduce((sum, item) => sum + item.progress, 0) / rows.length) : 0,
      totalSeconds: rows.reduce((sum, item) => sum + item.trackedSeconds, 0),
      clientHours,
      activities,
      responsibles: [...responsibleMap.values()].map((item) => ({ ...item, averageProgress: Math.round(item.progressSum / item.total) })),
    };
  },
};
