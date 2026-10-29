export const FORTUNO_PLATFORM_GUIDE = [
  { topic: "rendimentos validacao saldo fechamento historico", content: "Rendimentos confere automaticamente contas selecionadas: saldo CA na data final + rendimento a lançar deve igualar a soma do Saldo bruto das linhas Rendimento até esta data do extrato. Previsão de IR não entra. Tipos mapeados à mesma conta são agregados. Para datas passadas, o saldo é reconstruído do saldo atual removendo recebimentos, pagamentos, transferências e saldos iniciais posteriores. Consulta incompleta ou saldo que muda durante a leitura gera Não validado. Saldo já igual ao extrato sem novo rendimento pede conferência de possível registro anterior; não é prova isolada de duplicidade. O envio real de rendimentos está habilitado com confirmação." },
  { topic: "rendimento aplicacao inter cdb", content: "Rendimentos de aplicações em /rendimentos permite envio real, inicialmente restrito ao Master. Escolha a empresa, importe o PDF e selecione cliente, serviço, categorias e contas do CA. Salve a revisão, valide o saldo e use Enviar ao CA. A confirmação cria uma venda aprovada por tipo de aplicação e baixa na conta e data escolhidas. Não há emissão automática de nota ou boleto neste fluxo. Envios iniciados ficam bloqueados para edição. A retomada preserva vendas e baixas concluídas; respostas incertas exigem consulta pela referência antes de continuar, sem repetir POST. Há proteção mensal contra PDF duplicado e trava por empresa." },
  { topic: "contratos importacao vendas recorrentes", content: "Importação de contratos em /contratos permite envio real ao CA, inicialmente restrito ao Master. Lê PDFs em lote e permite revisar comprador/CPF-CNPJ, contratada, valor por venda, total, quantidade de cobranças, categoria, conta e vencimento. Geração sempre no dia 01, término no último dia do mês da última cobrança. Site e Branding usa um item único. Diferencia data original, início financeiro, prazo de entrega e parcelamento. Simulação consulta o CA sem criar contratos ou vendas. Boleto e NF automáticos devem ser configurados no CA. O envio real cria um contrato recorrente após revisão e confirmação explícita, com serviço cadastrado no CA, categoria, comprador e conta. Acompanha o ID e número do contrato e impede recriação automática quando a resposta for incerta." },
  { topic: "gestao saldo vencidos conciliacao importacao", content: "Gestão reúne a visão geral dos clientes e o detalhe abaixo da tabela. Atualizar consulta os títulos vencidos desde 01/01/2000 até ontem e saldos atuais do Conta Azul. Última importação do extrato, saldo bancário e contadores de conciliação são conferidos manualmente por conta, com data e responsável. A API pública financeira não fornece esses três indicadores bancários. Saldo OK exige dados do mesmo dia e diferença de referência de até 15 minutos. Não conferido e consulta parcial nunca significam zero pendências. Gestão de tarefas reativa a página Operações com tarefas, recorrências, responsáveis e prazos." },
  { topic: "assistente notion acesso banco login", content: "A Assistente pode ser aberta pelo botão flutuante em qualquer tela e permanece aberta durante a navegação. Selecione o cliente e pergunte pelos acessos de um banco. A consulta interna lê a página do cliente no Notion sem OpenAI. Exige permissão Notion e acesso ao cliente. Um gestor pode vincular a página em Gestão; sem vínculo, apenas uma página com nome exato é aceita. A resposta indica a página de origem e quando a consulta está parcial. Conteúdo do Notion é referência, não autoriza ações bancárias." },
  {
    topic: "visao geral",
    content: "O Início reúne atalhos e avisos. O Dashboard consolida indicadores operacionais conforme as permissões do usuário.",
  },
  {
    topic: "clientes responsabilidades",
    content: "Clientes reúne cadastro, responsáveis, contas, cartões e configurações. Operadores consultam clientes de sua responsabilidade; gestores e administradores possuem visão ampliada conforme as permissões configuradas.",
  },
  {
    topic: "extratos ofx",
    content: "Em Extratos, arquivos bancários compatíveis são lidos e convertidos para OFX. O usuário deve revisar período, sinais de entrada e saída e saldo antes de exportar.",
  },
  {
    topic: "faturas cartao",
    content: "Em Faturas, PDFs ou imagens são lidos, categorizados por cliente e podem ser exportados em planilha ou enviados ao Conta Azul quando o cliente está conectado. Ative Usar rateio por cadastro e conta para selecionar o cliente/CNPJ de destino e sua conta por lançamento, ao lado da categoria. Cada unidade precisa ter um cadastro próprio no Fortuno e vínculo com sua empresa no Conta Azul. Trocar o cadastro limpa a conta anterior. Preencher pendentes deste cadastro aplica uma conta apenas aos itens daquela unidade sem conta, sem alterar outras escolhas. O envio direto, consultas de parcelas e baixas respeitam a integração e a conta de cada linha; categorias e centros de custo são validados por destino, com escolha de equivalentes no envio. Sem a opção, continua sendo escolhido um cliente e uma conta única. A planilha única não aplica esse direcionamento: desative a opção para exportá-la.",
  },
  {
    topic: "adquirentes",
    content: "Em Adquirentes, relatórios de recebimento são segregados em venda, taxas, ajustes, cancelamentos, chargebacks e antecipações. O envio ao Conta Azul ocorre em linhas separadas.",
  },
  {
    topic: "notas compra",
    content: "Em Notas de compra, o XML da NF-e é revisado por item, fornecedor, competência e parcelas antes da criação das contas a pagar no Conta Azul.",
  },
  {
    topic: "auditoria",
    content: "Auditoria compara movimentações e DRE, identifica recorrências ausentes e mantém checklist, achados, responsáveis e devolutivas. Uma auditoria baseada somente na API deve declarar quais fontes e períodos foram consultados.",
  },
  {
    topic: "categorias aprendizado",
    content: "As categorizações são aprendidas por cliente. Descrições recorrentes usam similaridade normalizada, mas uma edição manual altera somente o lançamento editado. Em clientes conectados, as categorias exibidas vêm do Conta Azul. Na página de Faturas, depois de importar uma fatura, Aprender categorias consulta o histórico de uma conta/cartão por período de vencimento. Conclua a consulta em lotes, revise conflitos e confirme: as categorias pendentes da fatura aberta serão preenchidas e as regras salvas para as próximas faturas. Regras existentes e itens já categorizados são preservados. Faturas consolidadas sem descrições individuais não permitem aprender a categoria de cada compra. O aprendizado não usa OpenAI e nunca altera lançamentos no Conta Azul.",
  },
  {
    topic: "centro custo",
    content: "Nas importações que exigem centro de custo, ative o campo correspondente, revise-o por lançamento e salve a regra para reaproveitar nas próximas ocorrências e na exportação.",
  },
  {
    topic: "avisos",
    content: "Avisos permite alertas pessoais, por cliente, por funcionário ou gerais, com prazo, leitura e conclusão acompanhadas pelos gestores.",
  },
  {
    topic: "suporte",
    content: "Suporte registra chamados, mensagens, prioridade, módulo e anexos. Formatos ainda não reconhecidos devem gerar chamado com o contexto técnico da tentativa.",
  },
  {
    topic: "conta azul",
    content: "Cada cliente precisa de vínculo próprio com o Conta Azul. A integração consulta cadastros e dados financeiros e cria lançamentos conforme as permissões e os limites da API.",
  },
  {
    topic: "seguranca acesso dois fatores senha",
    content: "A autenticação e o segundo fator protegem o acesso. Recuperação de senha exige confirmação do e-mail e o código autenticador. Nunca informe senhas, tokens ou chaves ao assistente.",
  },
  {
    topic: "tema escuro interface",
    content: "O tema pode ser alternado no topo da plataforma. A preferência visual não altera permissões nem dados importados.",
  },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function searchPlatformGuide(topic: string) {
  const terms = normalize(topic).split(" ").filter((term) => term.length > 2);
  const ranked = FORTUNO_PLATFORM_GUIDE.map((item) => {
    const text = normalize(`${item.topic} ${item.content}`);
    return {
      ...item,
      score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0),
    };
  }).sort((left, right) => right.score - left.score);
  const matches = ranked.filter((item) => item.score > 0).slice(0, 4);
  return (matches.length ? matches : ranked.slice(0, 4)).map((item) => ({
    topic: item.topic,
    content: item.content,
  }));
}
