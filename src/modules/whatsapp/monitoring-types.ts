import type {monitoringInsights} from "./monitoring-insights";
export type Breakdown = {
  id: string;
  name: string;
  conversations: number;
  active: number;
  resolved: number;
  messages: number;
  averageFirstResponseMinutes: number;
  averageHandlingMinutes: number;
  satisfaction: number | null;
};

export type MonitoringData = {
  insights?:ReturnType<typeof monitoringInsights>;
  coverage?:{conversationLimitReached:boolean;messageLimitReached:boolean;liveLimitReached:boolean};
  operationStartedAt?: string|null;
  attentionStartedAt?: string|null;
  accountRecipient?: string|null;
  period: { from: string; to: string; days: number };
  summary: {
    conversations: number;
    active: number;
    queue: number;
    completed: number;
    resolutionRate: number;
    averageQueueMinutes: number;
    averageFirstResponseMinutes: number;
    averageHandlingMinutes: number;
    averageCustomerWaitMinutes: number;
    longestCurrentWaitMinutes: number;
    satisfaction: number | null;
    satisfactionResponses: number;
  };
  timeline: Array<{
    date: string;
    label: string;
    received: number;
    resolved: number;
    averageResponseMinutes: number;
  }>;
  hourly: Array<{ hour: number; label: string; conversations: number }>;
  areas: Array<{ label: string; value: number }>;
  clients: Breakdown[];
  agents: Breakdown[];
  attention: Array<{
    id: string;
    contact: string;
    client: string;
    assignee: string;
    status: string;
    waitingMinutes: number;
    lastMessageAt: string;
  }>;
};

