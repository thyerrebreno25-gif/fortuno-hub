"use client";

import { useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconBuilding,
  IconBuildingBank,
  IconCash,
  IconCategory,
  IconCreditCard,
  IconCircleCheck,
  IconAlertTriangle,
  IconCircleX,
  IconRoute,
} from "@tabler/icons-react";
import { ClientGeneralTab } from "@/modules/clients/components/client-general-tab";
import { ClientRoutingTab } from "@/modules/clients/components/client-routing-tab";
import {
  ClientAcquirersTab,
  type EditableAcquirer,
  type EditableAcquirerRate,
  type RateModality,
  type ReceiptRule,
} from "@/modules/clients/components/client-acquirers-tab";
import {
  CATEGORY_MAPPING_TYPES,
  ClientCategoriesTab,
  type CategoryMappingType,
  type CategoryOption,
  type EditableCategoryMapping,
} from "@/modules/clients/components/client-categories-tab";
import {
  ClientBanksTab,
  type EditableBank,
} from "@/modules/clients/components/client-banks-tab";
import {
  ClientCardsTab,
  type EditableCard,
} from "@/modules/clients/components/client-cards-tab";

type ClientAcquirerRate = {
  id: string;
  modality: RateModality;
  installments: number | null;
  cardBrand: string | null;
  rate: number | string;
  tolerance: number | string;
};

type ClientAcquirer = {
  id: string;
  name: string;
  receiptRule: ReceiptRule;
  active: boolean;
  rates: ClientAcquirerRate[];
};

type ClientCategoryMapping = {
  id: string;
  mappingType: CategoryMappingType;
  categoryId: string;
  subcategoryId: string | null;
};

type ClientBank = {
  id: string;
  bankName: string;
  bankCode: string | null;
  agency: string | null;
  account: string;
  accountType: string;
  active: boolean;
};

type ClientCard = {
  id: string;
  bankName: string;
  brand: string;
  lastFourDigits: string | null;
  nickname: string | null;
  active: boolean;
};

type Client = {
  id: string;
  name: string;
  document: string | null;
  active: boolean;
  operationalEmail: string | null;
  operationalEmailCc: string | null;
  cluster: "A" | "B" | "C";
  acquirers: ClientAcquirer[];
  categoryMappings: ClientCategoryMapping[];
  banks: ClientBank[];
  cards: ClientCard[];
  _count: {
    imports: number;
  };
};

function cleanDocument(value: string): string {
  return value.replace(/\D/g, "").slice(0, 14);
}

function formatCnpj(value: string): string {
  const numbers = cleanDocument(value);

  return numbers
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export default function EditarClientePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [client, setClient] = useState<Client | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [active, setActive] = useState(true);
  const [operationalEmail, setOperationalEmail] = useState("");
  const [operationalEmailCc, setOperationalEmailCc] = useState("");
  const [cluster, setCluster] = useState<"A" | "B" | "C">("C");

  const [acquirers, setAcquirers] = useState<EditableAcquirer[]>([]);
  const [mappings, setMappings] =
    useState<EditableCategoryMapping[]>([]);
  const [banks, setBanks] = useState<EditableBank[]>([]);
  const [cards, setCards] = useState<EditableCard[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingAcquirers, setSavingAcquirers] = useState(false);
  const [savingCategories, setSavingCategories] = useState(false);
  const [savingBanks, setSavingBanks] = useState(false);
  const [savingCards, setSavingCards] = useState(false);
  const [error, setError] = useState("");

  function backToClients() {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    router.push(
      (returnTo?.startsWith("/clientes?") ? returnTo : "/clientes") as Route,
    );
  }

  const configuredMappings = useMemo(() => {
    return CATEGORY_MAPPING_TYPES.map((mappingType) => {
      const existing = mappings.find(
        (mapping) => mapping.mappingType === mappingType,
      );

      return (
        existing ?? {
          mappingType,
          categoryId: null,
          subcategoryId: null,
        }
      );
    });
  }, [mappings]);

  const setupSummary = useMemo(() => {
    const generalCompleted =
      name.trim().length >= 3 && cleanDocument(document).length === 14;
    const activeAcquirers = acquirers.filter(
      (item) => item.active && (item.name ?? "").trim().length >= 2,
    ).length;
    const configuredCategories = configuredMappings.filter(
      (item) => Boolean(item.categoryId),
    ).length;
    const activeBanks = banks.filter(
      (item) =>
        item.active &&
        (item.bankName ?? "").trim().length > 0 &&
        (item.account ?? "").trim().length > 0,
    ).length;
    const activeCards = cards.filter(
      (item) =>
        item.active &&
        (item.bankName ?? "").trim().length > 0 &&
        (item.brand ?? "").trim().length > 0,
    ).length;

    const percentage = Math.round(
      (generalCompleted ? 15 : 0) +
        (activeAcquirers > 0 ? 20 : 0) +
        (configuredCategories / CATEGORY_MAPPING_TYPES.length) * 35 +
        (activeBanks > 0 ? 15 : 0) +
        (activeCards > 0 ? 15 : 0),
    );

    const status =
      percentage === 100
        ? { label: "Configurado", color: "green" as const }
        : percentage >= 40
          ? { label: "Parcial", color: "yellow" as const }
          : { label: "Pendente", color: "red" as const };

    const items = [
      {
        label: "Dados gerais",
        detail: generalCompleted
          ? "Nome e CNPJ preenchidos"
          : "Preencha nome e CNPJ",
        completed: generalCompleted,
        partial: false,
      },
      {
        label: "Adquirentes",
        detail:
          activeAcquirers > 0
            ? `${activeAcquirers} configurada(s)`
            : "Nenhuma adquirente configurada",
        completed: activeAcquirers > 0,
        partial: false,
      },
      {
        label: "Categorias",
        detail: `${configuredCategories} de ${CATEGORY_MAPPING_TYPES.length} mapeadas`,
        completed: configuredCategories === CATEGORY_MAPPING_TYPES.length,
        partial:
          configuredCategories > 0 &&
          configuredCategories < CATEGORY_MAPPING_TYPES.length,
      },
      {
        label: "Bancos",
        detail:
          activeBanks > 0
            ? `${activeBanks} conta(s) configurada(s)`
            : "Nenhuma conta bancária configurada",
        completed: activeBanks > 0,
        partial: false,
      },
      {
        label: "Cartões",
        detail:
          activeCards > 0
            ? `${activeCards} cartão(ões) configurado(s)`
            : "Nenhum cartão configurado",
        completed: activeCards > 0,
        partial: false,
      },
    ];

    return {
      percentage,
      status,
      items,
      missingCount: items.filter((item) => !item.completed).length,
    };
  }, [acquirers, banks, cards, configuredMappings, document, name]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadClient() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(`/api/clients/${params.id}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        const result = (await response.json()) as {
          client?: Client;
          categories?: CategoryOption[];
          error?: string;
        };

        if (!response.ok || !result.client) {
          throw new Error(
            result.error || "Não foi possível carregar o cliente.",
          );
        }

        const loaded = result.client;

        setClient(loaded);
        setCategories(result.categories ?? []);
        setName(loaded.name);
        setDocument(formatCnpj(loaded.document || ""));
        setActive(loaded.active);
        setOperationalEmail(loaded.operationalEmail ?? "");
        setOperationalEmailCc(loaded.operationalEmailCc ?? "");
        setCluster(loaded.cluster ?? "C");

        setAcquirers(
          loaded.acquirers.map((item) => ({
            key: item.id,
            id: item.id,
            name: item.name,
            receiptRule: item.receiptRule,
            active: item.active,
            rates: (item.rates ?? []).map((rate): EditableAcquirerRate => ({
              key: rate.id,
              id: rate.id,
              modality: rate.modality,
              installments: rate.installments,
              cardBrand: rate.cardBrand ?? "",
              rate: Number(rate.rate),
              tolerance: Number(rate.tolerance),
            })),
          })),
        );

        setMappings(
          CATEGORY_MAPPING_TYPES.map((mappingType) => {
            const existing = loaded.categoryMappings.find(
              (mapping) => mapping.mappingType === mappingType,
            );

            return {
              mappingType,
              categoryId: existing?.categoryId ?? null,
              subcategoryId: existing?.subcategoryId ?? null,
            };
          }),
        );

        setBanks(
          loaded.banks.map((bank) => ({
            key: bank.id,
            id: bank.id,
            bankName: bank.bankName,
            bankCode: bank.bankCode ?? "",
            agency: bank.agency ?? "",
            account: bank.account,
            accountType: bank.accountType,
            active: bank.active,
          })),
        );

        setCards(
          loaded.cards.map((card) => ({
            key: card.id,
            id: card.id,
            bankName: card.bankName ?? "",
            brand: card.brand ?? "",
            lastFourDigits: card.lastFourDigits ?? "",
            nickname: card.nickname ?? "",
            active: card.active,
          })),
        );
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        ) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Não foi possível carregar o cliente.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadClient();

    return () => controller.abort();
  }, [params.id]);

  async function requestSave<T>(
    url: string,
    body: unknown,
    fallbackError: string,
  ): Promise<T> {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as T & {
      error?: string;
    };

    if (!response.ok) {
      throw new Error(result.error || fallbackError);
    }

    return result;
  }

  async function saveGeneralData() {
    try {
      setSavingGeneral(true);
      setError("");

      const response = await fetch(`/api/clients/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          document: cleanDocument(document),
          active,
          operationalEmail,
          operationalEmailCc,
          cluster,
        }),
      });

      const result = (await response.json()) as {
        client?: Client;
        message?: string;
        error?: string;
      };

      if (!response.ok || !result.client) {
        throw new Error(
          result.error || "Não foi possível salvar o cliente.",
        );
      }

      setClient(result.client);
      setName(result.client.name);
      setDocument(formatCnpj(result.client.document || ""));
      setActive(result.client.active);
      setOperationalEmail(result.client.operationalEmail ?? "");
      setOperationalEmailCc(result.client.operationalEmailCc ?? "");
      setCluster(result.client.cluster ?? "C");

      notifications.show({
        color: "green",
        title: "Cliente atualizado",
        message: result.message || "As alterações foram salvas.",
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível salvar o cliente.",
      );
    } finally {
      setSavingGeneral(false);
    }
  }

  async function saveAcquirers() {
    try {
      setSavingAcquirers(true);
      setError("");

      const result = await requestSave<{
        acquirers: ClientAcquirer[];
        message?: string;
      }>(
        `/api/clients/${params.id}/acquirers`,
        {
          acquirers: acquirers.map((item) => ({
            name: item.name.trim(),
            receiptRule: item.receiptRule,
            active: item.active,
            rates: item.rates.map((rate) => ({
              modality: rate.modality,
              installments: rate.installments,
              cardBrand: rate.cardBrand.trim() || null,
              rate: Number(rate.rate),
              tolerance: Number(rate.tolerance || 0),
            })),
          })),
        },
        "Não foi possível salvar as adquirentes.",
      );

      setAcquirers(
        result.acquirers.map((item) => ({
          key: item.id,
          id: item.id,
          name: item.name,
          receiptRule: item.receiptRule,
          active: item.active,
          rates: (item.rates ?? []).map((rate): EditableAcquirerRate => ({
            key: rate.id,
            id: rate.id,
            modality: rate.modality,
            installments: rate.installments,
            cardBrand: rate.cardBrand ?? "",
            rate: Number(rate.rate),
            tolerance: Number(rate.tolerance),
          })),
        })),
      );

      notifications.show({
        color: "green",
        title: "Adquirentes atualizadas",
        message: result.message || "As adquirentes foram salvas.",
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível salvar as adquirentes.",
      );
    } finally {
      setSavingAcquirers(false);
    }
  }

  async function saveCategories() {
    try {
      setSavingCategories(true);
      setError("");

      const result = await requestSave<{
        mappings: ClientCategoryMapping[];
        message?: string;
      }>(
        `/api/clients/${params.id}/category-mappings`,
        { mappings: configuredMappings },
        "Não foi possível salvar as categorias.",
      );

      setMappings(
        CATEGORY_MAPPING_TYPES.map((mappingType) => {
          const existing = result.mappings.find(
            (mapping) => mapping.mappingType === mappingType,
          );

          return {
            mappingType,
            categoryId: existing?.categoryId ?? null,
            subcategoryId: existing?.subcategoryId ?? null,
          };
        }),
      );

      notifications.show({
        color: "green",
        title: "Categorias atualizadas",
        message: result.message || "Os mapeamentos foram salvos.",
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível salvar as categorias.",
      );
    } finally {
      setSavingCategories(false);
    }
  }

  async function saveBanks() {
    try {
      setSavingBanks(true);
      setError("");

      const result = await requestSave<{
        banks: ClientBank[];
        message?: string;
      }>(
        `/api/clients/${params.id}/banks`,
        {
          banks: banks.map((bank) => ({
            bankName: bank.bankName.trim(),
            bankCode: bank.bankCode.trim() || null,
            agency: bank.agency.trim() || null,
            account: bank.account.trim(),
            accountType: bank.accountType,
            active: bank.active,
          })),
        },
        "Não foi possível salvar os bancos.",
      );

      setBanks(
        result.banks.map((bank) => ({
          key: bank.id,
          id: bank.id,
          bankName: bank.bankName,
          bankCode: bank.bankCode ?? "",
          agency: bank.agency ?? "",
          account: bank.account,
          accountType: bank.accountType,
          active: bank.active,
        })),
      );

      notifications.show({
        color: "green",
        title: "Bancos atualizados",
        message: result.message || "As contas foram salvas.",
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível salvar os bancos.",
      );
    } finally {
      setSavingBanks(false);
    }
  }

  async function saveCards() {
    try {
      setSavingCards(true);
      setError("");

      const result = await requestSave<{
        cards: ClientCard[];
        message?: string;
      }>(
        `/api/clients/${params.id}/cards`,
        {
          cards: cards.map((card) => ({
            bankName: (card.bankName ?? "").trim(),
            brand: (card.brand ?? "").trim(),
            lastFourDigits: (card.lastFourDigits ?? "").trim() || null,
            nickname: (card.nickname ?? "").trim() || null,
            active: card.active,
          })),
        },
        "Não foi possível salvar os cartões.",
      );

      setCards(
        result.cards.map((card) => ({
          key: card.id,
          id: card.id,
          bankName: card.bankName,
          brand: card.brand,
          lastFourDigits: card.lastFourDigits ?? "",
          nickname: card.nickname ?? "",
          active: card.active,
        })),
      );

      notifications.show({
        color: "green",
        title: "Cartões atualizados",
        message: result.message || "Os cartões foram salvos.",
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível salvar os cartões.",
      );
    } finally {
      setSavingCards(false);
    }
  }

  if (loading) {
    return (
      <Group justify="center" py={100}>
        <Loader />
        <Text c="dimmed">Carregando cliente...</Text>
      </Group>
    );
  }

  if (error && !client) {
    return (
      <Stack>
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={17} />}
          onClick={backToClients}
          w="fit-content"
        >
          Voltar para clientes
        </Button>

        <Alert color="red">{error}</Alert>
      </Stack>
    );
  }

  if (!client) return null;

  return (
    <Stack gap="xl">
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={17} />}
        onClick={backToClients}
        w="fit-content"
      >
        Voltar para clientes
      </Button>

      <Stack gap={4}>
        <Text size="xs" fw={800} c="blue" tt="uppercase">
          Configuração do cliente
        </Text>

        <Title order={2}>{client.name}</Title>

        <Group gap="xs">
          <Text c="dimmed">
            {formatCnpj(client.document || "")}
          </Text>

          <Badge
            color={client.active ? "green" : "gray"}
            variant="light"
          >
            {client.active ? "Ativo" : "Inativo"}
          </Badge>
        </Group>
      </Stack>

      <Paper withBorder radius="lg" p="lg">
        <Stack gap="lg">
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              <Text fw={800}>Resumo da configuração</Text>
              <Text size="sm" c="dimmed">
                {setupSummary.missingCount === 0
                  ? "O cliente está pronto para utilizar todos os módulos."
                  : `Faltam ${setupSummary.missingCount} etapa(s) para concluir a implantação.`}
              </Text>
            </Stack>

            <Badge
              color={setupSummary.status.color}
              variant="light"
              size="lg"
            >
              {setupSummary.status.label}
            </Badge>
          </Group>

          <Stack gap={6}>
            <Group justify="space-between">
              <Text size="sm" fw={700}>Progresso da implantação</Text>
              <Text fw={800} c={setupSummary.status.color}>
                {setupSummary.percentage}%
              </Text>
            </Group>

            <Progress
              value={setupSummary.percentage}
              color={setupSummary.status.color}
              size="lg"
              radius="xl"
            />
          </Stack>

          <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }}>
            {setupSummary.items.map((item) => {
              const itemColor = item.completed
                ? "green"
                : item.partial
                  ? "yellow"
                  : "red";
              const ItemIcon = item.completed
                ? IconCircleCheck
                : item.partial
                  ? IconAlertTriangle
                  : IconCircleX;

              return (
                <Paper key={item.label} withBorder radius="md" p="md">
                  <Stack gap={8}>
                    <Group gap="xs" wrap="nowrap">
                      <ItemIcon
                        size={20}
                        color={`var(--mantine-color-${itemColor}-6)`}
                      />
                      <Text fw={700} size="sm">{item.label}</Text>
                    </Group>
                    <Text size="xs" c="dimmed">{item.detail}</Text>
                  </Stack>
                </Paper>
              );
            })}
          </SimpleGrid>
        </Stack>
      </Paper>

      {error && (
        <Alert
          color="red"
          withCloseButton
          onClose={() => setError("")}
        >
          {error}
        </Alert>
      )}

      <Paper withBorder radius="lg" p="lg">
        <Tabs defaultValue="general" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab
              value="general"
              leftSection={<IconBuilding size={16} />}
            >
              Dados gerais
            </Tabs.Tab>

            <Tabs.Tab
              value="acquirers"
              leftSection={<IconCash size={16} />}
            >
              Adquirentes
            </Tabs.Tab>

            <Tabs.Tab
              value="categories"
              leftSection={<IconCategory size={16} />}
            >
              Categorias
            </Tabs.Tab>

            <Tabs.Tab
              value="banks"
              leftSection={<IconBuildingBank size={16} />}
            >
              Bancos
            </Tabs.Tab>

            <Tabs.Tab
              value="cards"
              leftSection={<IconCreditCard size={16} />}
            >
              Cartões
            </Tabs.Tab>

            <Tabs.Tab
              value="routing"
              leftSection={<IconRoute size={16} />}
            >
              Equipe e e-mails
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="general" pt="xl">
            <ClientGeneralTab
              name={name}
              document={document}
              active={active}
              saving={savingGeneral}
              onNameChange={setName}
              onDocumentChange={(value) =>
                setDocument(formatCnpj(value))
              }
              onActiveChange={setActive}
              operationalEmail={operationalEmail}
              operationalEmailCc={operationalEmailCc}
              cluster={cluster}
              onOperationalEmailChange={setOperationalEmail}
              onOperationalEmailCcChange={setOperationalEmailCc}
              onClusterChange={setCluster}
              onSave={saveGeneralData}
            />
          </Tabs.Panel>

          <Tabs.Panel value="acquirers" pt="xl">
            <ClientAcquirersTab
              acquirers={acquirers}
              saving={savingAcquirers}
              onChange={setAcquirers}
              onSave={saveAcquirers}
            />
          </Tabs.Panel>

          <Tabs.Panel value="categories" pt="xl">
            <ClientCategoriesTab
              categories={categories}
              mappings={configuredMappings}
              saving={savingCategories}
              onCategoriesChange={setCategories}
              onChange={setMappings}
              onSave={saveCategories}
            />
          </Tabs.Panel>

          <Tabs.Panel value="banks" pt="xl">
            <ClientBanksTab
              banks={banks}
              saving={savingBanks}
              onChange={setBanks}
              onSave={saveBanks}
            />
          </Tabs.Panel>

          <Tabs.Panel value="cards" pt="xl">
            <ClientCardsTab
              cards={cards}
              saving={savingCards}
              onChange={setCards}
              onSave={saveCards}
            />
          </Tabs.Panel>

          <Tabs.Panel value="routing" pt="xl">
            <ClientRoutingTab clientId={client.id} />
          </Tabs.Panel>
        </Tabs>
      </Paper>
    </Stack>
  );
}
