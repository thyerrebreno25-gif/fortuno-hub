export const DEFAULT_AUDIT_CHECKLIST = [
  {
    category: "Base da auditoria",
    title: "Confirmar se o Extrato de Movimentações e a DRE cobrem todas as competências auditadas.",
    description: "Valide período, empresa, competência e se não faltou página ou conta na emissão dos relatórios.",
  },
  {
    category: "Saldos bancários",
    title: "Conferir se o saldo de cada conta bancária bate com o saldo registrado no sistema.",
    description: "Esta confirmação é feita pelo líder com os saldos externos das contas, mesmo quando a informação não consta nos PDFs.",
  },
  {
    category: "Conciliações",
    title: "Confirmar se todas as conciliações bancárias, de cartões e adquirentes estão concluídas.",
    description: "Qualquer conta ou período não conciliado deve ser direcionado ao operador responsável.",
  },
  {
    category: "Títulos vencidos",
    title: "Revisar contas a pagar e a receber vencidas e registrar a justificativa das pendências.",
    description: "Verifique títulos vencidos fora dos relatórios e envie divergências ao operador com prazo de correção.",
  },
  {
    category: "Competência",
    title: "Validar se receitas e despesas foram registradas na competência correta.",
    description: "Observe principalmente pagamentos antecipados, provisões, impostos, folha e lançamentos feitos em mês diferente do fato gerador.",
  },
  {
    category: "Obrigações fiscais",
    title: "Confirmar impostos e encargos recorrentes em todos os meses do período.",
    description: "Inclui DAS, DARF, FGTS, INSS, IRRF e outras obrigações aplicáveis ao cliente.",
  },
  {
    category: "Folha de pagamento",
    title: "Confirmar salários, férias, décimo terceiro e demais itens de folha aplicáveis ao período.",
    description: "Compare a recorrência mensal e investigue ausência ou variação material.",
  },
  {
    category: "Sócios",
    title: "Validar o pró-labore mensal e eventuais encargos relacionados.",
    description: "Confirme o pagamento e a competência do pró-labore e do INSS correspondente.",
  },
  {
    category: "Despesas recorrentes",
    title: "Confirmar água, energia, internet, aluguel, honorários e demais recorrências aplicáveis.",
    description: "Compare as competências da DRE e valide se uma despesa recorrente deixou de aparecer ou variou de forma relevante.",
  },
  {
    category: "Revisão final",
    title: "Revisar todos os apontamentos e concluir o fluxo Líder → Operador → Líder.",
    description: "A auditoria só deve ser concluída depois que as correções retornarem ao líder e forem validadas.",
  },
] as const;

export const CONTA_AZUL_AUDIT_CHECKLIST = [
  {
    category: "Base da auditoria",
    title: "Confirmar se o período e as contas financeiras analisadas correspondem ao fechamento.",
    description: "A análise automática usa os títulos de Contas a Pagar e Contas a Receber disponíveis na API do Conta Azul.",
  },
  {
    category: "Saldos bancários",
    title: "Conferir os saldos bancários externos com os saldos das contas correntes no Conta Azul.",
    description: "A API fornece o saldo do Conta Azul, mas a confirmação do saldo real do banco continua dependendo do extrato bancário.",
  },
  {
    category: "Conciliações",
    title: "Confirmar as conciliações bancárias, de cartões e adquirentes que não puderam ser comprovadas pela consulta.",
    description: "Direcione qualquer conta ou período pendente ao operador responsável.",
  },
  {
    category: "Exceções automáticas",
    title: "Revisar recorrências ausentes, títulos vencidos, abertos, duplicados e competências divergentes.",
    description: "Os apontamentos são separados entre Contas a Pagar e Contas a Receber e devem ser confirmados antes do envio.",
  },
  {
    category: "Revisão final",
    title: "Concluir o fluxo Líder → Operador → Líder para todas as divergências confirmadas.",
    description: "A auditoria só deve ser encerrada depois que as correções retornarem e forem validadas.",
  },
] as const;
