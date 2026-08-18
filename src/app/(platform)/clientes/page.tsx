"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Pagination,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Stepper,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBuilding,
  IconChevronLeft,
  IconChevronRight,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";

type ReceiptRule =
  | "WITHOUT_ADVANCE"
  | "AUTOMATIC_ADVANCE"
  | "OCCASIONAL_ADVANCE";

type CategoryMappingType =
  | "SALES_REVENUE"
  | "MDR_FEES"
  | "ADVANCE_FEES"
  | "MACHINE_RENTAL_ADJUSTMENTS"
  | "SALE_CANCELLATION"
  | "REFUNDS_CREDITS";

type ClientAcquirer = {
  id: string;
  name: string;
  receiptRule: ReceiptRule;
  active: boolean;
};

type ClientCategoryMapping = {
  id: string;
  mappingType: CategoryMappingType;
  category: {
    id: string;
    name: string;
  };
  subcategory: {
    id: string;
    name: string;
  } | null;
};

type Client = {
  id: string;
  name: string;
  document: string;
  active: boolean;
  createdAt: string;
  acquirers: ClientAcquirer[];
  categoryMappings: ClientCategoryMapping[];
  banks: Array<{ id: string; active: boolean }>;
  cards: Array<{ id: string; active: boolean }>;
  _count: {
    imports: number;
  };
};

type ClientsResponse = {
  data: Client[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
  permission: {
    canDelete: boolean;
  };
};

type StatusFilter = "active" | "inactive" | "all";

type NewAcquirer = {
  id: string;
  name: string;
  receiptRule: ReceiptRule;
};

type NewCategoryMapping = {
  mappingType: CategoryMappingType;
  label: string;
  category: string;
  subcategory: string;
};

type TeamMember = {
  id: string;
  name: string | null;
  email: string;
};

type ClientSquad = "SQUAD_1" | "SQUAD_2";

const RECEIPT_RULE_OPTIONS = [
  {
    value: "WITHOUT_ADVANCE",
    label: "Sem antecipação",
  },
  {
    value: "AUTOMATIC_ADVANCE",
    label: "Antecipação automática",
  },
  {
    value: "OCCASIONAL_ADVANCE",
    label: "Antecipação eventual",
  },
];

const INITIAL_CATEGORY_MAPPINGS: NewCategoryMapping[] = [
  {
    mappingType: "SALES_REVENUE",
    label: "Receita de vendas",
    category: "",
    subcategory: "",
  },
  {
    mappingType: "MDR_FEES",
    label: "Taxas MDR",
    category: "",
    subcategory: "",
  },
  {
    mappingType: "ADVANCE_FEES",
    label: "Taxas de antecipação",
    category: "",
    subcategory: "",
  },
  {
    mappingType: "MACHINE_RENTAL_ADJUSTMENTS",
    label: "Aluguel de máquina e ajustes",
    category: "",
    subcategory: "",
  },
  {
    mappingType: "SALE_CANCELLATION",
    label: "Cancelamentos de vendas",
    category: "",
    subcategory: "",
  },
  {
    mappingType: "REFUNDS_CREDITS",
    label: "Estornos e créditos",
    category: "",
    subcategory: "",
  },
];

function createAcquirer(): NewAcquirer {
  return {
    id: crypto.randomUUID(),
    name: "",
    receiptRule: "WITHOUT_ADVANCE",
  };
}

function cleanDocument(value: string): string {
  return value.replace(/\D/g, "").slice(0, 14);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function formatCnpj(value: string): string {
  const numbers = cleanDocument(value);

  return numbers
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function isValidCnpj(value: string): boolean {
  const cnpj = cleanDocument(value);

  if (cnpj.length !== 14) {
    return false;
  }

  if (/^(\d)\1{13}$/.test(cnpj)) {
    return false;
  }

  function calculateDigit(base: string, weights: number[]) {
    const total = base.split("").reduce((sum, digit, index) => {
      return sum + Number(digit) * weights[index];
    }, 0);

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

type SetupStatus = {
  percentage: number;
  label: "Pendente" | "Parcial" | "Configurado";
  color: "red" | "yellow" | "green";
};

function getClientSetupStatus(client: Client): SetupStatus {
  const generalCompleted =
    client.name.trim().length >= 3 &&
    cleanDocument(client.document).length === 14;

  const acquirersCompleted = client.acquirers.length > 0;
  // Somente os tipos aplicáveis ao cliente são persistidos. Como todo vínculo
  // salvo já possui uma categoria válida, os tipos removidos não reduzem o
  // percentual de configuração.
  const categoryProgress = 1;
  const banksCompleted = client.banks.length > 0;
  const cardsCompleted = client.cards.length > 0;

  const percentage = Math.round(
    (generalCompleted ? 15 : 0) +
      (acquirersCompleted ? 20 : 0) +
      categoryProgress * 35 +
      (banksCompleted ? 15 : 0) +
      (cardsCompleted ? 15 : 0),
  );

  if (percentage === 100) {
    return { percentage, label: "Configurado", color: "green" };
  }

  if (percentage >= 40) {
    return { percentage, label: "Parcial", color: "yellow" };
  }

  return { percentage, label: "Pendente", color: "red" };
}

export default function ClientesPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] =
    useState<StatusFilter>("active");
  const [listStateReady, setListStateReady] = useState(false);

  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [canDeleteClients, setCanDeleteClients] = useState(false);
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null);

  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false,
  });

  const [modalOpened, setModalOpened] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [clientName, setClientName] = useState("");
  const [document, setDocument] = useState("");
  const [acquirers, setAcquirers] = useState<NewAcquirer[]>([
    createAcquirer(),
  ]);

  const [categoryMappings, setCategoryMappings] = useState<
    NewCategoryMapping[]
  >(INITIAL_CATEGORY_MAPPINGS.map((item) => ({ ...item })));
  const [categoryMappingToAdd, setCategoryMappingToAdd] =
    useState<CategoryMappingType | null>(null);

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [serviceSquad, setServiceSquad] =
    useState<ClientSquad | null>(null);
  const [operationLeaderId, setOperationLeaderId] =
    useState<string | null>(null);
  const [payableResponsibleId, setPayableResponsibleId] =
    useState<string | null>(null);
  const [receivableResponsibleId, setReceivableResponsibleId] =
    useState<string | null>(null);
  const [generalResponsibleId, setGeneralResponsibleId] =
    useState<string | null>(null);
  const [serviceAliases, setServiceAliases] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedPage = Number.parseInt(params.get("page") || "1", 10);
    const requestedSearch = params.get("search")?.trim() || "";
    const requestedStatus = params.get("status");

    setPage(Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1);
    setSearchInput(requestedSearch);
    setSearch(requestedSearch);
    setStatus(
      requestedStatus === "inactive" || requestedStatus === "all"
        ? requestedStatus
        : "active",
    );
    setListStateReady(true);
  }, []);

  useEffect(() => {
    if (!listStateReady) return;

    const timeout = window.setTimeout(() => {
      const nextSearch = searchInput.trim();
      if (nextSearch !== search) {
        setSearch(nextSearch);
        setPage(1);
      }
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [listStateReady, search, searchInput]);

  useEffect(() => {
    if (!listStateReady) return;

    const params = new URLSearchParams({
      page: String(page),
      status,
    });
    if (search) params.set("search", search);

    window.history.replaceState(
      window.history.state,
      "",
      `/clientes?${params.toString()}`,
    );
  }, [listStateReady, page, search, status]);

  useEffect(() => {
    if (!listStateReady) return;

    const controller = new AbortController();

    async function loadClients() {
      try {
        setLoading(true);
        setListError("");

        const params = new URLSearchParams({
          page: String(page),
          pageSize: "10",
          status,
        });

        if (search) {
          params.set("search", search);
        }

        const response = await fetch(
          `/api/clients?${params.toString()}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        const result = (await response.json()) as
          | ClientsResponse
          | { error?: string };

        if (!response.ok) {
          throw new Error(
            "error" in result && result.error
              ? result.error
              : "Não foi possível carregar os clientes.",
          );
        }

        const responseData = result as ClientsResponse;

        setClients(responseData.data);
        setPagination(responseData.pagination);
        setCanDeleteClients(Boolean(responseData.permission?.canDelete));
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }

        setClients([]);
        setListError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os clientes.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadClients();

    return () => controller.abort();
  }, [listStateReady, page, reloadKey, search, status]);

  const listReturnPath = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), status });
    if (search) params.set("search", search);
    return `/clientes?${params.toString()}`;
  }, [page, search, status]);

  const displayedClients = useMemo(() => {
    const normalizedSearch = normalizeSearchText(searchInput);
    const documentSearch = searchInput.replace(/\D/g, "");

    if (!normalizedSearch && !documentSearch) {
      return clients;
    }

    return clients.filter((client) => {
      const normalizedName = normalizeSearchText(client.name ?? "");
      const normalizedDocument = (client.document ?? "").replace(/\D/g, "");

      return (
        normalizedName.includes(normalizedSearch) ||
        (documentSearch.length > 0 && normalizedDocument.includes(documentSearch))
      );
    });
  }, [clients, searchInput]);

  const indicators = useMemo(() => {
    return {
      active: clients.filter((client) => client.active).length,
      acquirers: clients.reduce(
        (total, client) => total + client.acquirers.length,
        0,
      ),
      imports: clients.reduce(
        (total, client) => total + client._count.imports,
        0,
      ),
    };
  }, [clients]);

  const memberOptions = useMemo(
    () =>
      teamMembers.map((member) => ({
        value: member.id,
        label: member.name || member.email,
      })),
    [teamMembers],
  );

  function memberLabel(userId: string | null): string {
    if (!userId) return "Não definido";

    const member = teamMembers.find((item) => item.id === userId);
    return member?.name || member?.email || "Não definido";
  }

  function resetForm() {
    setActiveStep(0);
    setFormError("");
    setClientName("");
    setDocument("");
    setAcquirers([createAcquirer()]);
    setCategoryMappings(
      INITIAL_CATEGORY_MAPPINGS.map((item) => ({
        ...item,
      })),
    );
    setCategoryMappingToAdd(null);
    setTeamError("");
    setServiceSquad(null);
    setOperationLeaderId(null);
    setPayableResponsibleId(null);
    setReceivableResponsibleId(null);
    setGeneralResponsibleId(null);
    setServiceAliases("");
  }

  async function loadTeamMembers() {
    try {
      setLoadingTeam(true);
      setTeamError("");

      const response = await fetch(
        "/api/atendimento/routing/clients",
        { cache: "no-store" },
      );
      const result = (await response.json()) as {
        members?: TeamMember[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          result.error || "Não foi possível carregar a equipe.",
        );
      }

      setTeamMembers(result.members || []);
    } catch (error) {
      setTeamMembers([]);
      setTeamError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar a equipe.",
      );
    } finally {
      setLoadingTeam(false);
    }
  }

  function openNewClientModal() {
    resetForm();
    setModalOpened(true);
    void loadTeamMembers();
  }

  function closeModal() {
    if (saving) {
      return;
    }

    setModalOpened(false);
    resetForm();
  }

  function updateAcquirer(
    id: string,
    field: "name" | "receiptRule",
    value: string,
  ) {
    setAcquirers((current) =>
      current.map((acquirer) =>
        acquirer.id === id
          ? {
              ...acquirer,
              [field]: value,
            }
          : acquirer,
      ),
    );
  }

  function addAcquirer() {
    setAcquirers((current) => [
      ...current,
      createAcquirer(),
    ]);
  }

  function removeAcquirer(id: string) {
    setAcquirers((current) => {
      if (current.length === 1) {
        return current;
      }

      return current.filter(
        (acquirer) => acquirer.id !== id,
      );
    });
  }

  function updateCategoryMapping(
    mappingType: CategoryMappingType,
    field: "category" | "subcategory",
    value: string,
  ) {
    setCategoryMappings((current) =>
      current.map((mapping) =>
        mapping.mappingType === mappingType
          ? {
              ...mapping,
              [field]: value,
            }
          : mapping,
      ),
    );
  }

  function removeCategoryMapping(mappingType: CategoryMappingType) {
    setCategoryMappings((current) =>
      current.filter((mapping) => mapping.mappingType !== mappingType),
    );
  }

  function addCategoryMapping() {
    if (!categoryMappingToAdd) return;

    const mapping = INITIAL_CATEGORY_MAPPINGS.find(
      (item) => item.mappingType === categoryMappingToAdd,
    );

    if (!mapping) return;

    setCategoryMappings((current) =>
      [...current, { ...mapping }].sort(
        (first, second) =>
          INITIAL_CATEGORY_MAPPINGS.findIndex(
            (item) => item.mappingType === first.mappingType,
          ) -
          INITIAL_CATEGORY_MAPPINGS.findIndex(
            (item) => item.mappingType === second.mappingType,
          ),
      ),
    );
    setCategoryMappingToAdd(null);
  }

  function validateCurrentStep(): boolean {
    setFormError("");

    if (activeStep === 0) {
      if (clientName.trim().length < 3) {
        setFormError(
          "Informe um nome com pelo menos 3 caracteres.",
        );
        return false;
      }

      if (!isValidCnpj(document)) {
        setFormError("Informe um CNPJ válido.");
        return false;
      }
    }

    if (activeStep === 1) {
      if (acquirers.length === 0) {
        setFormError(
          "Adicione pelo menos uma adquirente.",
        );
        return false;
      }

      const invalidAcquirer = acquirers.find(
        (acquirer) => acquirer.name.trim().length < 2,
      );

      if (invalidAcquirer) {
        setFormError(
          "Informe o nome de todas as adquirentes.",
        );
        return false;
      }

      const normalizedNames = acquirers.map((acquirer) =>
        acquirer.name.trim().toLowerCase(),
      );

      if (
        new Set(normalizedNames).size !==
        normalizedNames.length
      ) {
        setFormError(
          "A mesma adquirente não pode ser adicionada duas vezes.",
        );
        return false;
      }
    }

    if (activeStep === 2) {
      const invalidMapping = categoryMappings.find(
        (mapping) => mapping.category.trim().length < 2,
      );

      if (invalidMapping) {
        setFormError(
          `Informe a categoria de "${invalidMapping.label}".`,
        );
        return false;
      }
    }

    return true;
  }

  function nextStep() {
    if (!validateCurrentStep()) {
      return;
    }

    setActiveStep((current) =>
      Math.min(current + 1, 4),
    );
  }

  function previousStep() {
    setFormError("");
    setActiveStep((current) =>
      Math.max(current - 1, 0),
    );
  }

  async function saveClient() {
    if (!validateCurrentStep()) {
      return;
    }

    try {
      setSaving(true);
      setFormError("");

      const payload = {
        name: clientName.trim(),
        document: cleanDocument(document),

        acquirers: acquirers.map((acquirer) => ({
          name: acquirer.name.trim(),
          receiptRule: acquirer.receiptRule,
        })),

        categoryMappings: categoryMappings.map(
          (mapping) => ({
            mappingType: mapping.mappingType,
            category: mapping.category.trim(),
            subcategory:
              mapping.subcategory.trim() || null,
          }),
        ),

        serviceSquad,
        operationLeaderId,
        payableResponsibleId,
        receivableResponsibleId,
        generalResponsibleId,
        serviceAliases: serviceAliases.trim() || null,
      };

      const response = await fetch("/api/clients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(
          result.error ||
            "Não foi possível cadastrar o cliente.",
        );
      }

      notifications.show({
        color: "green",
        title: "Cliente cadastrado",
        message:
          result.message ||
          "O cliente foi cadastrado com sucesso.",
      });

      setModalOpened(false);
      resetForm();
      setPage(1);
      setReloadKey((current) => current + 1);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Não foi possível cadastrar o cliente.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteClient(client: Client) {
    const confirmed = window.confirm(
      `Excluir ${client.name} da operação ativa?\n\nO cliente deixará de aparecer na lista de ativos e suas rotinas futuras serão interrompidas. Importações, atividades e históricos já registrados serão preservados.`,
    );

    if (!confirmed) return;

    setDeletingClientId(client.id);
    setListError("");

    try {
      const response = await fetch(`/api/clients/${client.id}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || "Não foi possível excluir o cliente.");
      }

      notifications.show({
        color: "green",
        title: "Cliente excluído",
        message: result.message || "O cliente foi retirado da operação ativa.",
      });
      setReloadKey((current) => current + 1);
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : "Não foi possível excluir o cliente.",
      );
    } finally {
      setDeletingClientId(null);
    }
  }

  return (
    <>
      <Stack gap="xl">
        <Group
          justify="space-between"
          align="flex-end"
          gap="lg"
        >
          <Stack gap={4}>
            <Text
              size="xs"
              fw={800}
              c="blue"
              tt="uppercase"
            >
              Cadastros
            </Text>

            <Title order={2}>Clientes</Title>

            <Text c="dimmed">
              Cadastre e configure os clientes utilizados nos
              processamentos do ConvertNow.
            </Text>
          </Stack>

          <Button
            leftSection={<IconPlus size={18} />}
            onClick={openNewClientModal}
          >
            Novo cliente
          </Button>
        </Group>

        <SimpleGrid
          cols={{
            base: 1,
            sm: 2,
            xl: 4,
          }}
        >
          <Paper withBorder radius="lg" p="lg">
            <Text size="sm" c="dimmed">
              Clientes encontrados
            </Text>

            <Text fw={800} fz={28}>
              {pagination.total}
            </Text>
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Text size="sm" c="dimmed">
              Ativos nesta página
            </Text>

            <Text fw={800} fz={28}>
              {indicators.active}
            </Text>
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Text size="sm" c="dimmed">
              Adquirentes configuradas
            </Text>

            <Text fw={800} fz={28}>
              {indicators.acquirers}
            </Text>
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Text size="sm" c="dimmed">
              Importações
            </Text>

            <Text fw={800} fz={28}>
              {indicators.imports}
            </Text>
          </Paper>
        </SimpleGrid>

        <Paper withBorder radius="lg">
          <Group
            justify="space-between"
            p="lg"
            gap="md"
          >
            <TextInput
              value={searchInput}
              onChange={(event) =>
                setSearchInput(event.currentTarget.value)
              }
              placeholder="Pesquisar por nome ou CNPJ..."
              leftSection={<IconSearch size={17} />}
              style={{
                flex: 1,
                minWidth: 260,
              }}
            />

            <Group>
              <Select
                value={status}
                onChange={(value) => {
                  setStatus(
                    (value as StatusFilter | null) ??
                      "active",
                  );
                  setPage(1);
                }}
                data={[
                  {
                    value: "active",
                    label: "Clientes ativos",
                  },
                  {
                    value: "inactive",
                    label: "Clientes inativos",
                  },
                  {
                    value: "all",
                    label: "Todos os clientes",
                  },
                ]}
                allowDeselect={false}
                w={200}
              />

              <ActionIcon
                variant="default"
                size={36}
                onClick={() =>
                  setReloadKey((current) => current + 1)
                }
                aria-label="Atualizar clientes"
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Group>
          </Group>

          {listError && (
            <Alert color="red" mx="lg" mb="lg">
              {listError}
            </Alert>
          )}

          {loading ? (
            <Group justify="center" py={70}>
              <Loader />
              <Text c="dimmed">
                Carregando clientes...
              </Text>
            </Group>
          ) : displayedClients.length === 0 ? (
            <Stack align="center" py={70}>
              <IconBuilding size={44} stroke={1.5} />

              <Text fw={700} fz="lg">
                Nenhum cliente cadastrado
              </Text>

              <Text c="dimmed" ta="center">
                Cadastre o primeiro cliente para começar a
                utilizar os módulos do ConvertNow.
              </Text>

              <Button
                leftSection={<IconPlus size={18} />}
                onClick={openNewClientModal}
              >
                Cadastrar cliente
              </Button>
            </Stack>
          ) : (
            <>
              <Table.ScrollContainer minWidth={900}>
                <Table
                  highlightOnHover
                  verticalSpacing="md"
                  horizontalSpacing="lg"
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Cliente</Table.Th>
                      <Table.Th>Adquirentes</Table.Th>
                      <Table.Th>Categorias</Table.Th>
                      <Table.Th>Importações</Table.Th>
                      <Table.Th>Implantação</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th ta="right">Ações</Table.Th>
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {displayedClients.map((client) => {
                      const setup = getClientSetupStatus(client);

                      return (
                      <Table.Tr key={client.id}>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text fw={700}>
                              {client.name}
                            </Text>

                            <Text size="xs" c="dimmed">
                              {formatCnpj(client.document)}
                            </Text>
                          </Stack>
                        </Table.Td>

                        <Table.Td>
                          <Group gap={6}>
                            {client.acquirers.length === 0 ? (
                              <Text size="sm" c="dimmed">
                                Não configuradas
                              </Text>
                            ) : (
                              client.acquirers.map(
                                (acquirer) => (
                                  <Badge
                                    key={acquirer.id}
                                    variant="light"
                                  >
                                    {acquirer.name}
                                  </Badge>
                                ),
                              )
                            )}
                          </Group>
                        </Table.Td>

                        <Table.Td>
                          {client.categoryMappings.length}
                        </Table.Td>

                        <Table.Td>
                          {client._count.imports}
                        </Table.Td>

                        <Table.Td>
                          <Stack gap={6} miw={150}>
                            <Group justify="space-between" gap="xs">
                              <Badge color={setup.color} variant="light">
                                {setup.label}
                              </Badge>

                              <Text size="xs" fw={700}>
                                {setup.percentage}%
                              </Text>
                            </Group>

                            <Progress
                              value={setup.percentage}
                              color={setup.color}
                              size="sm"
                              radius="xl"
                            />
                          </Stack>
                        </Table.Td>

                        <Table.Td>
                          <Badge
                            color={client.active ? "green" : "gray"}
                            variant="light"
                          >
                            {client.active ? "Ativo" : "Inativo"}
                          </Badge>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Group gap={6} justify="flex-end" wrap="nowrap">
                            <Button
                              component={Link}
                              href={
                                `/clientes/${client.id}?returnTo=${encodeURIComponent(listReturnPath)}` as Route
                              }
                              variant="light"
                              size="xs"
                              leftSection={<IconPencil size={15} />}
                            >
                              Editar
                            </Button>
                            {canDeleteClients && client.active && (
                              <ActionIcon
                                color="red"
                                variant="light"
                                size={30}
                                loading={deletingClientId === client.id}
                                onClick={() => void deleteClient(client)}
                                aria-label={`Excluir cliente ${client.name}`}
                                title="Excluir cliente"
                              >
                                <IconTrash size={15} />
                              </ActionIcon>
                            )}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>

              <Group
                justify="space-between"
                p="lg"
                style={{
                  borderTop:
                    "1px solid var(--mantine-color-gray-2)",
                }}
              >
                <Text size="sm" c="dimmed">
                  {pagination.total} cliente(s)
                </Text>

                <Pagination
                  value={page}
                  onChange={setPage}
                  total={pagination.totalPages}
                />
              </Group>
            </>
          )}
        </Paper>
      </Stack>

      <Modal
        opened={modalOpened}
        onClose={closeModal}
        title="Novo cliente"
        size="xl"
        centered
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
      >
        <Stack gap="xl">
          <Stepper
            active={activeStep}
            onStepClick={(step) => {
              if (step < activeStep) {
                setActiveStep(step);
                setFormError("");
              }
            }}
          >
            <Stepper.Step label="Dados gerais" />

            <Stepper.Step label="Adquirentes" />

            <Stepper.Step label="Categorias" />

            <Stepper.Step label="Equipe e e-mails" />

            <Stepper.Step label="Revisão" />
          </Stepper>

          <Divider />

          {formError && (
            <Alert color="red">{formError}</Alert>
          )}

          {activeStep === 0 && (
            <Stack>
              <TextInput
                label="Nome do cliente"
                placeholder="Ex.: Empresa Exemplo Ltda."
                value={clientName}
                onChange={(event) =>
                  setClientName(event.currentTarget.value)
                }
                required
              />

              <TextInput
                label="CNPJ"
                placeholder="00.000.000/0000-00"
                value={document}
                onChange={(event) =>
                  setDocument(
                    formatCnpj(event.currentTarget.value),
                  )
                }
                required
              />
            </Stack>
          )}

          {activeStep === 1 && (
            <Stack>
              <Group justify="space-between">
                <Stack gap={0}>
                  <Text fw={700}>
                    Adquirentes do cliente
                  </Text>

                  <Text size="sm" c="dimmed">
                    Informe as adquirentes e a regra de
                    recebimento utilizada.
                  </Text>
                </Stack>

                <Button
                  variant="light"
                  leftSection={<IconPlus size={16} />}
                  onClick={addAcquirer}
                >
                  Adicionar adquirente
                </Button>
              </Group>

              {acquirers.map((acquirer, index) => (
                <Paper
                  key={acquirer.id}
                  withBorder
                  radius="md"
                  p="md"
                >
                  <Group align="flex-end">
                    <TextInput
                      label={`Adquirente ${index + 1}`}
                      placeholder="Cielo, Rede, Stone..."
                      value={acquirer.name}
                      onChange={(event) =>
                        updateAcquirer(
                          acquirer.id,
                          "name",
                          event.currentTarget.value,
                        )
                      }
                      style={{ flex: 1 }}
                    />

                    <Select
                      label="Regra de recebimento"
                      value={acquirer.receiptRule}
                      data={RECEIPT_RULE_OPTIONS}
                      onChange={(value) =>
                        updateAcquirer(
                          acquirer.id,
                          "receiptRule",
                          value || "WITHOUT_ADVANCE",
                        )
                      }
                      allowDeselect={false}
                      w={250}
                    />

                    <ActionIcon
                      color="red"
                      variant="light"
                      size={36}
                      disabled={acquirers.length === 1}
                      onClick={() =>
                        removeAcquirer(acquirer.id)
                      }
                      aria-label="Remover adquirente"
                    >
                      <IconTrash size={17} />
                    </ActionIcon>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}

          {activeStep === 2 && (
            <Stack>
              <Stack gap={0}>
                <Text fw={700}>
                  Categorias do Conta Azul
                </Text>

                <Text size="sm" c="dimmed">
                  Mantenha somente os tipos de movimentação que se aplicam a
                  este cliente. Os itens removidos não afetarão outros
                  clientes.
                </Text>
              </Stack>

              <Paper withBorder radius="md" p="md" bg="var(--mantine-color-gray-0)">
                <Group align="flex-end">
                  <Select
                    label="Adicionar categoria aplicável"
                    placeholder={
                      categoryMappings.length < INITIAL_CATEGORY_MAPPINGS.length
                        ? "Selecione o tipo"
                        : "Todos os tipos já foram adicionados"
                    }
                    data={INITIAL_CATEGORY_MAPPINGS.filter(
                      (option) =>
                        !categoryMappings.some(
                          (mapping) => mapping.mappingType === option.mappingType,
                        ),
                    ).map((option) => ({
                      value: option.mappingType,
                      label: option.label,
                    }))}
                    value={categoryMappingToAdd}
                    onChange={(value) =>
                      setCategoryMappingToAdd(value as CategoryMappingType | null)
                    }
                    disabled={
                      categoryMappings.length === INITIAL_CATEGORY_MAPPINGS.length
                    }
                    flex={1}
                  />
                  <Button
                    variant="light"
                    leftSection={<IconPlus size={16} />}
                    disabled={!categoryMappingToAdd}
                    onClick={addCategoryMapping}
                  >
                    Adicionar
                  </Button>
                </Group>
              </Paper>

              {categoryMappings.length === 0 && (
                <Alert color="blue">
                  Nenhuma categoria operacional será aplicada a este cliente.
                </Alert>
              )}

              {categoryMappings.map((mapping) => (
                <Paper
                  key={mapping.mappingType}
                  withBorder
                  radius="md"
                  p="md"
                >
                  <Group justify="space-between" mb="sm">
                    <Text fw={700}>
                      {mapping.label}
                    </Text>
                    <Button
                      variant="subtle"
                      color="red"
                      size="xs"
                      leftSection={<IconTrash size={15} />}
                      onClick={() =>
                        removeCategoryMapping(mapping.mappingType)
                      }
                    >
                      Não se aplica
                    </Button>
                  </Group>

                  <SimpleGrid
                    cols={{
                      base: 1,
                      sm: 2,
                    }}
                  >
                    <TextInput
                      label="Categoria"
                      placeholder="Ex.: Receita de vendas"
                      value={mapping.category}
                      onChange={(event) =>
                        updateCategoryMapping(
                          mapping.mappingType,
                          "category",
                          event.currentTarget.value,
                        )
                      }
                      required
                    />

                    <TextInput
                      label="Subcategoria"
                      placeholder="Opcional"
                      value={mapping.subcategory}
                      onChange={(event) =>
                        updateCategoryMapping(
                          mapping.mappingType,
                          "subcategory",
                          event.currentTarget.value,
                        )
                      }
                    />
                  </SimpleGrid>
                </Paper>
              ))}
            </Stack>
          )}

          {activeStep === 3 && (
            <Stack>
              <Group justify="space-between" align="flex-start">
                <Stack gap={0}>
                  <Group gap="xs">
                    <IconRoute size={20} />
                    <Text fw={700}>Equipe e distribuição de e-mails</Text>
                  </Group>

                  <Text size="sm" c="dimmed">
                    Defina quem receberá automaticamente os e-mails deste
                    cliente. Os campos podem ser preenchidos depois.
                  </Text>
                </Stack>

                {loadingTeam && <Loader size="sm" />}
              </Group>

              {teamError && (
                <Alert color="yellow">
                  {teamError} Você ainda pode cadastrar o cliente e configurar
                  a equipe posteriormente.
                </Alert>
              )}

              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select
                  label="Equipe / Squad"
                  description="Equipe operacional principal do cliente."
                  clearable
                  data={[
                    { value: "SQUAD_1", label: "Squad 1" },
                    { value: "SQUAD_2", label: "Squad 2" },
                  ]}
                  value={serviceSquad}
                  onChange={(value) =>
                    setServiceSquad(value as ClientSquad | null)
                  }
                />

                <Select
                  label="Líder"
                  description="Supervisiona a operação deste cliente."
                  searchable
                  clearable
                  disabled={loadingTeam}
                  data={memberOptions}
                  value={operationLeaderId}
                  onChange={setOperationLeaderId}
                />

                <Select
                  label="Responsável por Contas a Pagar"
                  description="Recebe boletos, notas, fornecedores e pagamentos."
                  searchable
                  clearable
                  disabled={loadingTeam}
                  data={memberOptions}
                  value={payableResponsibleId}
                  onChange={setPayableResponsibleId}
                />

                <Select
                  label="Responsável por Contas a Receber"
                  description="Recebe cobranças, recebimentos e adquirentes."
                  searchable
                  clearable
                  disabled={loadingTeam}
                  data={memberOptions}
                  value={receivableResponsibleId}
                  onChange={setReceivableResponsibleId}
                />

                <Select
                  label="Responsável geral / fallback"
                  description="Recebe assuntos gerais ou sem área confirmada."
                  searchable
                  clearable
                  disabled={loadingTeam}
                  data={memberOptions}
                  value={generalResponsibleId}
                  onChange={setGeneralResponsibleId}
                />
              </SimpleGrid>

              <Textarea
                label="Nomes usados para identificar o cliente"
                description="Informe nome fantasia, abreviações e outros nomes que podem aparecer no assunto, corpo, assinatura ou anexo."
                minRows={3}
                value={serviceAliases}
                onChange={(event) =>
                  setServiceAliases(event.currentTarget.value)
                }
                placeholder={"Ex.: Abismo\nAbismo Anhumas\nAnhumas Turismo"}
              />
            </Stack>
          )}

          {activeStep === 4 && (
            <Stack>
              <Title order={4}>Revisão do cadastro</Title>

              <Paper withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Text>
                    <strong>Cliente:</strong>{" "}
                    {clientName}
                  </Text>

                  <Text>
                    <strong>CNPJ:</strong>{" "}
                    {formatCnpj(document)}
                  </Text>

                  <Text>
                    <strong>Adquirentes:</strong>{" "}
                    {acquirers
                      .map((acquirer) => acquirer.name)
                      .join(", ")}
                  </Text>

                  <Text>
                    <strong>Categorias:</strong>{" "}
                    {categoryMappings.length} mapeamentos
                  </Text>

                  <Divider />

                  <Text>
                    <strong>Equipe:</strong>{" "}
                    {serviceSquad === "SQUAD_1"
                      ? "Squad 1"
                      : serviceSquad === "SQUAD_2"
                        ? "Squad 2"
                        : "Não definida"}
                  </Text>

                  <Text>
                    <strong>Líder:</strong>{" "}
                    {memberLabel(operationLeaderId)}
                  </Text>

                  <Text>
                    <strong>Contas a Pagar:</strong>{" "}
                    {memberLabel(payableResponsibleId)}
                  </Text>

                  <Text>
                    <strong>Contas a Receber:</strong>{" "}
                    {memberLabel(receivableResponsibleId)}
                  </Text>

                  <Text>
                    <strong>Geral / fallback:</strong>{" "}
                    {memberLabel(generalResponsibleId)}
                  </Text>
                </Stack>
              </Paper>

              <Stack gap="xs">
                {acquirers.map((acquirer) => (
                  <Paper
                    key={acquirer.id}
                    withBorder
                    radius="md"
                    p="sm"
                  >
                    <Group justify="space-between">
                      <Text fw={600}>
                        {acquirer.name}
                      </Text>

                      <Badge variant="light">
                        {
                          RECEIPT_RULE_OPTIONS.find(
                            (option) =>
                              option.value ===
                              acquirer.receiptRule,
                          )?.label
                        }
                      </Badge>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          )}

          <Divider />

          <Group justify="space-between">
            <Button
              variant="default"
              onClick={
                activeStep === 0
                  ? closeModal
                  : previousStep
              }
              leftSection={
                activeStep > 0 ? (
                  <IconChevronLeft size={17} />
                ) : undefined
              }
              disabled={saving}
            >
              {activeStep === 0 ? "Cancelar" : "Voltar"}
            </Button>

            {activeStep < 4 ? (
              <Button
                onClick={nextStep}
                rightSection={
                  <IconChevronRight size={17} />
                }
              >
                Continuar
              </Button>
            ) : (
              <Button
                onClick={saveClient}
                loading={saving}
              >
                Salvar cliente
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
