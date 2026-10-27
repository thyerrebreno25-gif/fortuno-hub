"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconBuilding, IconKey, IconUser } from "@tabler/icons-react";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

type ProfileData = {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt: string;
    updatedAt: string;
  };
  organization: {
    id: string;
    name: string;
    memberSince: string;
  };
};

const roleLabels: Record<string, string> = {
  MASTER: "Master",
  ADMIN: "Administrador",
  MANAGER: "Gestor",
  OPERATOR: "Operador",
  CLIENT: "Cliente",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

export default function PerfilPage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [name, setName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/profile", { cache: "no-store" });
      const payload = (await response.json()) as ProfileData & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível carregar o perfil.");
      }

      setData(payload);
      setName(payload.user.name);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar o perfil.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveProfile() {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível salvar o perfil.");
      }

      setSuccess(payload.message || "Perfil atualizado.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar o perfil.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (newPassword.length < 8) {
      setError("A senha deve possuir pelo menos 8 caracteres.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const supabase = createSupabaseClient();
      const { error: passwordError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (passwordError) throw passwordError;

      setNewPassword("");
      setSuccess("Senha atualizada com sucesso.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível alterar a senha.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <Stack align="center" py={80}>
        <Loader />
        <Text c="dimmed">Carregando perfil...</Text>
      </Stack>
    );
  }

  if (!data) {
    return <Alert color="red">{error || "Perfil indisponível."}</Alert>;
  }

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" lts={0.8}>
          Fortuno Hub
        </Text>
        <Title order={2}>Meu perfil</Title>
      </Stack>

      {error && (
        <Alert color="red" withCloseButton onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert color="green" withCloseButton onClose={() => setSuccess("")}>
          {success}
        </Alert>
      )}

      <Paper withBorder radius="lg" p="lg">
        <Group justify="space-between">
          <Group>
            <Avatar size={64} radius="xl" color="blue">
              {data.user.name.slice(0, 1).toUpperCase()}
            </Avatar>
            <Stack gap={2}>
              <Title order={4}>{data.user.name}</Title>
              <Text size="sm" c="dimmed">{data.user.email}</Text>
              <Badge variant="light">
                {roleLabels[data.user.role] || data.user.role}
              </Badge>
            </Stack>
          </Group>
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 1, xl: 2 }}>
        <Paper withBorder radius="lg" p="lg">
          <Stack gap="lg">
            <Group>
              <IconUser size={20} />
              <Title order={4}>Dados pessoais</Title>
            </Group>

            <TextInput
              label="Nome"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <TextInput label="E-mail" value={data.user.email} disabled />

            <Group justify="flex-end">
              <Button
                onClick={() => void saveProfile()}
                loading={saving}
                disabled={name.trim().length < 2}
              >
                Salvar perfil
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Paper withBorder radius="lg" p="lg">
          <Stack gap="lg">
            <Group>
              <IconKey size={20} />
              <Title order={4}>Segurança</Title>
            </Group>

            <TextInput
              label="Nova senha"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.currentTarget.value)}
              description="Utilize pelo menos 8 caracteres."
            />

            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => void changePassword()}
                loading={saving}
                disabled={newPassword.length < 8}
              >
                Alterar senha
              </Button>
            </Group>
          </Stack>
        </Paper>
      </SimpleGrid>

      <Paper withBorder radius="lg" p="lg">
        <Group>
          <IconBuilding size={20} />
          <Stack gap={2}>
            <Text fw={700}>{data.organization.name}</Text>
            <Text size="sm" c="dimmed">
              Vinculado à organização desde {formatDate(data.organization.memberSince)}.
            </Text>
          </Stack>
        </Group>
      </Paper>
    </Stack>
  );
}
