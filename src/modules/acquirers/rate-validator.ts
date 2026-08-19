import { selectContractedRate } from "./contracted-rate-matcher";

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

export function validateContractedRate(
  input: RateValidationInput,
  rules: ContractedRateRule[],
): RateValidationResult {
  const matchedRule = selectContractedRate(
    rules,
    input.modality,
    input.installments ?? 1,
    input.cardBrand,
  );

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
