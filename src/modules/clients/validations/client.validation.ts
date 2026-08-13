import {
  type AcquirerReceiptRule,
  type CategoryMappingType,
  type ClientSquad,
  type CreateClientInput,
} from "../types/client.types";
import {
  cleanDocument,
  normalizeDisplayText,
  normalizeText,
} from "../utils/client-normalizers";

const RECEIPT_RULES: AcquirerReceiptRule[] = [
  "WITHOUT_ADVANCE",
  "AUTOMATIC_ADVANCE",
  "OCCASIONAL_ADVANCE",
];

const CATEGORY_MAPPING_TYPES: CategoryMappingType[] = [
  "SALES_REVENUE",
  "MDR_FEES",
  "ADVANCE_FEES",
  "MACHINE_RENTAL_ADJUSTMENTS",
  "SALE_CANCELLATION",
  "REFUNDS_CREDITS",
];

function optionalId(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

export class ClientValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientValidationError";
  }
}

export function isValidCnpj(document: string): boolean {
  const cnpj = cleanDocument(document);

  if (cnpj.length !== 14) {
    return false;
  }

  if (/^(\d)\1{13}$/.test(cnpj)) {
    return false;
  }

  function calculateDigit(base: string, weights: number[]): number {
    const total = base
      .split("")
      .reduce(
        (sum, digit, index) =>
          sum + Number.parseInt(digit, 10) * weights[index],
        0,
      );

    const remainder = total % 11;

    return remainder < 2 ? 0 : 11 - remainder;
  }

  const firstDigit = calculateDigit(
    cnpj.slice(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );

  const secondDigit = calculateDigit(
    cnpj.slice(0, 12) + firstDigit,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );

  return cnpj.endsWith(`${firstDigit}${secondDigit}`);
}

export function validateCreateClientPayload(
  body: unknown,
): CreateClientInput {
  if (!body || typeof body !== "object") {
    throw new ClientValidationError(
      "Os dados enviados para o cadastro são inválidos.",
    );
  }

  const payload = body as Record<string, unknown>;

  const name =
    typeof payload.name === "string"
      ? normalizeDisplayText(payload.name)
      : "";

  const document = cleanDocument(payload.document);

  const rawServiceSquad = payload.serviceSquad;
  const serviceSquad =
    rawServiceSquad === "SQUAD_1" ||
    rawServiceSquad === "SQUAD_2"
      ? (rawServiceSquad as ClientSquad)
      : null;

  if (rawServiceSquad && !serviceSquad) {
    throw new ClientValidationError("Selecione uma equipe válida.");
  }

  const operationLeaderId = optionalId(payload.operationLeaderId);
  const payableResponsibleId = optionalId(
    payload.payableResponsibleId,
  );
  const receivableResponsibleId = optionalId(
    payload.receivableResponsibleId,
  );
  const generalResponsibleId = optionalId(
    payload.generalResponsibleId,
  );
  const serviceAliases =
    typeof payload.serviceAliases === "string" &&
    payload.serviceAliases.trim()
      ? payload.serviceAliases.trim()
      : null;

  if (name.length < 3) {
    throw new ClientValidationError(
      "Informe um nome de cliente com pelo menos 3 caracteres.",
    );
  }

  if (!isValidCnpj(document)) {
    throw new ClientValidationError("Informe um CNPJ válido.");
  }

  const rawAcquirers = Array.isArray(payload.acquirers)
    ? payload.acquirers
    : [];

  const acquirerNames = new Set<string>();

  const acquirers = rawAcquirers.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new ClientValidationError(
        `A adquirente ${index + 1} possui dados inválidos.`,
      );
    }

    const acquirer = item as Record<string, unknown>;

    const acquirerName =
      typeof acquirer.name === "string"
        ? normalizeDisplayText(acquirer.name)
        : "";

    const receiptRule = acquirer.receiptRule;

    if (acquirerName.length < 2) {
      throw new ClientValidationError(
        `Informe o nome da adquirente ${index + 1}.`,
      );
    }

    if (
      typeof receiptRule !== "string" ||
      !RECEIPT_RULES.includes(receiptRule as AcquirerReceiptRule)
    ) {
      throw new ClientValidationError(
        `Selecione uma regra de recebimento válida para ${acquirerName}.`,
      );
    }

    const normalizedName = normalizeText(acquirerName);

    if (acquirerNames.has(normalizedName)) {
      throw new ClientValidationError(
        `A adquirente ${acquirerName} foi adicionada mais de uma vez.`,
      );
    }

    acquirerNames.add(normalizedName);

    return {
      name: acquirerName,
      receiptRule: receiptRule as AcquirerReceiptRule,
    };
  });

  const rawMappings = Array.isArray(payload.categoryMappings)
    ? payload.categoryMappings
    : [];

  const mappingTypes = new Set<CategoryMappingType>();

  const categoryMappings = rawMappings.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new ClientValidationError(
        `O mapeamento de categoria ${index + 1} é inválido.`,
      );
    }

    const mapping = item as Record<string, unknown>;

    const mappingType = mapping.mappingType;
    const category =
      typeof mapping.category === "string"
        ? normalizeDisplayText(mapping.category)
        : "";

    const subcategory =
      typeof mapping.subcategory === "string"
        ? normalizeDisplayText(mapping.subcategory)
        : null;

    if (
      typeof mappingType !== "string" ||
      !CATEGORY_MAPPING_TYPES.includes(
        mappingType as CategoryMappingType,
      )
    ) {
      throw new ClientValidationError(
        `O tipo do mapeamento ${index + 1} é inválido.`,
      );
    }

    if (category.length < 2) {
      throw new ClientValidationError(
        `Informe a categoria do mapeamento ${index + 1}.`,
      );
    }

    const typedMapping = mappingType as CategoryMappingType;

    if (mappingTypes.has(typedMapping)) {
      throw new ClientValidationError(
        "Cada tipo financeiro pode possuir somente um mapeamento de categoria.",
      );
    }

    mappingTypes.add(typedMapping);

    return {
      mappingType: typedMapping,
      category,
      subcategory: subcategory || null,
    };
  });

  return {
    name,
    document,
    acquirers,
    categoryMappings,
    serviceSquad,
    operationLeaderId,
    payableResponsibleId,
    receivableResponsibleId,
    generalResponsibleId,
    serviceAliases,
  };
}
