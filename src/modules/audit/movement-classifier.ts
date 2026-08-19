import type { AuditMovement } from "./types";

export type MonthlyObligationCode = "TAXES" | "PAYROLL" | "PRO_LABORE";

export type MonthlyObligationDefinition = {
  code: MonthlyObligationCode;
  label: string;
};

export const MONTHLY_OBLIGATIONS: MonthlyObligationDefinition[] = [
  { code: "TAXES", label: "Impostos e encargos" },
  { code: "PAYROLL", label: "Salários e folha" },
  { code: "PRO_LABORE", label: "Pró-labore" },
];

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function movementContent(movement: AuditMovement) {
  return normalize([
    movement.description,
    movement.counterparty,
    movement.category,
  ].filter(Boolean).join(" "));
}

const TAX_PATTERN = /\b(?:IMPOST\w*|TRIBUT\w*|SIMPLES NACIONAL|DARF|FGTS|INSS|ISS(?:QN)?|ICMS|IRPJ|CSLL|COFINS|PIS|IRRF|GUIA GPS)\b/;
const PAYROLL_PATTERN = /\b(?:SALARI\w*|FOLHA|FERIAS|DECIMO TERCEIRO|13 SALARIO|BENEFICIO\w* TRABALHISTA\w*)\b/;
const PRO_LABORE_PATTERN = /\bPRO\s*LABORE\b/;

export function classifyMonthlyObligation(
  movement: AuditMovement,
): MonthlyObligationCode | null {
  const content = movementContent(movement);

  if (TAX_PATTERN.test(content)) return "TAXES";
  if (PRO_LABORE_PATTERN.test(content)) return "PRO_LABORE";
  if (PAYROLL_PATTERN.test(content)) return "PAYROLL";

  return null;
}

export function isPriorityAuditMovement(movement: AuditMovement) {
  return classifyMonthlyObligation(movement) !== null;
}

function hasIdentifiedCounterparty(value: string | null) {
  const normalized = normalize(value);

  return Boolean(
    normalized
    && ![
      "NAO INFORMADO",
      "NAO IDENTIFICADO",
      "SEM IDENTIFICACAO",
      "DIVERSOS",
      "CLIENTE FORNECEDOR",
      "PIX",
      "RECEBIMENTO",
      "TRANSFERENCIA",
      "BANCO",
    ].includes(normalized),
  );
}

function genericDescriptionResidue(value: string) {
  return normalize(value)
    .replace(
      /\b(?:PIX|RECEBIMENTO|RECEBIDO|RECEBIDA|ENVIADO|ENVIADA|TRANSFERENCIA|TRANSF|ENTRE CONTAS|CONTA|CONTAS|TED|DOC|CREDITO|DEBITO|VIA|BANCO|AUTOMATICO|AUTOMATICA|APLICACAO|RESGATE|NAO IDENTIFICADO|NAO INFORMADO|SEM IDENTIFICACAO|SEM NOME|ID|E2E|CHAVE|CODIGO|REFERENCIA|OPERACAO|TRANSACAO|DE|DO|DA|EM|PARA)\b/g,
      " ",
    )
    .replace(/\b[A-Z0-9]{7,}\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGenericAuditMovement(movement: AuditMovement) {
  if (isPriorityAuditMovement(movement)) return false;

  const description = normalize(movement.description);

  if (
    /\b(?:TRANSFERENCIA|TRANSF) ENTRE CONTAS\b/.test(description)
    || /\b(?:APLICACAO|RESGATE) AUTOMATIC[AO]\b/.test(description)
  ) {
    return true;
  }

  const genericOperation = /\b(?:PIX|RECEBIMENTO|RECEBIDO|TRANSFERENCIA|TED|DOC)\b/.test(
    description,
  );

  if (!genericOperation || hasIdentifiedCounterparty(movement.counterparty)) {
    return false;
  }

  return genericDescriptionResidue(description).length === 0;
}

export function filterGenericAuditMovements(movements: AuditMovement[]) {
  const ignoredMovements: AuditMovement[] = [];
  const auditableMovements: AuditMovement[] = [];

  for (const movement of movements) {
    if (isGenericAuditMovement(movement)) {
      ignoredMovements.push(movement);
    } else {
      auditableMovements.push(movement);
    }
  }

  return { auditableMovements, ignoredMovements };
}
