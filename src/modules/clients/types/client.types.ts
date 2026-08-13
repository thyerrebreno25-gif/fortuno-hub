export type AcquirerReceiptRule =
  | "WITHOUT_ADVANCE"
  | "AUTOMATIC_ADVANCE"
  | "OCCASIONAL_ADVANCE";

export type CategoryMappingType =
  | "SALES_REVENUE"
  | "MDR_FEES"
  | "ADVANCE_FEES"
  | "MACHINE_RENTAL_ADJUSTMENTS"
  | "SALE_CANCELLATION"
  | "REFUNDS_CREDITS";

export type ClientSquad = "SQUAD_1" | "SQUAD_2";

export type ClientAcquirerInput = {
  name: string;
  receiptRule: AcquirerReceiptRule;
};

export type ClientCategoryMappingInput = {
  mappingType: CategoryMappingType;
  category: string;
  subcategory?: string | null;
};

export type CreateClientInput = {
  name: string;
  document: string;
  acquirers: ClientAcquirerInput[];
  categoryMappings: ClientCategoryMappingInput[];
  serviceSquad: ClientSquad | null;
  operationLeaderId: string | null;
  payableResponsibleId: string | null;
  receivableResponsibleId: string | null;
  generalResponsibleId: string | null;
  serviceAliases: string | null;
};

export type ListClientsInput = {
  organizationId: string;
  search?: string;
  status?: "active" | "inactive" | "all";
  page: number;
  pageSize: number;
};

export type AuthenticatedMember = {
  userId: string;
  organizationId: string;
  role: "MASTER" | "ADMIN" | "MANAGER" | "OPERATOR" | "CLIENT";
};
