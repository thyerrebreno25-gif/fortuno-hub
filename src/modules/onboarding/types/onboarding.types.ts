export type CreateOnboardingInput = {
  clientId: string;
  templateId: string;
  responsibleId?: string | null;
  startDate: string;
  expectedEndDate?: string | null;
  notes?: string | null;
};

export type UpdateTaskInput = {
  status?: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "NOT_APPLICABLE";
  responsibleId?: string | null;
  blockedReason?: string | null;
  waitingFor?: string | null;
};
