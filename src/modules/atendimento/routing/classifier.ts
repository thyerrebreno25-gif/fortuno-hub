import { prisma } from "@/lib/prisma";

export type RoutingArea =
  | "ACCOUNTS_PAYABLE"
  | "ACCOUNTS_RECEIVABLE"
  | "GENERAL"
  | "UNKNOWN";

export type RoutingDecision = {
  clientId: string | null;
  assignedToId: string | null;
  area: RoutingArea;
  squad: "SQUAD_1" | "SQUAD_2" | null;
  confidence: number;
  reason: string;
  isSpam: boolean;
  spamScore: number;
};

type Input = {
  organizationId: string;
  senderEmail: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachmentNames?: string[];
  recipientEmails?: string[];
};

type ClientForRouting = {
  id: string;
  name: string;
  document: string | null;
  operationalEmail: string | null;
  operationalEmailCc: string | null;
  operationLeaderId: string | null;
  serviceSquad: "SQUAD_1" | "SQUAD_2" | null;
  payableResponsibleId: string | null;
  receivableResponsibleId: string | null;
  generalResponsibleId: string | null;
  serviceAliases: string | null;
};

const normalize = (value: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._ -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const compactDocument = (value?: string | null) =>
  String(value || "").replace(/\D/g, "");

const AP_TERMS: Array<[string, number]> = [
  ["contas a pagar", 14],
  ["pagamento", 6],
  ["pagar", 6],
  ["boleto", 7],
  ["vencimento", 4],
  ["fornecedor", 7],
  ["nota fiscal", 5],
  ["nf ", 3],
  ["fatura", 4],
  ["cobranca de fornecedor", 8],
  ["dados bancarios para pagamento", 10],
  ["pix para pagamento", 8],
  ["duplicata", 6],
];

const AR_TERMS: Array<[string, number]> = [
  ["contas a receber", 14],
  ["recebimento", 7],
  ["receber", 6],
  ["cobranca", 4],
  ["inadimplencia", 8],
  ["cliente inadimplente", 9],
  ["conciliacao de recebimentos", 12],
  ["vendas", 3],
  ["adquirente", 5],
  ["rede", 2],
  ["cielo", 4],
  ["getnet", 4],
  ["stone", 4],
  ["pagseguro", 4],
  ["maquininha", 5],
  ["repasse", 5],
  ["liquidacao", 4],
];

const SPAM_TERMS: Array<[string, number]> = [
  ["descadastre se", 12],
  ["unsubscribe", 12],
  ["newsletter", 10],
  ["oferta imperdivel", 9],
  ["oferta exclusiva", 7],
  ["promocao", 5],
  ["cupom de desconto", 8],
  ["compre agora", 7],
  ["frete gratis", 6],
  ["liquidacao", 5],
  ["black friday", 8],
  ["clique aqui", 4],
  ["proposta comercial", 8],
  ["parceria comercial", 7],
  ["apresentar nossos servicos", 8],
  ["apresentacao de servicos", 7],
  ["agende uma demonstracao", 8],
  ["solucoes para sua empresa", 6],
  ["aumente suas vendas", 6],
  ["catalogo de produtos", 6],
];

function scoreTerms(text: string, terms: Array<[string, number]>) {
  let score = 0;
  const hits: string[] = [];

  for (const [term, weight] of terms) {
    if (text.includes(term)) {
      score += weight;
      hits.push(term);
    }
  }

  return { score, hits };
}

function aliasesFor(client: ClientForRouting) {
  return [
    client.name,
    ...(client.serviceAliases || "")
      .split(/[,;\n]/)
      .map((item: string) => item.trim())
      .filter(Boolean),
  ];
}

export async function classifyAndRouteEmail(
  input: Input,
): Promise<RoutingDecision> {
  const sender = normalize(input.senderEmail);
  const recipients = new Set(
    (input.recipientEmails || []).map(normalize).filter(Boolean),
  );
  const subject = normalize(input.subject);
  const body = normalize(
    [
      input.textBody,
      input.htmlBody?.replace(/<[^>]+>/g, " "),
      ...(input.attachmentNames || []),
    ].join(" "),
  );

  const fullText = `${subject} ${body}`;

  const clients = await prisma.client.findMany({
    where: {
      organizationId: input.organizationId,
      active: true,
    },
    select: {
      id: true,
      name: true,
      document: true,
      operationalEmail: true,
      operationalEmailCc: true,
      operationLeaderId: true,
      serviceSquad: true,
      payableResponsibleId: true,
      receivableResponsibleId: true,
      generalResponsibleId: true,
      serviceAliases: true,
    },
  });

  const identities = await prisma.clientEmailIdentity.findMany({
    where: {
      active: true,
      client: {
        organizationId: input.organizationId,
        active: true,
      },
    },
    select: {
      clientId: true,
      normalizedEmail: true,
    },
  });

  const identityMap = new Map<string, Set<string>>();

  for (const identity of identities) {
    const email = normalize(identity.normalizedEmail);
    const clientIds = identityMap.get(email) || new Set<string>();
    clientIds.add(identity.clientId);
    identityMap.set(email, clientIds);
  }

  const candidates = clients
    .map((client) => {
      let score = 0;
      const reasons: string[] = [];

      const knownEmails = [
        client.operationalEmail || "",
        ...(client.operationalEmailCc || "").split(","),
      ]
        .map(normalize)
        .filter(Boolean);

      const identityClients = identityMap.get(sender);

      if (identityClients?.has(client.id)) {
        const sharedSender = identityClients.size > 1;
        score += sharedSender ? 12 : 35;
        reasons.push(
          sharedSender
            ? "remetente conhecido por mais de um cliente"
            : "remetente conhecido",
        );
      } else if (knownEmails.includes(sender)) {
        score += 30;
        reasons.push("e-mail operacional conhecido");
      }

      if (knownEmails.some((email) => recipients.has(email))) {
        score += 10;
        reasons.push("destinatário conhecido");
      }

      for (const rawAlias of aliasesFor(client)) {
        const alias = normalize(rawAlias);
        if (!alias || alias.length < 3) continue;

        if (subject.includes(alias)) {
          score += 38;
          reasons.push(`nome/alias no assunto: ${rawAlias}`);
        } else if (body.includes(alias)) {
          score += 25;
          reasons.push(`nome/alias no corpo/anexo: ${rawAlias}`);
        }
      }

      const document = compactDocument(client.document);
      const compactText = fullText.replace(/\D/g, "");

      if (
        document.length >= 11 &&
        compactText.includes(document)
      ) {
        score += 55;
        reasons.push("CNPJ/CPF encontrado no conteúdo");
      }

      return {
        client,
        score,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const second = candidates[1];

  const clientConfident =
    Boolean(best) &&
    best.score >= 25 &&
    (!second || best.score - second.score >= 8);

  const client = clientConfident ? best.client : null;

  const ap = scoreTerms(fullText, AP_TERMS);
  const ar = scoreTerms(fullText, AR_TERMS);
  const spam = scoreTerms(fullText, SPAM_TERMS);

  let area: RoutingArea = "GENERAL";
  let areaScore = 0;
  let areaReason = "assunto geral";

  if (ap.score >= 6 && ap.score >= ar.score + 3) {
    area = "ACCOUNTS_PAYABLE";
    areaScore = ap.score;
    areaReason = `sinais de contas a pagar: ${ap.hits.join(", ")}`;
  } else if (ar.score >= 6 && ar.score >= ap.score + 3) {
    area = "ACCOUNTS_RECEIVABLE";
    areaScore = ar.score;
    areaReason = `sinais de contas a receber: ${ar.hits.join(", ")}`;
  } else if (ap.score >= 6 || ar.score >= 6) {
    area = "UNKNOWN";
    areaScore = Math.max(ap.score, ar.score);
    areaReason = "conteúdo financeiro ambíguo entre pagar e receber";
  }

  if (!client) {
    const bestClientScore = best?.score || 0;
    const hasFinancialSignals = ap.score >= 6 || ar.score >= 6;
    const isSpam =
      bestClientScore < 15 &&
      !hasFinancialSignals &&
      spam.score >= 14 &&
      spam.hits.length >= 2;
    const spamScore = isSpam
      ? Math.min(98, 55 + spam.score * 2)
      : Math.min(69, spam.score * 3);

    if (isSpam) {
      return {
        clientId: null,
        assignedToId: null,
        area: "GENERAL",
        squad: null,
        confidence: spamScore,
        reason: `mensagem comercial sem cliente identificado: ${spam.hits.join(", ")}`,
        isSpam: true,
        spamScore,
      };
    }

    return {
      clientId: null,
      assignedToId: null,
      area,
      squad: null,
      confidence: Math.min(69, Math.max(20, best?.score || 20)),
      reason: best
        ? `Cliente não confirmado. Melhor candidato: ${best.client.name} (${best.score} pts). ${areaReason}`
        : `Cliente não identificado. ${areaReason}`,
      isSpam: false,
      spamScore,
    };
  }

  let assignedToId =
    client.generalResponsibleId ||
    client.operationLeaderId ||
    null;

  if (area === "ACCOUNTS_PAYABLE") {
    assignedToId =
      client.payableResponsibleId ||
      client.generalResponsibleId ||
      client.operationLeaderId ||
      null;
  }

  if (area === "ACCOUNTS_RECEIVABLE") {
    assignedToId =
      client.receivableResponsibleId ||
      client.generalResponsibleId ||
      client.operationLeaderId ||
      null;
  }

  if (area === "UNKNOWN") {
    assignedToId =
      client.generalResponsibleId ||
      client.operationLeaderId ||
      null;
  }

  const clientConfidence = Math.min(98, 55 + best.score);

  const areaConfidence =
    area === "GENERAL"
      ? 70
      : area === "UNKNOWN"
        ? 55
        : Math.min(98, 60 + areaScore * 2);

  const confidence = Math.round(
    clientConfidence * 0.65 +
      areaConfidence * 0.35,
  );

  return {
    clientId: client.id,
    assignedToId: confidence >= 70 ? assignedToId : null,
    area,
    squad: client.serviceSquad,
    confidence,
    reason: `${best.reasons.join("; ") || "cliente identificado"} · ${areaReason}`,
    isSpam: false,
    spamScore: Math.min(69, spam.score * 3),
  };
}
