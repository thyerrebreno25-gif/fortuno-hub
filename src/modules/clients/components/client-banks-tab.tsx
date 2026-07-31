"use client";

import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

export type EditableBank = {
  key: string;
  id?: string;
  bankName: string;
  bankCode: string;
  agency: string;
  account: string;
  accountType: string;
  active: boolean;
};

type Props = {
  banks: EditableBank[];
  saving: boolean;
  onChange: (banks: EditableBank[]) => void;
  onSave: () => void;
};

function createBank(): EditableBank {
  return {
    key: crypto.randomUUID(),
    bankName: "",
    bankCode: "",
    agency: "",
    account: "",
    accountType: "CHECKING",
    active: true,
  };
}

const ACCOUNT_TYPES = [
  { value: "CHECKING", label: "Conta corrente" },
  { value: "SAVINGS", label: "Conta poupança" },
  { value: "PAYMENT", label: "Conta de pagamento" },
  { value: "INVESTMENT", label: "Conta investimento" },
  { value: "OTHER", label: "Outra" },
];

export function ClientBanksTab({
  banks,
  saving,
  onChange,
  onSave,
}: Props) {
  function updateBank(
    key: string,
    field: keyof Omit<EditableBank, "key" | "id">,
    value: string | boolean,
  ) {
    onChange(
      banks.map((bank) =>
        bank.key === key ? { ...bank, [field]: value } : bank,
      ),
    );
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Title order={4}>Contas bancárias</Title>
          <Text size="sm" c="dimmed">
            Cadastre as contas usadas nas importações de extratos.
          </Text>
        </Stack>

        <Button
          variant="light"
          leftSection={<IconPlus size={16} />}
          onClick={() => onChange([...banks, createBank()])}
        >
          Adicionar conta bancária
        </Button>
      </Group>

      {banks.length === 0 ? (
        <Alert color="yellow">
          Nenhuma conta bancária cadastrada.
        </Alert>
      ) : (
        banks.map((bank, index) => (
          <Paper
            key={bank.key}
            withBorder
            radius="md"
            p="md"
          >
            <Stack>
              <Group justify="space-between">
                <Text fw={700}>Conta {index + 1}</Text>

                <ActionIcon
                  color="red"
                  variant="light"
                  onClick={() =>
                    onChange(
                      banks.filter(
                        (current) => current.key !== bank.key,
                      ),
                    )
                  }
                  aria-label="Remover conta"
                >
                  <IconTrash size={17} />
                </ActionIcon>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label="Banco"
                  placeholder="Ex.: Banco do Brasil"
                  value={bank.bankName}
                  onChange={(event) =>
                    updateBank(
                      bank.key,
                      "bankName",
                      event.currentTarget.value,
                    )
                  }
                  required
                />

                <TextInput
                  label="Código do banco"
                  placeholder="Ex.: 001"
                  value={bank.bankCode}
                  onChange={(event) =>
                    updateBank(
                      bank.key,
                      "bankCode",
                      event.currentTarget.value,
                    )
                  }
                />

                <TextInput
                  label="Agência"
                  value={bank.agency}
                  onChange={(event) =>
                    updateBank(
                      bank.key,
                      "agency",
                      event.currentTarget.value,
                    )
                  }
                />

                <TextInput
                  label="Conta"
                  value={bank.account}
                  onChange={(event) =>
                    updateBank(
                      bank.key,
                      "account",
                      event.currentTarget.value,
                    )
                  }
                  required
                />

                <Select
                  label="Tipo da conta"
                  value={bank.accountType}
                  data={ACCOUNT_TYPES}
                  allowDeselect={false}
                  onChange={(value) =>
                    updateBank(
                      bank.key,
                      "accountType",
                      value || "CHECKING",
                    )
                  }
                />

                <Switch
                  mt={28}
                  label="Conta ativa"
                  checked={bank.active}
                  onChange={(event) =>
                    updateBank(
                      bank.key,
                      "active",
                      event.currentTarget.checked,
                    )
                  }
                />
              </SimpleGrid>
            </Stack>
          </Paper>
        ))
      )}

      <Button
        leftSection={<IconDeviceFloppy size={17} />}
        onClick={onSave}
        loading={saving}
        w="fit-content"
      >
        Salvar bancos
      </Button>
    </Stack>
  );
}
