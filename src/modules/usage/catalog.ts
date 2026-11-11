import type { ModuleCode } from "@/modules/permissions/permissions";

export const usagePages: Array<{ key: string; label: string; href: string; module: ModuleCode }> = [
  { key: "home", label: "Início", href: "/inicio", module: "DASHBOARD" },
  { key: "dashboard", label: "Dashboard", href: "/dashboard", module: "DASHBOARD" },
  { key: "management", label: "Gestão", href: "/gestao", module: "MANAGEMENT" },
  { key: "executive", label: "Painel gerencial", href: "/painel-gerencial", module: "MANAGEMENT" },
  { key: "whatsapp", label: "WhatsApp", href: "/whatsapp", module: "WHATSAPP" },
  { key: "email", label: "Central de e-mails", href: "/atendimento", module: "SERVICE_CENTER" },
  { key: "meetings", label: "Reuniões", href: "/reunioes", module: "MEETINGS" },
  { key: "calendar", label: "Agenda", href: "/agenda", module: "CALENDAR" },
  { key: "support", label: "Suporte", href: "/suporte", module: "SUPPORT" },
  { key: "notices", label: "Avisos", href: "/avisos", module: "NOTICES" },
  { key: "operations", label: "Gestão de tarefas", href: "/operacoes", module: "OPERATIONS" },
  { key: "assistant", label: "Assistente", href: "/assistente", module: "ASSISTANT" },
  { key: "statements", label: "Extratos", href: "/extratos", module: "IMPORTS" },
  { key: "invoices", label: "Faturas", href: "/faturas", module: "IMPORTS" },
  { key: "purchases", label: "Notas de compra", href: "/notas-fiscais", module: "PURCHASE_INVOICES" },
  { key: "acquirers", label: "Adquirentes", href: "/adquirentes", module: "IMPORTS" },
  { key: "sales", label: "Conferência de vendas", href: "/conferencia-vendas", module: "SALES_RECONCILIATION" },
  { key: "investment", label: "Rendimentos de aplicações", href: "/rendimentos", module: "INVESTMENT_INCOME" },
  { key: "contracts", label: "Importação de contratos", href: "/contratos", module: "CONTRACT_IMPORTS" },
  { key: "exchange", label: "Motor Cambial", href: "/motor-cambial", module: "MOTOR_EXCHANGE" },
  { key: "mapping", label: "Mapeamento Operacional", href: "/mapeamento-operacional", module: "OPERATIONAL_MAPPING" },
  { key: "onboarding", label: "Onboarding", href: "/onboarding", module: "ONBOARDING" },
  { key: "audit", label: "Auditoria", href: "/auditoria", module: "AUDIT" },
  { key: "reports", label: "Relatórios", href: "/relatorios", module: "REPORTS" },
  { key: "history", label: "Histórico", href: "/historico", module: "HISTORY" },
  { key: "notion", label: "Notion", href: "/integracoes/notion", module: "NOTION" },
  { key: "clients", label: "Clientes", href: "/clientes", module: "CLIENTS" },
  { key: "ca", label: "Conta Azul", href: "/integracoes/conta-azul", module: "PURCHASE_INVOICES" },
  { key: "settings", label: "Configurações", href: "/configuracoes", module: "SETTINGS" },
  { key: "profile", label: "Meu perfil", href: "/perfil", module: "DASHBOARD" },
];

export function usagePage(pathname: string) {
  const path = pathname.split(/[?#]/, 1)[0];
  if (path === "/cambio") return usagePages.find(p => p.key === "exchange");
  return usagePages.find(p => path === p.href || path.startsWith(p.href + "/"));
}
export const USAGE_CLIENT_EVENT = "fortuno:usage-client";
export function usageDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
