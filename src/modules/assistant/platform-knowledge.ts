export const FORTUNO_PLATFORM_GUIDE = [
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
    content: "Em Faturas, PDFs ou imagens são lidos, categorizados por cliente e podem ser exportados em planilha ou enviados ao Conta Azul quando o cliente está conectado.",
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
    content: "As categorizações são aprendidas por cliente. Descrições recorrentes usam similaridade normalizada, mas uma edição manual altera somente o lançamento editado. Em clientes conectados, as categorias exibidas vêm do Conta Azul.",
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
