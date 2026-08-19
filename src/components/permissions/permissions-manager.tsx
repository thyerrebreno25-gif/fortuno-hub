/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Title,
} from "@mantine/core";

const modules = [
  ["DASHBOARD", "Dashboard"],
  ["CLIENTS", "Clientes"],
  ["IMPORTS", "Importações"],
  ["AUDIT", "Auditoria"],
  ["MOTOR_EXCHANGE", "Motor Cambial"],
  ["ONBOARDING", "Onboarding"],
  ["REPORTS", "Relatórios"],
  ["HISTORY", "Histórico"],
  ["SUPPORT", "Suporte"],
  ["SETTINGS", "Configurações"],
] as const;

const actions = [
  "canView",
  "canCreate",
  "canEdit",
  "canDelete",
  "canImport",
  "canExport",
  "canManage",
] as const;

type PermissionAction = (typeof actions)[number];
type Role = "ADMIN" | "MANAGER" | "OPERATOR" | "CLIENT";

type PermissionSet = Record<
  string,
  Record<PermissionAction, boolean>
>;

type RolesResponse = Record<Role, PermissionSet>;

const labels: Record<PermissionAction, string> = {
  canView: "Visualizar",
  canCreate: "Criar",
  canEdit: "Editar",
  canDelete: "Excluir",
  canImport: "Importar",
  canExport: "Exportar",
  canManage: "Gerenciar",
};

const roleOptions = [
  { value: "ADMIN", label: "Administrador" },
  { value: "MANAGER", label: "Gestor" },
  { value: "OPERATOR", label: "Operador" },
  { value: "CLIENT", label: "Cliente" },
];

export function PermissionsManager() {
  const [role, setRole] = useState<Role>("OPERATOR");
  const [roles, setRoles] = useState<RolesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgColor, setMsgColor] = useState<"green" | "red" | "blue">("blue");

  async function load() {
    setLoading(true);
    setMsg("");

    try {
      const response = await fetch("/api/permissions/roles", {
        cache: "no-store",
      });

      const text = await response.text();
      const body = text ? JSON.parse(text) : {};

      if (!response.ok) {
        throw new Error(body.error || "Erro ao carregar permissões.");
      }

      setRoles(body.roles);
    } catch (error) {
      setMsgColor("red");
      setMsg(
        error instanceof Error ? error.message : "Erro ao carregar permissões.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const current = useMemo(() => roles?.[role] ?? {}, [roles, role]);

  function toggle(
    moduleCode: string,
    action: PermissionAction,
    value: boolean,
  ) {
    setRoles((previous) => {
      if (!previous) return previous;

      return {
        ...previous,
        [role]: {
          ...previous[role],
          [moduleCode]: {
            ...previous[role]?.[moduleCode],
            [action]: value,
          },
        },
      };
    });
  }

  function setModuleRow(moduleCode: string, value: boolean) {
    setRoles((previous) => {
      if (!previous) return previous;

      const nextPermissions = Object.fromEntries(
        actions.map((action) => {
          const forcedAdminSettings =
            role === "ADMIN" &&
            moduleCode === "SETTINGS" &&
            action === "canView";

          return [action, forcedAdminSettings ? true : value];
        }),
      ) as Record<PermissionAction, boolean>;

      return {
        ...previous,
        [role]: {
          ...previous[role],
          [moduleCode]: nextPermissions,
        },
      };
    });
  }

  function setAll(value: boolean) {
    setRoles((previous) => {
      if (!previous) return previous;

      const nextRole = Object.fromEntries(
        modules.map(([moduleCode]) => {
          const modulePermissions = Object.fromEntries(
            actions.map((action) => {
              const forcedAdminSettings =
                role === "ADMIN" &&
                moduleCode === "SETTINGS" &&
                action === "canView";

              return [action, forcedAdminSettings ? true : value];
            }),
          );

          return [moduleCode, modulePermissions];
        }),
      ) as PermissionSet;

      return {
        ...previous,
        [role]: nextRole,
      };
    });
  }

  function setReadOnly() {
    setRoles((previous) => {
      if (!previous) return previous;

      const nextRole = Object.fromEntries(
        modules.map(([moduleCode]) => [
          moduleCode,
          Object.fromEntries(
            actions.map((action) => [action, action === "canView"]),
          ),
        ]),
      ) as PermissionSet;

      return {
        ...previous,
        [role]: nextRole,
      };
    });
  }

  function setOperatorDefault() {
    if (role !== "OPERATOR") {
      setMsgColor("blue");
      setMsg("O padrão de operador só pode ser aplicado ao perfil Operador.");
      return;
    }

    setRoles((previous) => {
      if (!previous) return previous;

      const nextRole = Object.fromEntries(
        modules.map(([moduleCode]) => {
          const isAllowed =
            moduleCode === "DASHBOARD" ||
            moduleCode === "CLIENTS" ||
            moduleCode === "AUDIT";

          return [
            moduleCode,
            {
              canView: isAllowed,
              canCreate: moduleCode === "CLIENTS",
              canEdit:
                moduleCode === "CLIENTS" ||
                moduleCode === "AUDIT",
              canDelete: false,
              canImport: false,
              canExport: false,
              canManage: false,
            },
          ];
        }),
      ) as PermissionSet;

      return {
        ...previous,
        OPERATOR: nextRole,
      };
    });

    setMsgColor("blue");
    setMsg(
      "Padrão de operador aplicado. Dashboard, Clientes e Auditoria foram liberados. Clique em Salvar permissões.",
    );
  }

  async function save() {
    setSaving(true);
    setMsg("");

    try {
      const response = await fetch("/api/permissions/roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          permissions: current,
        }),
      });

      const text = await response.text();
      const body = text ? JSON.parse(text) : {};

      if (!response.ok) {
        throw new Error(body.error || "Erro ao salvar permissões.");
      }

      setMsgColor("green");
      setMsg(body.message || "Permissões salvas com sucesso.");
    } catch (error) {
      setMsgColor("red");
      setMsg(
        error instanceof Error ? error.message : "Erro ao salvar permissões.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }

  if (!roles) {
    return (
      <Alert color="red">
        {msg || "Permissões indisponíveis."}
      </Alert>
    );
  }

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="lg">
        <Stack gap={2}>
          <Title order={4}>Perfis de acesso</Title>
          <Text size="sm" c="dimmed">
            Defina manualmente quais telas e ações cada perfil poderá utilizar.
          </Text>
        </Stack>

        {msg && (
          <Alert
            color={msgColor}
            withCloseButton
            onClose={() => setMsg("")}
          >
            {msg}
          </Alert>
        )}

        <Group justify="space-between" align="flex-end">
          <Select
            label="Perfil"
            value={role}
            onChange={(value) => value && setRole(value as Role)}
            data={roleOptions}
            w={260}
          />

          <Group gap="xs">
            <Button variant="default" onClick={() => setAll(true)}>
              Liberar tudo
            </Button>
            <Button variant="default" onClick={() => setReadOnly()}>
              Somente leitura
            </Button>
            <Button
              variant="default"
              onClick={() => setOperatorDefault()}
              disabled={role !== "OPERATOR"}
            >
              Operador padrão
            </Button>
            <Button
              color="red"
              variant="light"
              onClick={() => setAll(false)}
            >
              Bloquear tudo
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Salvar permissões
            </Button>
          </Group>
        </Group>

        <ScrollArea>
          <Table
            miw={1120}
            verticalSpacing="sm"
            horizontalSpacing="md"
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Módulo</Table.Th>
                {actions.map((action) => (
                  <Table.Th key={action} ta="center">
                    {labels[action]}
                  </Table.Th>
                ))}
                <Table.Th ta="center">Linha inteira</Table.Th>
              </Table.Tr>
            </Table.Thead>

            <Table.Tbody>
              {modules.map(([code, name]) => {
                const row = current?.[code] ?? {};
                const rowEnabled = actions.every((action) => !!row[action]);

                return (
                  <Table.Tr key={code}>
                    <Table.Td>
                      <Text fw={600}>{name}</Text>
                    </Table.Td>

                    {actions.map((action) => {
                      const disabled =
                        role === "ADMIN" &&
                        code === "SETTINGS" &&
                        action === "canView";

                      return (
                        <Table.Td key={action}>
                          <Group justify="center">
                            <Switch
                              checked={!!row[action]}
                              onChange={(event) =>
                                toggle(
                                  code,
                                  action,
                                  event.currentTarget.checked,
                                )
                              }
                              disabled={disabled}
                              color="blue"
                              size="md"
                              aria-label={`${labels[action]} em ${name}`}
                            />
                          </Group>
                        </Table.Td>
                      );
                    })}

                    <Table.Td>
                      <Group justify="center">
                        <Switch
                          checked={rowEnabled}
                          onChange={(event) =>
                            setModuleRow(code, event.currentTarget.checked)
                          }
                          color="green"
                          size="md"
                          aria-label={`Alterar todas as permissões de ${name}`}
                        />
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>

        <Alert color="blue">
          Para liberar inicialmente somente o cadastro de clientes ao perfil
          Operador, selecione o perfil Operador e clique em
          <strong> Operador padrão</strong>. Depois clique em
          <strong> Salvar permissões</strong>.
        </Alert>
      </Stack>
    </Paper>
  );
}
