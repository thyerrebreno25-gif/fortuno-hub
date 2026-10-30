export const acquirerMappingTypes = ["SALES_REVENUE", "MDR_FEES", "ADVANCE_FEES", "MACHINE_RENTAL_ADJUSTMENTS", "SALE_CANCELLATION", "REFUNDS_CREDITS"] as const;
export type AcquirerMappingType = typeof acquirerMappingTypes[number];
export function acquirerMappingType(metadata?: Record<string, unknown>): AcquirerMappingType | null {
    switch (metadata?.eventType) {
        case "SALE": return "SALES_REVENUE";
        case "FEE": return "MDR_FEES";
        case "ANTICIPATION": return "ADVANCE_FEES";
        case "CANCELLATION": return "SALE_CANCELLATION";
        case "CHARGEBACK": return "REFUNDS_CREDITS";
        case "ADJUSTMENT":
            if (metadata.feeCategory === "CANCELLATION")
                return "SALE_CANCELLATION";
            if (metadata.feeCategory === "CHARGEBACK")
                return "REFUNDS_CREDITS";
            return "MACHINE_RENTAL_ADJUSTMENTS";
        default: return null;
    }
}
