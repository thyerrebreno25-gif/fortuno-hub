export const DEFAULT_AUDIT_CHECKLIST = [
  { category: "Contas a Pagar e Receber", title: "Revisar contas a pagar e a receber em atraso e os motivos ainda não cobertos pelos relatórios importados." },
  { category: "Contas a Pagar e Receber", title: "Validar inadimplentes com os recebimentos e confirmar pendências que dependam de alinhamento com o cliente." },
  { category: "Conciliação Bancária", title: "Confirmar a conciliação Conta Azul x banco quando o extrato bancário não tiver sido importado na auditoria." },
  { category: "Aplicações Financeiras", title: "Validar aplicações, rendimentos e impostos que o sistema sinalizou para revisão." },
  { category: "Meios de Recebimento", title: "Validar saldos e taxas dos meios de recebimento quando os relatórios das adquirentes não tiverem sido importados." },
  { category: "Fluxo de Caixa", title: "Revisar novas categorias e variações apontadas pelo motor e confirmar se fazem sentido no contexto do cliente." },
  { category: "DRE", title: "Validar competências e datas que dependam de contexto operacional ou documentação externa." },
  { category: "Revisão Final", title: "Revisar todos os alertas críticos e pontos de atenção antes de concluir a auditoria." },
] as const;
