import { z } from "zod";

const itemSchema = z.object({
  id: z.number(), date: z.string(), description: z.string(), amount: z.number(),
  installment: z.string().optional(), category: z.string().nullable(), costCenter: z.string().nullable(),
  financialAccountId: z.string().nullable().optional(), financialAccountName: z.string().nullable().optional(),
  destinationClientId: z.string().nullable().optional(), destinationClientName: z.string().nullable().optional(),
  status: z.enum(["LEARNED", "NEW", "REVIEW", "CORRECTED"]),
  learnedFromClient: z.boolean(), costCenterLearnedFromClient: z.boolean(),
});

export const invoiceDraftSchema = z.object({
  version: z.literal(1), savedAt: z.string(), clientId: z.string(), bank: z.string(),
  sourceFiles: z.array(z.object({ name: z.string(), size: z.number(), lastModified: z.number(), type: z.string() })).min(1),
  items: z.array(itemSchema), deletedItems: z.array(itemSchema),
  competenceDate: z.string(), dueDate: z.string(), paymentDate: z.string(),
  invoiceTotal: z.union([z.number(), z.string()]), parseWarnings: z.array(z.string()),
  useCostCenters: z.boolean(), useLineAccounts: z.boolean(),
  defaultAccountId: z.string().nullable(), defaultDestinationId: z.string().nullable(),
  search: z.string(), showOnlyUncategorized: z.boolean(),
  selectedItem: itemSchema.nullable(), editModalOpened: z.boolean(), learnForClient: z.boolean(),
});

export type InvoiceDraft = z.infer<typeof invoiceDraftSchema>;
export type InvoiceItem = z.infer<typeof itemSchema>;
export type InvoiceSourceFile = InvoiceDraft["sourceFiles"][number];

export function invoiceDraftKey(organizationId: string, userId: string) {
  return `fortuno:invoice-draft:v1:${encodeURIComponent(organizationId)}:${encodeURIComponent(userId)}`;
}

export function readInvoiceDraft(value: string | null): InvoiceDraft | null {
  if (!value) return null;
  const parsed = invoiceDraftSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error("Rascunho incompatível ou danificado. Descarte-o para iniciar outra fatura.");
  return parsed.data;
}

export function restoreInvoiceItem(items: InvoiceItem[], deletedItems: InvoiceItem[], id: number) {
  const restored = deletedItems.find((item) => item.id === id);
  return {
    items: restored && !items.some((item) => item.id === id)
      ? [...items, restored].sort((a, b) => a.id - b.id) : items,
    deletedItems: deletedItems.filter((item) => item.id !== id),
  };
}
