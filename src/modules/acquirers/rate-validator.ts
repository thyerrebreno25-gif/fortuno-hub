export type ContractedRateRule = {
  id?: string;
  modality: string;
  installments: number | null;
  cardBrand: string | null;
  rate: number;
  tolerance: number;
};

export type RateValidationInput = {
  modality: string;
  installments?: number | null;
  cardBrand?: string | null;
  chargedRate: number;
  grossAmount?: number | null;
};

export type RateValidationResult = {
  status: "OK" | "DIVERGENT" | "NO_RULE";
  matchedRule: ContractedRateRule | null;
  chargedRate: number;
  contractedRate: number | null;
  differencePercentagePoints: number | null;
  financialImpact: number | null;
};

function normalize(value?: string | null): string | null {
  if (!value) return null;
  const result = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  return result || null;
}

export function validateContractedRate(
  input: RateValidationInput,
  rules: ContractedRateRule[],
): RateValidationResult {
  const modality = normalize(input.modality);
  const brand = normalize(input.cardBrand);
  const installments =
    modality === "PIX" ? null : input.installments ?? 1;

  const candidates = rules.filter(
    (rule) =>
      normalize(rule.modality) === modality &&
      (rule.installments ?? null) === installments,
  );

  const matchedRule =
    candidates.find((rule) => normalize(rule.cardBrand) === brand && brand) ??
    candidates.find((rule) => normalize(rule.cardBrand) === null) ??
    null;

  if (!matchedRule) {
    return {
      status: "NO_RULE",
      matchedRule: null,
      chargedRate: input.chargedRate,
      contractedRate: null,
      differencePercentagePoints: null,
      financialImpact: null,
    };
  }

  const difference = input.chargedRate - Number(matchedRule.rate);
  const tolerance = Number(matchedRule.tolerance ?? 0);
  const status = Math.abs(difference) <= tolerance ? "OK" : "DIVERGENT";
  const grossAmount = Number(input.grossAmount ?? 0);

  return {
    status,
    matchedRule,
    chargedRate: input.chargedRate,
    contractedRate: Number(matchedRule.rate),
    differencePercentagePoints: difference,
    financialImpact:
      Number.isFinite(grossAmount) && grossAmount !== 0
        ? (grossAmount * difference) / 100
        : null,
  };
}

export function validateContractedRates(
  inputs: RateValidationInput[],
  rules: ContractedRateRule[],
): RateValidationResult[] {
  return inputs.map((input) => validateContractedRate(input, rules));
}
