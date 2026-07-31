export type CurrencyOption = {
  symbol: string;
  name: string;
  type: string | null;
};

export type CurrencyTransaction = {
  id: string;
  date: string;
  description: string;
  originalAmount: number;
  currency: string;
  rate: number | null;
  rateDate: string | null;
  rateSource: string | null;
  convertedAmount: number | null;
  type: "CREDIT" | "DEBIT";
  status: "PENDING" | "CONVERTED" | "ERROR";
  warning?: string;
};

export type ExchangeRateResponse = {
  currency: string;
  requestedDate: string;
  rateDate: string;
  buyRate: number;
  sellRate: number;
  source: string;
  usedPreviousBusinessDay: boolean;
};
