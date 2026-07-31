"use client";

import { useMemo, useState } from "react";
import {
  Accordion, ActionIcon, Alert, Badge, Button, Card, Checkbox, Divider, Drawer,
  Group, Modal, NumberInput, Paper, ScrollArea, SimpleGrid, Stack, Switch,
  Text, Textarea, TextInput, ThemeIcon, Title, Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle, IconCopy, IconGripVertical, IconListCheck, IconPencil,
  IconPlus, IconTrash, IconX,
} from "@tabler/icons-react";

export type TemplateTask = {
  id?: string;
  subcategory: string;
  title: string;
  description?: string | null;
  defaultResponsibleRole?: string | null;
  mandatory: boolean;
  estimatedMinutes: number;
  tip?: string | null;
  isNotionReminder: boolean;
};
export type TemplateActivity = { id?: string; name: string; description?: string | null; tasks: TemplateTask[] };
export type TemplateCategory = { id?: string; name: string; description?: string | null; activities: TemplateActivity[] };
export type OnboardingTemplate = {
  id: string;
  name: string;
  description?: string | null;
  slaDays: number;
  active: boolean;
  isDefault: boolean;
  categories: TemplateCategory[];
};

type Props = {
  templates: OnboardingTemplate[];
  loading?: boolean;
  onRefresh: () => Promise<void> | void;
};

const emptyTask = (): TemplateTask => ({
  subcategory: "Geral", title: "Nova tarefa", description: "", defaultResponsibleRole: "",
  mandatory: true, estimatedMinutes: 30, tip: "", isNotionReminder: false,
});
const emptyActivity = (): TemplateActivity => ({ name: "Nova atividade", description: "", tasks: [emptyTask()] });
const emptyCategory = (): TemplateCategory => ({ name: "Nova categoria", description: "", activities: [emptyActivity()] });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Erro inesperado.");
  return body;
}

export function TemplateManager({ templates, loading, onRefresh }: Props) {
  const [editorOpened, setEditorOpened] = useState(false);
  const [editing, setEditing] = useState<OnboardingTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OnboardingTemplate | null>(null);

  const openEditor = (template: OnboardingTemplate) => {
    setEditing(clone(template)); setError(null); setEditorOpened(true);
  };

  const createTemplate = async () => {
    setSaving(true); setError(null);
    try {
      const { template } = await request<{ template: OnboardingTemplate }>("/api/onboarding/templates", {
        method: "POST", body: JSON.stringify({ name: `Novo template ${templates.length + 1}`, slaDays: 30 }),
      });
      await onRefresh(); openEditor(template);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro ao criar template."); }
    finally { setSaving(false); }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true); setError(null);
    try {
      await request(`/api/onboarding/templates/${editing.id}`, { method: "PUT", body: JSON.stringify(editing) });
      await onRefresh(); setEditorOpened(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro ao salvar template."); }
    finally { setSaving(false); }
  };

  const duplicate = async (id: string) => {
    setSaving(true); setError(null);
    try { await request(`/api/onboarding/templates/${id}/duplicate`, { method: "POST" }); await onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Erro ao duplicar template."); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setSaving(true); setError(null);
    try { await request(`/api/onboarding/templates/${deleteTarget.id}`, { method: "DELETE" }); await onRefresh(); setDeleteTarget(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Erro ao excluir template."); }
    finally { setSaving(false); }
  };

  const taskCount = (template: OnboardingTemplate) => template.categories.reduce((sum, category) => sum + category.activities.reduce((s, activity) => s + activity.tasks.length, 0), 0);

  const updateCategory = (ci: number, patch: Partial<TemplateCategory>) => setEditing((current) => {
    if (!current) return current; const next = clone(current); next.categories[ci] = { ...next.categories[ci], ...patch }; return next;
  });
  const updateActivity = (ci: number, ai: number, patch: Partial<TemplateActivity>) => setEditing((current) => {
    if (!current) return current; const next = clone(current); next.categories[ci].activities[ai] = { ...next.categories[ci].activities[ai], ...patch }; return next;
  });
  const updateTask = (ci: number, ai: number, ti: number, patch: Partial<TemplateTask>) => setEditing((current) => {
    if (!current) return current; const next = clone(current); next.categories[ci].activities[ai].tasks[ti] = { ...next.categories[ci].activities[ai].tasks[ti], ...patch }; return next;
  });

  const totalTasks = useMemo(() => editing ? taskCount(editing) : 0, [editing]);

  return (
    <Stack gap="lg">
      {error && <Alert color="red" icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)}>{error}</Alert>}
      <Group justify="space-between">
        <Stack gap={2}>
          <Title order={4}>Templates de onboarding</Title>
          <Text size="sm" c="dimmed">Crie modelos reutilizáveis e escolha um deles ao abrir um novo onboarding.</Text>
        </Stack>
        <Button leftSection={<IconPlus size={17} />} onClick={createTemplate} loading={saving}>Novo template</Button>
      </Group>

      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
        {templates.map((template) => (
          <Card key={template.id} withBorder radius="lg" p="lg">
            <Stack gap="lg">
              <Group justify="space-between">
                <ThemeIcon size={42} radius="md" variant="light"><IconListCheck size={21} /></ThemeIcon>
                <Group gap="xs">
                  {template.isDefault && <Badge color="blue">Padrão</Badge>}
                  <Badge color={template.active ? "green" : "gray"}>{template.active ? "Ativo" : "Arquivado"}</Badge>
                </Group>
              </Group>
              <Stack gap={4}>
                <Text fw={800} size="lg">{template.name}</Text>
                <Text size="sm" c="dimmed" lineClamp={2}>{template.description || "Sem descrição."}</Text>
              </Stack>
              <SimpleGrid cols={3}>
                <Paper withBorder p="sm"><Text size="xs" c="dimmed">Tarefas</Text><Text fw={800}>{taskCount(template)}</Text></Paper>
                <Paper withBorder p="sm"><Text size="xs" c="dimmed">Categorias</Text><Text fw={800}>{template.categories.length}</Text></Paper>
                <Paper withBorder p="sm"><Text size="xs" c="dimmed">SLA</Text><Text fw={800}>{template.slaDays} dias</Text></Paper>
              </SimpleGrid>
              <Group grow>
                <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => openEditor(template)}>Editar</Button>
                <Tooltip label="Duplicar"><ActionIcon variant="default" size={36} onClick={() => duplicate(template.id)}><IconCopy size={17} /></ActionIcon></Tooltip>
                <Tooltip label="Excluir ou arquivar"><ActionIcon color="red" variant="subtle" size={36} onClick={() => setDeleteTarget(template)}><IconTrash size={17} /></ActionIcon></Tooltip>
              </Group>
            </Stack>
          </Card>
        ))}

        {!loading && templates.length === 0 && (
          <Card withBorder radius="lg" style={{ borderStyle: "dashed" }}>
            <Stack align="center" justify="center" mih={280} gap="md">
              <ThemeIcon size={48} radius="xl" variant="light"><IconPlus size={24} /></ThemeIcon>
              <Text fw={800}>Nenhum template cadastrado</Text>
              <Text size="sm" c="dimmed" ta="center">Crie uma base editável com categoria, atividade e tarefa.</Text>
              <Button onClick={createTemplate}>Criar primeiro template</Button>
            </Stack>
          </Card>
        )}
      </SimpleGrid>

      <Drawer opened={editorOpened} onClose={() => setEditorOpened(false)} position="right" size="90%" title="Editor de template">
        {editing && (
          <Stack gap="xl">
            <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }}>
              <TextInput label="Nome do template" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.currentTarget.value })} required />
              <NumberInput label="SLA em dias" min={1} value={editing.slaDays} onChange={(value) => setEditing({ ...editing, slaDays: Number(value) || 30 })} />
              <Switch label="Template ativo" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.currentTarget.checked })} mt={28} />
              <Switch label="Usar como padrão" checked={editing.isDefault} onChange={(e) => setEditing({ ...editing, isDefault: e.currentTarget.checked })} mt={28} />
            </SimpleGrid>
            <Textarea label="Descrição" value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.currentTarget.value })} minRows={2} />
            <Group justify="space-between">
              <Text fw={800}>{editing.categories.length} categorias • {totalTasks} tarefas</Text>
              <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setEditing({ ...editing, categories: [...editing.categories, emptyCategory()] })}>Adicionar categoria</Button>
            </Group>

            <Accordion multiple variant="separated" defaultValue={editing.categories.map((_, i) => `category-${i}`)}>
              {editing.categories.map((category, ci) => (
                <Accordion.Item key={`category-${ci}`} value={`category-${ci}`}>
                  <Accordion.Control icon={<IconGripVertical size={17} />}>
                    <Group justify="space-between" pr="md"><Text fw={800}>{category.name || "Categoria sem nome"}</Text><Badge variant="light">{category.activities.length} atividades</Badge></Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="lg">
                      <Group align="flex-end">
                        <TextInput label="Nome da categoria" value={category.name} onChange={(e) => updateCategory(ci, { name: e.currentTarget.value })} style={{ flex: 1 }} />
                        <TextInput label="Descrição" value={category.description || ""} onChange={(e) => updateCategory(ci, { description: e.currentTarget.value })} style={{ flex: 2 }} />
                        <ActionIcon color="red" variant="subtle" size={36} onClick={() => setEditing({ ...editing, categories: editing.categories.filter((_, index) => index !== ci) })}><IconTrash size={18} /></ActionIcon>
                      </Group>

                      {category.activities.map((activity, ai) => (
                        <Paper key={`activity-${ci}-${ai}`} withBorder radius="lg" p="lg">
                          <Stack gap="md">
                            <Group align="flex-end">
                              <TextInput label="Atividade" value={activity.name} onChange={(e) => updateActivity(ci, ai, { name: e.currentTarget.value })} style={{ flex: 1 }} />
                              <TextInput label="Descrição" value={activity.description || ""} onChange={(e) => updateActivity(ci, ai, { description: e.currentTarget.value })} style={{ flex: 2 }} />
                              <ActionIcon color="red" variant="subtle" size={36} onClick={() => {
                                const next = clone(editing); next.categories[ci].activities.splice(ai, 1); setEditing(next);
                              }}><IconX size={18} /></ActionIcon>
                            </Group>
                            <Divider />
                            {activity.tasks.map((task, ti) => (
                              <Card key={`task-${ci}-${ai}-${ti}`} withBorder radius="md" p="md">
                                <Stack gap="sm">
                                  <Group align="flex-end">
                                    <TextInput label="Subcategoria" value={task.subcategory} onChange={(e) => updateTask(ci, ai, ti, { subcategory: e.currentTarget.value })} w={180} />
                                    <TextInput label="Tarefa" value={task.title} onChange={(e) => updateTask(ci, ai, ti, { title: e.currentTarget.value })} style={{ flex: 1 }} />
                                    <NumberInput label="Tempo (min)" min={0} value={task.estimatedMinutes} onChange={(value) => updateTask(ci, ai, ti, { estimatedMinutes: Number(value) || 0 })} w={130} />
                                    <ActionIcon color="red" variant="subtle" size={36} onClick={() => {
                                      const next = clone(editing); next.categories[ci].activities[ai].tasks.splice(ti, 1); setEditing(next);
                                    }}><IconTrash size={17} /></ActionIcon>
                                  </Group>
                                  <SimpleGrid cols={{ base: 1, md: 2 }}>
                                    <Textarea label="Descrição" value={task.description || ""} onChange={(e) => updateTask(ci, ai, ti, { description: e.currentTarget.value })} minRows={2} />
                                    <Textarea label="Dica operacional" value={task.tip || ""} onChange={(e) => updateTask(ci, ai, ti, { tip: e.currentTarget.value })} minRows={2} />
                                  </SimpleGrid>
                                  <Group>
                                    <TextInput label="Responsável padrão/cargo" value={task.defaultResponsibleRole || ""} onChange={(e) => updateTask(ci, ai, ti, { defaultResponsibleRole: e.currentTarget.value })} w={250} />
                                    <Checkbox label="Obrigatória" checked={task.mandatory} onChange={(e) => updateTask(ci, ai, ti, { mandatory: e.currentTarget.checked })} mt={28} />
                                    <Checkbox label="Lembrete do Notion" checked={task.isNotionReminder} onChange={(e) => updateTask(ci, ai, ti, { isNotionReminder: e.currentTarget.checked })} mt={28} />
                                  </Group>
                                </Stack>
                              </Card>
                            ))}
                            <Button variant="subtle" leftSection={<IconPlus size={16} />} onClick={() => {
                              const next = clone(editing); next.categories[ci].activities[ai].tasks.push(emptyTask()); setEditing(next);
                            }}>Adicionar tarefa</Button>
                          </Stack>
                        </Paper>
                      ))}
                      <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => {
                        const next = clone(editing); next.categories[ci].activities.push(emptyActivity()); setEditing(next);
                      }}>Adicionar atividade</Button>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>

            <Group justify="flex-end" pos="sticky" bottom={0} bg="var(--mantine-color-body)" py="md">
              <Button variant="default" onClick={() => setEditorOpened(false)}>Cancelar</Button>
              <Button onClick={save} loading={saving}>Salvar template</Button>
            </Group>
          </Stack>
        )}
      </Drawer>

      <Modal opened={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Excluir template">
        <Stack>
          <Alert color="orange" icon={<IconAlertTriangle size={18} />}>Se o template já foi usado em algum onboarding, ele será arquivado para preservar o histórico.</Alert>
          <Text>Confirma a exclusão/arquivamento de <b>{deleteTarget?.name}</b>?</Text>
          <Group justify="flex-end"><Button variant="default" onClick={() => setDeleteTarget(null)}>Cancelar</Button><Button color="red" loading={saving} onClick={remove}>Confirmar</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
