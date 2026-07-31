"use client";

import { Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";

type Props = {
  onNewClient(): void;
};

export function ClientPageHeader({ onNewClient }: Props) {
  return (
    <Group justify="space-between" align="end" mb="xl">
      <Stack gap={2}>
        <Text
          c="blue"
          fw={700}
          fz="xs"
          tt="uppercase"
        >
          Cadastros
        </Text>

        <Title order={2}>
          Clientes
        </Title>

        <Text c="dimmed">
          Empresas cadastradas para utilização
          dos módulos do ConvertNow.
        </Text>
      </Stack>

      <Button
        leftSection={<IconPlus size={18} />}
        onClick={onNewClient}
      >
        Novo Cliente
      </Button>
    </Group>
  );
}