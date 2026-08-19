export type DashboardModule =
  | "EXCHANGE"
  | "BANK_STATEMENT"
  | "ACQUIRER"
  | "CREDIT_CARD_INVOICE"
  | "BRASILMED_RECONCILIATION";

export type DashboardStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "REVIEW"
  | "VALIDATED"
  | "EXPORTED"
  | "FAILED";

export interface DashboardSummary {
  activeClients: number;
  exportsToday: number;
  exportsThisMonth: number;
  exportedClientsThisMonth: number;
  exportedTransactionsThisMonth: number;
  openTickets: number;
  activeOnboardings: number;
  overdueOnboardings: number;
  onboardingHoursThisMonth: number;
  activeAudits: number;
}

export interface DashboardProcessingByModule {
  module: DashboardModule;
  total: number;
}

export interface DashboardRecentProcessing {
  id: string;
  module: DashboardModule;
  status: DashboardStatus;
  originalName: string;
  clientName: string | null;
  userName: string | null;
  createdAt: string;
}

export interface DashboardRecentActivity {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  userName: string;
  createdAt: string;
}

export interface DashboardSupportTicket {
  id: string;
  subject: string;
  priority: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  userName: string;
  createdAt: string;
}

export interface DashboardTeamPerformance {
  userId: string;
  name: string;
  total: number;
}

export interface DashboardFinancialVolume {
  credits: number;
  debits: number;
  total: number;
}

export interface DashboardData {
  generatedAt: string;
  user: {
    id: string;
    name: string;
    role: string;
    isTeamLeader: boolean;
    visibleTeamSize: number;
  };
  access: Record<string, boolean>;
  summary: DashboardSummary;
  processingsByModule: DashboardProcessingByModule[];
  recentProcessings: DashboardRecentProcessing[];
  recentActivities: DashboardRecentActivity[];
  supportTickets: DashboardSupportTicket[];
  teamPerformance: DashboardTeamPerformance[];
  financialVolume: DashboardFinancialVolume;
  acquirerComparison: Array<{
    acquirer: "CIELO" | "GETNET" | "REDE" | "PAGARME";
    label: string;
    clientsCount: number;
    bestClientName: string | null;
    highestClientName: string | null;
    bestRate: number | null;
    highestRate: number | null;
    spread: number | null;
    clients: Array<{
      clientId: string;
      clientName: string;
      averageRate: number;
      deltaFromBest: number;
      rateCount: number;
    }>;
  }>;
}
