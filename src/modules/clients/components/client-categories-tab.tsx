"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconDeviceFloppy, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
export type CategoryMappingType = "SALES_REVENUE" | "MDR_FEES" | "ADVANCE_FEES" | "MACHINE_RENTAL_ADJUSTMENTS" | "SALE_CANCELLATION" | "REFUNDS_CREDITS";
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
    MACHINE_RENTAL_ADJUSTMENTS: "Aluguel de máquina e ajustes",
    SALE_CANCELLATION: "Cancelamentos de vendas",
    REFUNDS_CREDITS: "Estornos e créditos",
};
export const CATEGORY_MAPPING_TYPES = Object.keys(MAPPING_LABELS) as CategoryMappingType[];
type Props = {
    clientId: string;
    categories: CategoryOption[];
    mappings: EditableCategoryMapping[];
    saving: boolean;
    onCategoriesChange: (categories: CategoryOption[]) => void;
    onChange: (mappings: EditableCategoryMapping[]) => void;
    onSave: () => void;
};
export function ClientCategoriesTab({ clientId, categories, mappings, saving, onCategoriesChange, onChange, onSave }: Props) {
    const [loading, setLoading] = useState(true), [error, setError] = useState(""), [loadedClient, setLoadedClient] = useState("");
    const [mappingToAdd, setMappingToAdd] = useState<CategoryMappingType | null>(null);
    const load = useCallback(async (signal?: AbortSignal) => {
        try {
            const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/category-mappings`, { cache: "no-store", signal });
            const body = await response.json();
            if (!response.ok)
                throw Error(body.error || "Não foi possível consultar as categorias deste cliente.");
            if (signal?.aborted)
                return;
            onCategoriesChange(body.categories);
            setLoadedClient(clientId);
            setError("");
        }
        catch (cause) {
            if (!signal?.aborted) {
                setLoadedClient("");
                setError(cause instanceof Error ? cause.message : "Falha na consulta das categorias.");
            }
        }
        finally {
            if (!signal?.aborted)
                setLoading(false);
        }
    }, [clientId, onCategoriesChange]);
    useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => { if (!controller.signal.aborted) void load(controller.signal); }); return () => controller.abort(); }, [load]);
    const ready = loadedClient === clientId && !loading && !error;
    const available = CATEGORY_MAPPING_TYPES.filter(type => !mappings.some(mapping => mapping.mappingType === type));
    const invalid = mappings.some(mapping => !categories.some(category => category.id === mapping.categoryId && (!mapping.subcategoryId || category.children.some(child => child.id === mapping.subcategoryId))));
    function update(type: CategoryMappingType, field: "categoryId" | "subcategoryId", value: string | null) { onChange(mappings.map(mapping => mapping.mappingType === type ? { ...mapping, [field]: value, ...(field === "categoryId" ? { subcategoryId: null } : {}) } : mapping)); }
    return <Stack>
    <Group justify="space-between"><div><Title order={4}>Categorias do cliente no Conta Azul</Title><Text size="sm" c="dimmed">Selecione as categorias cadastradas no CA desta empresa.</Text></div><Group><Badge color={ready ? "teal" : "gray"}>{ready ? `${categories.length} categorias do cliente` : "Catálogo do cliente"}</Badge><Button variant="light" leftSection={<IconRefresh size={16}/>} loading={loading} onClick={() => { setLoading(true); setError(""); void load(); }}>Atualizar do CA</Button></Group></Group>
    {error && <Alert color="red">{error}</Alert>}
    {ready && !categories.length && <Alert color="yellow">O Conta Azul não retornou categorias para esta empresa.</Alert>}
    <Paper withBorder p="md" radius="md"><Group align="flex-end"><Select label="Adicionar categoria aplicável" placeholder="Selecione o tipo" flex={1} value={mappingToAdd} data={available.map(value => ({ value, label: MAPPING_LABELS[value] }))} onChange={value => setMappingToAdd(value as CategoryMappingType | null)} disabled={!ready || !available.length}/><Button variant="light" leftSection={<IconPlus size={16}/>} disabled={!ready || !mappingToAdd} onClick={() => { if (mappingToAdd) {
        onChange([...mappings, { mappingType: mappingToAdd, categoryId: null, subcategoryId: null }]);
        setMappingToAdd(null);
    } }}>Adicionar</Button></Group></Paper>
    {ready && invalid && <Alert color="yellow">Revise os vínculos sem categoria ou com categorias que não estão no catálogo atual desta empresa. Selecione uma categoria do CA ou remova o tipo que não se aplica.</Alert>}
    {mappings.map(mapping => { const category = categories.find(item => item.id === mapping.categoryId); return <Paper key={mapping.mappingType} withBorder p="md" radius="md"><Stack><Group justify="space-between"><Text fw={700}>{MAPPING_LABELS[mapping.mappingType]}</Text><Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={15}/>} onClick={() => onChange(mappings.filter(item => item.mappingType !== mapping.mappingType))}>Não se aplica</Button></Group><SimpleGrid cols={{ base: 1, sm: 2 }}><Select label="Categoria no CA deste cliente" placeholder="Selecione ou pesquise" searchable clearable disabled={!ready} value={mapping.categoryId} data={categories.map(item => ({ value: item.id, label: item.name }))} nothingFoundMessage="Categoria não encontrada neste cliente" onChange={value => update(mapping.mappingType, "categoryId", value)}/><Select label="Subcategoria" placeholder={category?.children.length ? "Selecione uma subcategoria" : "Sem subcategorias"} searchable clearable disabled={!ready || !category?.children.length} value={mapping.subcategoryId} data={category?.children.map(item => ({ value: item.id, label: item.name })) || []} onChange={value => update(mapping.mappingType, "subcategoryId", value)}/></SimpleGrid></Stack></Paper>; })}
    <Button w="fit-content" leftSection={<IconDeviceFloppy size={17}/>} loading={saving} disabled={!ready || invalid} onClick={onSave}>Salvar categorias</Button>
  </Stack>;
}
