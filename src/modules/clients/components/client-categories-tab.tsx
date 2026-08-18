"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconDeviceFloppy,
  IconPlus,
} from "@tabler/icons-react";

export type CategoryMappingType =
  | "SALES_REVENUE"
  | "MDR_FEES"
  | "ADVANCE_FEES"
  | "MACHINE_RENTAL_ADJUSTMENTS"
  | "SALE_CANCELLATION"
  | "REFUNDS_CREDITS";

export type CategoryOption = {
  id: string;
  name: string;
  code?: string | null;
  children: {
    id: string;
    name: string;
    code?: string | null;
  }[];
};

export type EditableCategoryMapping = {
  mappingType: CategoryMappingType;
  categoryId: string | null;
  subcategoryId: string | null;
};

const MAPPING_LABELS: Record<CategoryMappingType, string> = {
  SALES_REVENUE: "Receita de vendas",
  MDR_FEES: "Taxas MDR",
  ADVANCE_FEES: "Taxas de antecipação",
  MACHINE_RENTAL_ADJUSTMENTS:
    "Aluguel de máquina e ajustes",
  SALE_CANCELLATION: "Cancelamentos de vendas",
  REFUNDS_CREDITS: "Estornos e créditos",
};

export const CATEGORY_MAPPING_TYPES =
  Object.keys(MAPPING_LABELS) as CategoryMappingType[];

type Props = {
  categories: CategoryOption[];
  mappings: EditableCategoryMapping[];
  saving: boolean;
  onCategoriesChange: (categories: CategoryOption[]) => void;
  onChange: (mappings: EditableCategoryMapping[]) => void;
  onSave: () => void;
};

export function ClientCategoriesTab({
  categories,
  mappings,
  saving,
  onCategoriesChange,
  onChange,
  onSave,
}: Props) {
  const [modalOpened, setModalOpened] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [creatingForMapping, setCreatingForMapping] =
    useState<CategoryMappingType | null>(null);

  function openCategoryModal(
    mappingType: CategoryMappingType | null = null,
  ) {
    setCategoryName("");
    setCategoryCode("");
    setParentId(null);
    setCreateError("");
    setCreatingForMapping(mappingType);
    setModalOpened(true);
  }

  function updateMapping(
    mappingType: CategoryMappingType,
    field: "categoryId" | "subcategoryId",
    value: string | null,
  ) {
    onChange(
      mappings.map((mapping) => {
        if (mapping.mappingType !== mappingType) {
          return mapping;
        }

        if (field === "categoryId") {
          return {
            ...mapping,
            categoryId: value,
            subcategoryId: null,
          };
        }

        return {
          ...mapping,
          subcategoryId: value,
        };
      }),
    );
  }

  async function createCategory() {
    try {
      setCreating(true);
      setCreateError("");

      const response = await fetch("/api/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: categoryName.trim(),
          code: categoryCode.trim() || null,
          parentId,
        }),
      });

      const result = (await response.json()) as {
        category?: CategoryOption & {
          parentId?: string | null;
        };
        message?: string;
        error?: string;
      };

      if (!response.ok || !result.category) {
        throw new Error(
          result.error || "Não foi possível criar a categoria.",
        );
      }

      if (parentId) {
        onCategoriesChange(
          categories.map((category) =>
            category.id === parentId
              ? {
                  ...category,
                  children: [
                    ...category.children,
                    {
                      id: result.category!.id,
                      name: result.category!.name,
                      code: result.category!.code ?? null,
                    },
                  ].sort((a, b) =>
                    a.name.localeCompare(b.name, "pt-BR"),
                  ),
                }
              : category,
          ),
        );
      } else {
        onCategoriesChange(
          [
            ...categories,
            {
              id: result.category.id,
              name: result.category.name,
              code: result.category.code ?? null,
              children: result.category.children ?? [],
            },
          ].sort((a, b) =>
            a.name.localeCompare(b.name, "pt-BR"),
          ),
        );
      }

      if (creatingForMapping) {
        onChange(
          mappings.map((mapping) =>
            mapping.mappingType === creatingForMapping
              ? parentId
                ? {
                    ...mapping,
                    categoryId: parentId,
                    subcategoryId: result.category!.id,
                  }
                : {
                    ...mapping,
                    categoryId: result.category!.id,
                    subcategoryId: null,
                  }
              : mapping,
          ),
        );
      }

      notifications.show({
        color: "green",
        title: parentId
          ? "Subcategoria criada"
          : "Categoria criada",
        message: result.message || "Cadastro concluído.",
      });

      setCategoryName("");
      setCategoryCode("");
      setParentId(null);
      setCreatingForMapping(null);
      setModalOpened(false);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "Não foi possível criar a categoria.",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Stack>
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Title order={4}>Categorias do cliente no Conta Azul</Title>
            <Text size="sm" c="dimmed">
              Cada cliente possui seu próprio mapeamento. Selecione uma
              categoria existente ou crie uma nomenclatura específica sem
              alterar os clientes já configurados.
            </Text>
          </Stack>

          <Button
            variant="light"
            leftSection={<IconPlus size={16} />}
            onClick={() => openCategoryModal()}
          >
            Nova nomenclatura
          </Button>
        </Group>

        {categories.length === 0 && (
          <Alert color="yellow">
            Ainda não existem categorias. Clique em
            &quot;Nova nomenclatura&quot; para criar a primeira.
          </Alert>
        )}

        {mappings.map((mapping) => {
          const selectedCategory = categories.find(
            (category) => category.id === mapping.categoryId,
          );

          return (
            <Paper
              key={mapping.mappingType}
              withBorder
              radius="md"
              p="md"
            >
              <Stack>
                <Text fw={700}>
                  {MAPPING_LABELS[mapping.mappingType]}
                </Text>

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Group align="flex-end" gap="xs" wrap="nowrap">
                    <Select
                      label="Categoria"
                      placeholder="Selecione ou pesquise"
                      searchable
                      clearable
                      flex={1}
                      value={mapping.categoryId}
                      data={categories.map((category) => ({
                        value: category.id,
                        label: category.name,
                      }))}
                      nothingFoundMessage="Categoria não encontrada"
                      onChange={(value) =>
                        updateMapping(
                          mapping.mappingType,
                          "categoryId",
                          value,
                        )
                      }
                    />

                    <Button
                      variant="light"
                      px="sm"
                      leftSection={<IconPlus size={15} />}
                      onClick={() =>
                        openCategoryModal(mapping.mappingType)
                      }
                    >
                      Criar nova
                    </Button>
                  </Group>

                  <Select
                    label="Subcategoria"
                    placeholder={
                      selectedCategory
                        ? "Selecione uma subcategoria"
                        : "Escolha primeiro a categoria"
                    }
                    searchable
                    clearable
                    disabled={!selectedCategory}
                    value={mapping.subcategoryId}
                    data={
                      selectedCategory?.children.map(
                        (subcategory) => ({
                          value: subcategory.id,
                          label: subcategory.name,
                        }),
                      ) ?? []
                    }
                    onChange={(value) =>
                      updateMapping(
                        mapping.mappingType,
                        "subcategoryId",
                        value,
                      )
                    }
                  />
                </SimpleGrid>
              </Stack>
            </Paper>
          );
        })}

        <Button
          leftSection={<IconDeviceFloppy size={17} />}
          onClick={onSave}
          loading={saving}
          w="fit-content"
          disabled={categories.length === 0}
        >
          Salvar categorias
        </Button>
      </Stack>

      <Modal
        opened={modalOpened}
        onClose={() => {
          if (!creating) {
            setModalOpened(false);
            setCreateError("");
            setCreatingForMapping(null);
          }
        }}
        title={
          creatingForMapping
            ? `Nova nomenclatura para ${MAPPING_LABELS[creatingForMapping]}`
            : "Nova nomenclatura de categoria"
        }
        centered
      >
        <Stack>
          {createError && (
            <Alert color="red">{createError}</Alert>
          )}

          <Select
            label="Categoria principal"
            description="Deixe vazio para criar uma categoria. Se escolher uma existente, será criada uma subcategoria."
            placeholder="Categoria principal"
            clearable
            searchable
            value={parentId}
            data={categories.map((category) => ({
              value: category.id,
              label: category.name,
            }))}
            onChange={setParentId}
          />

          <TextInput
            label={parentId ? "Nome da subcategoria" : "Nome da categoria"}
            description="Use exatamente a nomenclatura cadastrada no Conta Azul."
            value={categoryName}
            onChange={(event) =>
              setCategoryName(event.currentTarget.value)
            }
            required
          />

          <TextInput
            label="Código"
            description="Opcional"
            value={categoryCode}
            onChange={(event) =>
              setCategoryCode(event.currentTarget.value)
            }
          />

          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setModalOpened(false);
                setCreatingForMapping(null);
              }}
              disabled={creating}
            >
              Cancelar
            </Button>

            <Button
              onClick={createCategory}
              loading={creating}
            >
              Criar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
