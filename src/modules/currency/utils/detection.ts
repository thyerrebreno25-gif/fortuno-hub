const CURRENCY_ALIASES: Array<[RegExp, string]> = [
  [/\b(USD|US\$|U\$|D[ÓO]LAR(?:ES)?|DOLLARS?|UNITED STATES DOLLAR)\b/i, "USD"],
  [/\b(EUR|€|EUROS?|EUROZONE)\b/i, "EUR"],
  [/\b(GBP|£|LIBRAS? ESTERLINAS?|POUNDS?|STERLING)\b/i, "GBP"],
  [/\b(JPY|¥|IENE|YEN)\b/i, "JPY"],
  [/\b(CHF|FRANCO SU[IÍ]ÇO|SWISS FRANC)\b/i, "CHF"],
  [/\b(CAD|D[ÓO]LAR CANADENSE|CANADIAN DOLLAR)\b/i, "CAD"],
  [/\b(AUD|D[ÓO]LAR AUSTRALIANO|AUSTRALIAN DOLLAR)\b/i, "AUD"],
  [/\b(CNY|RMB|YUAN|RENMINBI)\b/i, "CNY"],
  [/\b(ARS|PESO ARGENTINO)\b/i, "ARS"],
  [/\b(CLP|PESO CHILENO)\b/i, "CLP"],
  [/\b(MXN|PESO MEXICANO)\b/i, "MXN"],
  [/\b(UYU|PESO URUGUAIO)\b/i, "UYU"],
  [/\b(PYG|GUARANI|GUARAN[IÍ])\b/i, "PYG"],
];

export function detectCurrency(text: string): string | null {
  for (const [pattern, currency] of CURRENCY_ALIASES) {
    if (pattern.test(text)) return currency;
  }
  return null;
}

export function inferTransactionType(
  description: string,
  amount: number,
): "CREDIT" | "DEBIT" {
  const text = description.toLowerCase();

  if (
    /\b(entrada|cr[eé]dito|credit|received|recebimento|deposit|refund)\b/.test(text)
  ) {
    return "CREDIT";
  }

  if (
    /\b(sa[ií]da|d[eé]bito|debit|purchase|compra|pagamento|fee|taxa|withdrawal)\b/.test(text)
  ) {
    return "DEBIT";
  }

  return amount < 0 ? "DEBIT" : "CREDIT";
}
