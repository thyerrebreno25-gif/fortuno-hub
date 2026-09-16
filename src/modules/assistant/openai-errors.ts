export type OpenAIUsage = {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  requestIds: string[];
};

export type OpenAIErrorDetails = {
  status: number;
  kind: "rate_limit" | "credits" | "spend_limit" | "usage_limit" | "quota" | "access" | "unknown";
  code: string | null;
  type: string | null;
  requestId: string | null;
  retryAfterSeconds: number | null;
};

export class OpenAIRequestError extends Error {
  usage?: OpenAIUsage;

  constructor(message: string, public details: OpenAIErrorDetails) {
    super(message);
    this.name = "OpenAIRequestError";
  }

  get status() { return this.details.status; }
}

function identifier(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value) ? value : null;
}

export function openAIRequestId(headers: Headers) {
  return identifier(headers.get("x-request-id"));
}

function retryAfterSeconds(value: string | null, now: number) {
  if (!value) return null;
  const numeric = Number(value);
  const seconds = Number.isFinite(numeric) ? numeric : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

export function openAIRequestError(
  status: number,
  error: { code?: unknown; type?: unknown; message?: unknown } | undefined,
  headers: Headers,
  now = Date.now(),
) {
  const code = identifier(error?.code);
  const type = identifier(error?.type);
  const reasons = [code, type];
  const details: OpenAIErrorDetails = {
    status, code, type, kind: "unknown", requestId: openAIRequestId(headers),
    retryAfterSeconds: status === 429 ? retryAfterSeconds(headers.get("retry-after"), now) : null,
  };
  let message = `Não foi possível consultar a OpenAI (erro ${status}).`;
  if (status === 429) {
    if (reasons.includes("credit_balance_exhausted")) {
      details.kind = "credits";
      message = "O saldo de créditos da API da OpenAI acabou. O administrador precisa verificar a cobrança e o saldo da API; aguardar não resolve esse bloqueio.";
    } else if (reasons.some((reason) => ["project_spend_limit_exceeded", "organization_spend_limit_exceeded", "billing_hard_limit_reached"].includes(reason || ""))) {
      details.kind = "spend_limit";
      message = "A API da OpenAI atingiu o limite de gastos configurado no projeto ou na organização. O administrador precisa revisar esse limite na cobrança; não é um limite temporário de perguntas.";
    } else if (reasons.includes("organization_usage_limit_exceeded")) {
      details.kind = "usage_limit";
      message = "A organização atingiu o limite de uso aprovado para a API da OpenAI. O administrador precisa conferir os limites da conta; tentar novamente imediatamente não resolve.";
    } else if (reasons.includes("insufficient_quota")) {
      details.kind = "quota";
      message = "A conta da OpenAI está sem cota financeira disponível. O administrador precisa verificar o saldo e os limites de gastos na cobrança da API; aguardar pode não resolver.";
    } else if (reasons.some((reason) => ["rate_limit_exceeded", "rate_limit_error", "slow_down"].includes(reason || ""))
      || /rate limit|tokens per min|requests per min/i.test(String(error?.message || ""))) {
      details.kind = "rate_limit";
      const seconds = details.retryAfterSeconds;
      const delay = seconds
        ? ` Aguarde pelo menos ${seconds < 60 ? `${seconds} segundo(s)` : `${Math.ceil(seconds / 60)} minuto(s)`} antes de tentar novamente.`
        : " Aguarde a liberação do limite antes de tentar novamente; evite repetir o envio em sequência.";
      message = `A assistente atingiu o limite temporário de processamento da OpenAI, compartilhado pelo projeto. Isso considera o volume de dados, não apenas a quantidade de perguntas.${delay}`;
    } else {
      message = "A OpenAI bloqueou esta solicitação, mas não informou um motivo de limite reconhecido. O administrador precisa conferir o diagnóstico da API para distinguir saldo, gastos e processamento; não foi confirmado que seja temporário.";
    }
    message += " O botão Aprender categorias continua disponível sem depender da inteligência.";
  } else if (status === 401 || status === 403) {
    details.kind = "access";
    message = "A OpenAI negou o acesso à API. O administrador precisa conferir a chave e as permissões do projeto.";
  }
  // Não armazenar a mensagem bruta: ela pode conter identificadores e dados sensíveis.
  return new OpenAIRequestError(message, details);
}
