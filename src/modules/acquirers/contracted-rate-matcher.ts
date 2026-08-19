export type ContractedRateMatcherRule = {
  modality: string;
  installments: number | null;
  cardBrand: string | null;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeModality(value: unknown) {
  const normalized = normalize(value);

  if (normalized.includes("pix")) return "PIX";
  if (normalized === "debit" || normalized.includes("debito")) return "DEBIT";
  if (
    normalized === "credit"
    || normalized.includes("credito")
    || normalized.includes("parcelad")
  ) return "CREDIT";
  if (normalized.includes("voucher")) return "VOUCHER";
  if (normalized === "other" || normalized.includes("outro")) return "OTHER";

  return normalized.toUpperCase();
}

function normalizeBrand(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]/g, "").toUpperCase();
}

function isGeneralBrand(value: unknown) {
  const brand = normalizeBrand(value);
  return !brand || brand === "TODAS" || brand === "TODOS" || brand === "ALL";
}

/**
 * Encontra a taxa da faixa aplicável. Em crédito parcelado, `installments`
 * representa o limite superior da faixa: 6 cobre até 6x e a próxima regra,
 * por exemplo 36, passa a cobrir de 7x em diante.
 *
 * A última faixa também funciona como fallback para manter compatibilidade
 * com as regras antigas, que salvavam todo parcelado como `2`.
 */
export function selectContractedRate<T extends ContractedRateMatcherRule>(
  rates: T[],
  modality: unknown,
  installments: unknown,
  cardBrand: unknown,
): T | null {
  const normalizedModality = normalizeModality(modality);
  const actualInstallments = Math.max(
    1,
    Math.trunc(Number(installments) || 1),
  );
  const modalityRates = rates.filter(
    (rate) => normalizeModality(rate.modality) === normalizedModality,
  );
  const normalizedBrand = normalizeBrand(cardBrand);
  const applicableRates = modalityRates.filter(
    (rate) =>
      isGeneralBrand(rate.cardBrand)
      || (
        normalizedBrand
        && normalizeBrand(rate.cardBrand) === normalizedBrand
      ),
  );

  let candidates: T[];

  if (normalizedModality === "CREDIT" && actualInstallments > 1) {
    const installmentRates = applicableRates.filter(
      (rate) => Number(rate.installments) > 1,
    );

    if (installmentRates.length > 0) {
      const caps = Array.from(
        new Set(installmentRates.map((rate) => Number(rate.installments))),
      ).sort((left, right) => left - right);
      const selectedCap = caps.find((cap) => cap >= actualInstallments)
        ?? caps[caps.length - 1];

      candidates = installmentRates.filter(
        (rate) => Number(rate.installments) === selectedCap,
      );
    } else {
      candidates = applicableRates.filter((rate) => rate.installments == null);
    }
  } else {
    candidates = applicableRates.filter(
      (rate) => rate.installments == null || Number(rate.installments) <= 1,
    );
  }

  const specific = normalizedBrand
    ? candidates.find(
        (rate) =>
          !isGeneralBrand(rate.cardBrand)
          && normalizeBrand(rate.cardBrand) === normalizedBrand,
      )
    : undefined;
  const general = candidates.find((rate) => isGeneralBrand(rate.cardBrand));

  return specific ?? general ?? null;
}
