import { prisma } from "@/lib/prisma";
import type { CreateOnboardingInput, UpdateTaskInput } from "../types/onboarding.types";

const onboardingInclude = {
  client: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true, email: true } },
  tasks: {
    orderBy: { position: "asc" as const },
    include: {
      responsible: { select: { id: true, name: true, email: true } },
      comments: {
        orderBy: { createdAt: "asc" as const },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      timeEntries: { orderBy: { startedAt: "desc" as const } },
    },
  },
} as const;

export const onboardingRepository = {
  list(organizationId: string) {
    return prisma.onboarding.findMany({
      where: { organizationId },
      orderBy: [{ status: "asc" }, { expectedEndDate: "asc" }],
      include: onboardingInclude,
    });
  },

  findById(id: string, organizationId: string) {
    return prisma.onboarding.findFirst({ where: { id, organizationId }, include: onboardingInclude });
  },

  async create(organizationId: string, userId: string, input: CreateOnboardingInput) {
    const template = await prisma.onboardingTemplate.findFirst({
      where: { id: input.templateId, organizationId, active: true },
      include: {
        categories: {
          orderBy: { position: "asc" },
          include: {
            activities: {
              orderBy: { position: "asc" },
              include: { tasks: { orderBy: { position: "asc" } } },
            },
          },
        },
      },
    });
    if (!template) throw new Error("TEMPLATE_NOT_FOUND");

    const client = await prisma.client.findFirst({ where: { id: input.clientId, organizationId, active: true } });
    if (!client) throw new Error("CLIENT_NOT_FOUND");

    const startDate = new Date(`${input.startDate}T00:00:00`);
    const expectedEndDate = input.expectedEndDate
      ? new Date(`${input.expectedEndDate}T00:00:00`)
      : new Date(startDate.getTime() + template.slaDays * 86400000);

    const taskRows = template.categories.flatMap((category) =>
      category.activities.flatMap((activity) =>
        activity.tasks.map((task) => ({
          templateTaskId: task.id,
          responsibleId: input.responsibleId ?? null,
          categoryName: category.name,
          activityName: activity.name,
          subcategory: task.subcategory,
          title: task.title,
          description: task.description,
          mandatory: task.mandatory,
          estimatedMinutes: task.estimatedMinutes,
          tip: task.tip,
          isNotionReminder: task.isNotionReminder,
          position: category.position * 10000 + activity.position * 100 + task.position,
        }))
      )
    );

    return prisma.onboarding.create({
      data: {
        organizationId,
        clientId: input.clientId,
        templateId: input.templateId,
        responsibleId: input.responsibleId ?? null,
        createdById: userId,
        startDate,
        expectedEndDate,
        notes: input.notes ?? null,
        tasks: { create: taskRows },
        history: { create: { userId, action: "CREATED", entity: "ONBOARDING" } },
      },
      include: onboardingInclude,
    });
  },

  updateTask(taskId: string, organizationId: string, userId: string, input: UpdateTaskInput) {
    return prisma.$transaction(async (tx) => {
      const task = await tx.onboardingTask.findFirst({
        where: { id: taskId, onboarding: { organizationId } },
      });
      if (!task) throw new Error("TASK_NOT_FOUND");

      if (input.status === "BLOCKED" && (!input.blockedReason?.trim() || !input.waitingFor?.trim())) {
        throw new Error("BLOCK_DATA_REQUIRED");
      }

      const updated = await tx.onboardingTask.update({
        where: { id: taskId },
        data: {
          status: input.status,
          responsibleId: input.responsibleId,
          startedAt: input.status === "IN_PROGRESS" && !task.startedAt ? new Date() : undefined,
          completedAt: input.status === "COMPLETED" ? new Date() : input.status ? null : undefined,
          blockedAt: input.status === "BLOCKED" ? new Date() : input.status ? null : undefined,
          blockedReason: input.status === "BLOCKED" ? input.blockedReason : input.status ? null : undefined,
          waitingFor: input.status === "BLOCKED" ? input.waitingFor : input.status ? null : undefined,
        },
      });

      await tx.onboardingHistory.create({
        data: {
          onboardingId: task.onboardingId,
          userId,
          action: "TASK_UPDATED",
          entity: "ONBOARDING_TASK",
          entityId: task.id,
          beforeData: task,
          afterData: updated,
        },
      });
      return updated;
    });
  },
};
