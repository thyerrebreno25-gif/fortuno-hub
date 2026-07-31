"use client";

import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconDeviceFloppy, IconPlus, IconTrash } from "@tabler/icons-react";

export type EditableCard = {
  key: string;
  id?: string;
  bankName: string;
  brand: string;
  lastFourDigits: string;
  nickname: string;
  active: boolean;
};

type Props = {
  cards: EditableCard[];
  saving: boolean;
  onChange: (cards: EditableCard[]) => void;
  onSave: () => void;
};

function createCard(): EditableCard {
  return {
    key: crypto.randomUUID(),
    bankName: "",
    brand: "",
    lastFourDigits: "",
    nickname: "",
    active: true,
  };
}

export function ClientCardsTab({ cards, saving, onChange, onSave }: Props) {
  function updateCard(key: string, patch: Partial<EditableCard>) {
    onChange(cards.map((card) => (card.key === key ? { ...card, ...patch } : card)));
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Title order={4}>Cartões para leitura de faturas</Title>
          <Text size="sm" c="dimmed">
            Cadastre cada cartão com seu banco emissor e bandeira. Esta lista será usada pela aba de Faturas para escolher o parser correto.
          </Text>
        </Stack>

        <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => onChange([...cards, createCard()])}>
          Adicionar cartão
        </Button>
      </Group>

      {cards.length === 0 ? (
        <Alert color="yellow">
          Nenhum cartão cadastrado. Sem esta configuração, a aba de Faturas não saberá qual lógica bancária aplicar.
        </Alert>
      ) : (
        cards.map((card, index) => (
          <Paper key={card.key} withBorder radius="md" p="md">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={700}>Cartão {index + 1}</Text>
                <Group>
                  <Switch
                    label="Ativo"
                    checked={card.active}
                    onChange={(event) => updateCard(card.key, { active: event.currentTarget.checked })}
                  />
                  <ActionIcon
                    color="red"
                    variant="light"
                    size={36}
                    onClick={() => onChange(cards.filter((current) => current.key !== card.key))}
                    aria-label="Remover cartão"
                  >
                    <IconTrash size={17} />
                  </ActionIcon>
                </Group>
              </Group>

              <SimpleGrid cols={{ base: 1, md: 2 }}>
                <TextInput
                  label="Banco emissor"
                  placeholder="Inter, Sicoob, Itaú..."
                  value={card.bankName ?? ""}
                  onChange={(event) => updateCard(card.key, { bankName: event.currentTarget.value })}
                  required
                />
                <TextInput
                  label="Bandeira"
                  placeholder="Mastercard, Visa, Elo..."
                  value={card.brand ?? ""}
                  onChange={(event) => updateCard(card.key, { brand: event.currentTarget.value })}
                  required
                />
                <TextInput
                  label="Últimos 4 dígitos"
                  placeholder="Ex.: 8321"
                  value={card.lastFourDigits ?? ""}
                  maxLength={4}
                  onChange={(event) => updateCard(card.key, { lastFourDigits: event.currentTarget.value.replace(/\D/g, "").slice(0, 4) })}
                />
                <TextInput
                  label="Identificação opcional"
                  placeholder="Ex.: Cartão diretoria"
                  value={card.nickname ?? ""}
                  onChange={(event) => updateCard(card.key, { nickname: event.currentTarget.value })}
                />
              </SimpleGrid>
            </Stack>
          </Paper>
        ))
      )}

      <Button leftSection={<IconDeviceFloppy size={17} />} onClick={onSave} loading={saving} w="fit-content">
        Salvar cartões
      </Button>
    </Stack>
  );
}
