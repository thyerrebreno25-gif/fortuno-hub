export const INVOICE_SEND_PENDING = "Envio em conferência: a despesa pode já ter sido criada no Conta Azul. Confira antes de qualquer novo envio.";
export function requiresInvoiceVerification(error: string | null | undefined) {
  return Boolean(error?.includes("não devolveu o protocolo da despesa") || error?.startsWith("Envio em conferência:"));
}
