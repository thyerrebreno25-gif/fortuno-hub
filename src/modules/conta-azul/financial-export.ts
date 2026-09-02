export type ContaAzulOption = {
  value: string;
  label: string;
  type?: "RECEITA" | "DESPESA";
};

export type FinancialDirection = "PAYABLE" | "RECEIVABLE";

export function normalizeContaAzulLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function findContaAzulOption(
  options: ContaAzulOption[],
  requestedLabel: string,
  expectedType?: ContaAzulOption["type"],
): ContaAzulOption | null {
  const requested = normalizeContaAzulLabel(requestedLabel);
  if (!requested) return null;

  const compatibleOptions = expectedType
    ? options.filter((option) => !option.type || option.type === expectedType)
    : options;

  const exact = compatibleOptions.find(
    (option) => normalizeContaAzulLabel(option.label) === requested,
  );
  if (exact) return exact;

  // Categorias internas podem ser exibidas como "Categoria > Subcategoria".
  // O Conta Azul normalmente devolve apenas o nome da folha.
  const leaf = requestedLabel.split(/\s*>\s*/).at(-1) || requestedLabel;
  const normalizedLeaf = normalizeContaAzulLabel(leaf);
  const leafMatches = compatibleOptions.filter(
    (option) => normalizeContaAzulLabel(option.label) === normalizedLeaf,
  );
  return leafMatches.length === 1 ? leafMatches[0] : null;
}

export function apiItems(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) {
    return body.filter(
      (item): item is Record<string, unknown> => Boolean(item && typeof item === "object"),
    );
  }
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  for (const candidate of [record.itens, record.items, record.data, record.conteudo]) {
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (item): item is Record<string, unknown> => Boolean(item && typeof item === "object"),
      );
    }
  }
  return [];
}

export function contaAzulOptions(body: unknown): ContaAzulOption[] {
  return apiItems(body).flatMap((item) => {
    const value = [item.id, item.uuid, item.id_categoria, item.id_centro_custo].find(
      (candidate) => typeof candidate === "string",
    );
    const label = [item.nome, item.descricao, item.name, item.razao_social].find(
      (candidate) => typeof candidate === "string",
    );
    const rawType = typeof item.tipo === "string" ? item.tipo.toUpperCase() : "";
    const type = rawType === "RECEITA" || rawType === "DESPESA"
      ? rawType
      : undefined;
    return typeof value === "string" && typeof label === "string"
      ? [{ value, label, ...(type ? { type } : {}) }]
      : [];
  });
}

function roundedMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildFinancialEventPayload(input: {
  direction: FinancialDirection;
  competenceDate: string;
  dueDate: string;
  description: string;
  observation: string;
  amount: number;
  contactId: string;
  financialAccountId: string;
  categoryId: string;
  costCenterId?: string | null;
}) {
  const value = roundedMoney(Math.abs(input.amount));
  const costCenterAllocation = input.costCenterId
    ? [{ id_centro_custo: input.costCenterId, valor: value }]
    : [];

  return {
    data_competencia: input.competenceDate,
    valor: value,
    observacao: input.observation,
    descricao: input.description,
    contato: input.contactId,
    conta_financeira: input.financialAccountId,
    rateio: [
      {
        id_categoria: input.categoryId,
        valor: value,
        rateio_centro_custo: costCenterAllocation,
      },
    ],
    condicao_pagamento: {
      parcelas: [
        {
          descricao: input.description,
          data_vencimento: input.dueDate,
          nota: input.observation,
          conta_financeira: input.financialAccountId,
          detalhe_valor: {
            multa: 0,
            juros: 0,
            valor_bruto: value,
            valor_liquido: value,
            desconto: 0,
            taxa: 0,
          },
          metodo_pagamento: "OUTRO",
        },
      ],
    },
  };
}

export function protocolIdFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ["protocolId", "protocolo", "protocol_id"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return null;
}

export function protocolState(body: unknown): "PENDING" | "SUCCESS" | "ERROR" {
  if (!body || typeof body !== "object") return "PENDING";
  const record = body as Record<string, unknown>;
  const raw = [record.status, record.situacao, record.state]
    .find((value) => typeof value === "string");
  const normalized = typeof raw === "string" ? raw.toUpperCase() : "PENDING";
  if (["SUCCESS", "SUCESSO", "COMPLETED", "CONCLUIDO", "CONCLUÍDO"].includes(normalized)) {
    return "SUCCESS";
  }
  if (["ERROR", "ERRO", "FAILED", "FALHA"].includes(normalized)) return "ERROR";
  return "PENDING";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function resourceIdFromProtocol(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of [
    "resourceId",
    "resource_id",
    "id_recurso",
    "idEvento",
    "id_evento",
    "eventId",
    "evento",
  ]) {
    if (isUuid(record[key])) return record[key];
  }
  for (const key of ["resultado", "result", "data", "recurso", "resource"]) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const nestedRecord = nested as Record<string, unknown>;
      if (isUuid(nestedRecord.id)) return nestedRecord.id;
      const result = resourceIdFromProtocol(nested);
      if (result) return result;
    }
  }
  return null;
}

export function protocolError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ["message", "mensagem", "error", "erro", "detail", "detalhe"]) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  return null;
}

export function installmentIdFrom(body: unknown): string | null {
  const first = apiItems(body)[0];
  if (!first) return null;
  const value = [first.id, first.uuid, first.id_parcela].find(isUuid);
  return value || null;
}
