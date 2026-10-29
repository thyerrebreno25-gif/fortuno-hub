export const navigationGroups = ["Visão geral", "Comunicação", "Operações", "Gestão de processos", "Análises", "Administração"] as const;
export type NavigationGroup = typeof navigationGroups[number];
export function navigationGroup(href: string): NavigationGroup {
  if (["/whatsapp", "/atendimento", "/suporte", "/reunioes", "/agenda", "/avisos"].includes(href)) return "Comunicação";
  if (["/mapeamento-operacional", "/onboarding", "/auditoria"].includes(href)) return "Gestão de processos";
  if (["/clientes", "/integracoes/conta-azul", "/integracoes/notion", "/configuracoes", "/perfil"].includes(href)) return "Administração";
  if (["/relatorios", "/historico"].includes(href)) return "Análises";
  if (["/inicio", "/dashboard", "/gestao"].includes(href)) return "Visão geral";
  return "Operações";
}
