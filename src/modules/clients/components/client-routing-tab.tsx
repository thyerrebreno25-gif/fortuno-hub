"use client";

import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconDeviceFloppy, IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

type MemberOption = {
  id: string;
  name: string | null;
  email: string;
};

type RoutingClient = {
  id: string;
  serviceSquad: "SQUAD_1" | "SQUAD_2" | null;
  operationLeaderId: string | null;
  payableResponsibleId: string | null;
  receivableResponsibleId: string | null;
  generalResponsibleId: string | null;
  serviceAliases: string | null;
};

type RoutingResponse = {
  clients?: RoutingClient[];
  members?: MemberOption[];
  error?: string;
};

type Props = {
  clientId: string;
};

const EMPTY_ROUTING: RoutingClient = {
  id: "",
  serviceSquad: null,
  operationLeaderId: null,
  payableResponsibleId: null,
  receivableResponsibleId: null,
  generalResponsibleId: null,
  serviceAliases: null,
};

export function ClientRoutingTab({ clientId }: Props) {
  const [routing, setRouting] = useState<RoutingClient>({
    ...EMPTY_ROUTING,
    id: clientId,
  });
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadRouting() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          "/api/atendimento/routing/clients",
          { cache: "no-store", signal: controller.signal },
        );
        const body = (await response.json()) as RoutingResponse;

        if (!response.ok) {
          throw new Error(
            body.error || "Não foi possível carregar o roteamento.",
          );
        }

        const current = body.clients?.find(
          (item) => item.id === clientId,
        );

        if (!current) {
          throw new Error("Cliente não encontrado no cadastro operacional.");
        }

        setRouting(current);
        setMembers(body.members || []);
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
            : "Não foi possível carregar o roteamento.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadRouting();

    return () => controller.abort();
  }, [clientId]);

  const memberOptions = useMemo(
    () =>
      members.map((member) => ({
        value: member.id,
        label: member.name || member.email,
      })),
    [members],
  );

  function update<K extends keyof RoutingClient>(
    field: K,
    value: RoutingClient[K],
  ) {
    setRouting((current) => ({ ...current, [field]: value }));
    setSuccess("");
  }

  async function save() {
    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const response = await fetch(
        "/api/atendimento/routing/clients",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            serviceSquad: routing.serviceSquad,
            operationLeaderId: routing.operationLeaderId,
            payableResponsibleId: routing.payableResponsibleId,
            receivableResponsibleId: routing.receivableResponsibleId,
            generalResponsibleId: routing.generalResponsibleId,
            serviceAliases: routing.serviceAliases || "",
          }),
        },
      );
      const body = (await response.json()) as {
        client?: RoutingClient;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          body.error || "Não foi possível salvar o roteamento.",
        );
      }

      if (body.client) setRouting(body.client);
      setSuccess("Roteamento do cliente salvo com sucesso.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível salvar o roteamento.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Group py="xl">
        <Loader size="sm" />
        <Text c="dimmed">Carregando equipe e responsáveis...</Text>
      </Group>
    );
  }

  return (
    <Stack maw={850} gap="lg">
      <Stack gap={4}>
        <Group gap="xs">
          <Text fw={800}>Equipe e distribuição de e-mails</Text>
          {routing.serviceSquad && (
            <Badge variant="light">
              {routing.serviceSquad === "SQUAD_1"
                ? "Squad 1"
                : "Squad 2"}
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          Estes dados definem quem receberá automaticamente cada assunto
          identificado pela Central de Atendimento.
        </Text>
      </Stack>

      {error && <Alert color="red">{error}</Alert>}
      {success && <Alert color="green">{success}</Alert>}

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Select
          label="Equipe / Squad"
          description="Equipe operacional principal deste cliente."
          clearable
          data={[
            { value: "SQUAD_1", label: "Squad 1" },
            { value: "SQUAD_2", label: "Squad 2" },
          ]}
          value={routing.serviceSquad}
          onChange={(value) =>
            update(
              "serviceSquad",
              value as "SQUAD_1" | "SQUAD_2" | null,
            )
          }
        />

        <Select
          label="Líder"
          description="Supervisiona a operação deste cliente."
          searchable
          clearable
          data={memberOptions}
          value={routing.operationLeaderId}
          onChange={(value) => update("operationLeaderId", value)}
        />

        <Select
          label="Responsável por Contas a Pagar"
          description="Recebe boletos, fornecedores, notas e pagamentos."
          searchable
          clearable
          data={memberOptions}
          value={routing.payableResponsibleId}
          onChange={(value) => update("payableResponsibleId", value)}
        />

        <Select
          label="Responsável por Contas a Receber"
          description="Recebe cobranças, recebimentos e adquirentes."
          searchable
          clearable
          data={memberOptions}
          value={routing.receivableResponsibleId}
          onChange={(value) => update("receivableResponsibleId", value)}
        />

        <Select
          label="Responsável geral / fallback"
          description="Recebe assuntos gerais ou sem área confirmada."
          searchable
          clearable
          data={memberOptions}
          value={routing.generalResponsibleId}
          onChange={(value) => update("generalResponsibleId", value)}
        />
      </SimpleGrid>

      <Textarea
        label="Nomes usados para identificar o cliente"
        description="Informe nome fantasia, abreviações e outros nomes que aparecem em assuntos, assinaturas ou anexos. Separe por linha, vírgula ou ponto e vírgula."
        minRows={4}
        value={routing.serviceAliases || ""}
        onChange={(event) =>
          update("serviceAliases", event.currentTarget.value)
        }
        placeholder={"Ex.: Abismo\nAbismo Anhumas\nAnhumas Turismo"}
      />

      <Alert color="blue" icon={<IconInfoCircle size={18} />}>
        Se o cliente ou a área não forem reconhecidos com segurança, o e-mail
        ficará em Não atribuídos para revisão manual.
      </Alert>

      <Button
        leftSection={<IconDeviceFloppy size={17} />}
        loading={saving}
        onClick={() => void save()}
        w="fit-content"
      >
        Salvar equipe e responsáveis
      </Button>
    </Stack>
  );
}
