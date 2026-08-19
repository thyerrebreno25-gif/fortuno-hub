"use client";

import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

export type ReceiptRule =
  | "WITHOUT_ADVANCE"
  | "AUTOMATIC_ADVANCE"
  | "OCCASIONAL_ADVANCE";

export type RateModality =
  | "DEBIT"
  | "CREDIT"
  | "PIX"
  | "VOUCHER"
  | "OTHER";

export type EditableAcquirerRate = {
  key: string;
  id?: string;
  modality: RateModality;
  installments: number | null;
  cardBrand: string;
  rate: number | string;
  tolerance: number | string;
};

export type EditableAcquirer = {
  key: string;
  id?: string;
  name: string;
  receiptRule: ReceiptRule;
  active: boolean;
  rates: EditableAcquirerRate[];
};

const RECEIPT_RULE_OPTIONS = [
  { value: "WITHOUT_ADVANCE", label: "Sem antecipação" },
  { value: "AUTOMATIC_ADVANCE", label: "Antecipação automática" },
  { value: "OCCASIONAL_ADVANCE", label: "Antecipação eventual" },
];

const MODALITY_OPTIONS = [
  { value: "DEBIT", label: "Débito" },
  { value: "CREDIT", label: "Crédito" },
  { value: "PIX", label: "PIX" },
  { value: "VOUCHER", label: "Voucher" },
  { value: "OTHER", label: "Outro" },
];

type Props = {
  acquirers: EditableAcquirer[];
  saving: boolean;
  onChange: (acquirers: EditableAcquirer[]) => void;
  onSave: () => void;
};

function createRate(): EditableAcquirerRate {
  return {
    key: crypto.randomUUID(),
    modality: "CREDIT",
    installments: 1,
    cardBrand: "",
    rate: "",
    tolerance: 0.05,
  };
}

function createAcquirer(): EditableAcquirer {
  return {
    key: crypto.randomUUID(),
    name: "",
    receiptRule: "WITHOUT_ADVANCE",
    active: true,
    rates: [],
  };
}

export function ClientAcquirersTab({
  acquirers,
  saving,
  onChange,
  onSave,
}: Props) {
  function updateAcquirer(
    key: string,
    field: "name" | "receiptRule" | "active",
    value: string | boolean,
  ) {
    onChange(
      acquirers.map((acquirer) =>
        acquirer.key === key ? { ...acquirer, [field]: value } : acquirer,
      ),
    );
  }

  function updateRate(
    acquirerKey: string,
    rateKey: string,
    field: keyof Omit<EditableAcquirerRate, "key" | "id">,
    value: string | number | null,
  ) {
    updateRateFields(acquirerKey, rateKey, { [field]: value });
  }

  function updateRateFields(
    acquirerKey: string,
    rateKey: string,
    changes: Partial<Omit<EditableAcquirerRate, "key" | "id">>,
  ) {
    onChange(
      acquirers.map((acquirer) =>
        acquirer.key === acquirerKey
          ? {
              ...acquirer,
              rates: acquirer.rates.map((rate) =>
                rate.key === rateKey ? { ...rate, ...changes } : rate,
              ),
            }
          : acquirer,
      ),
    );
  }

  function addRate(acquirerKey: string) {
    onChange(
      acquirers.map((acquirer) =>
        acquirer.key === acquirerKey
          ? { ...acquirer, rates: [...acquirer.rates, createRate()] }
          : acquirer,
      ),
    );
  }

  function removeRate(acquirerKey: string, rateKey: string) {
    onChange(
      acquirers.map((acquirer) =>
        acquirer.key === acquirerKey
          ? {
              ...acquirer,
              rates: acquirer.rates.filter((rate) => rate.key !== rateKey),
            }
          : acquirer,
      ),
    );
  }

  function removeAcquirer(key: string) {
    onChange(acquirers.filter((acquirer) => acquirer.key !== key));
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Title order={4}>Adquirentes</Title>
          <Text size="sm" c="dimmed">
            Cadastre as adquirentes, regras de recebimento e taxas contratadas
            deste cliente.
          </Text>
        </Stack>

        <Button
          variant="light"
          leftSection={<IconPlus size={16} />}
          onClick={() => onChange([...acquirers, createAcquirer()])}
        >
          Adicionar adquirente
        </Button>
      </Group>

      {acquirers.length === 0 ? (
        <Alert color="yellow">
          Nenhuma adquirente configurada. Clique em &quot;Adicionar
          adquirente&quot; para começar.
        </Alert>
      ) : (
        acquirers.map((acquirer, index) => (
          <Paper key={acquirer.key} withBorder radius="md" p="md">
            <Stack gap="lg">
              <Group justify="space-between">
                <Text fw={700}>Adquirente {index + 1}</Text>
                <ActionIcon
                  color="red"
                  variant="light"
                  onClick={() => removeAcquirer(acquirer.key)}
                  aria-label="Remover adquirente"
                >
                  <IconTrash size={17} />
                </ActionIcon>
              </Group>

              <Group align="flex-end" grow>
                <TextInput
                  label="Nome"
                  placeholder="Cielo, Rede, Stone..."
                  value={acquirer.name}
                  onChange={(event) =>
                    updateAcquirer(
                      acquirer.key,
                      "name",
                      event.currentTarget.value,
                    )
                  }
                  required
                />

                <Select
                  label="Regra de recebimento"
                  value={acquirer.receiptRule}
                  data={RECEIPT_RULE_OPTIONS}
                  allowDeselect={false}
                  onChange={(value) =>
                    updateAcquirer(
                      acquirer.key,
                      "receiptRule",
                      (value || "WITHOUT_ADVANCE") as ReceiptRule,
                    )
                  }
                />
              </Group>

              <Switch
                label="Adquirente ativa"
                checked={acquirer.active}
                onChange={(event) =>
                  updateAcquirer(
                    acquirer.key,
                    "active",
                    event.currentTarget.checked,
                  )
                }
              />

              <Divider />

              <Stack gap="sm">
                <Group justify="space-between">
                  <Stack gap={1}>
                    <Text fw={700}>Taxas contratadas</Text>
                    <Text size="xs" c="dimmed">
                      Uma regra específica de bandeira prevalece sobre a regra
                      geral da mesma modalidade e forma de pagamento.
                    </Text>
                    <Text size="xs" c="dimmed">
                      No crédito parcelado, informe o fim de cada faixa. Exemplo:
                      uma taxa até 6x e outra até 36x representam 2x a 6x e 7x ou mais.
                    </Text>
                  </Stack>
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconPlus size={14} />}
                    onClick={() => addRate(acquirer.key)}
                  >
                    Nova taxa
                  </Button>
                </Group>

                {acquirer.rates.length === 0 ? (
                  <Alert color="gray" variant="light">
                    Nenhuma taxa contratada cadastrada para esta adquirente.
                  </Alert>
                ) : (
                  <Table.ScrollContainer minWidth={980}>
                    <Table verticalSpacing="xs">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Tipo</Table.Th>
                          <Table.Th>Forma</Table.Th>
                          <Table.Th>Parcelas até</Table.Th>
                          <Table.Th>Bandeira</Table.Th>
                          <Table.Th>Taxa (%)</Table.Th>
                          <Table.Th>Tolerância (p.p.)</Table.Th>
                          <Table.Th />
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {acquirer.rates.map((rate) => {
                          const paymentForm =
                            rate.modality === "CREDIT" && Number(rate.installments) > 1
                              ? "INSTALLMENT"
                              : "CASH";

                          return (
                            <Table.Tr key={rate.key}>
                              <Table.Td>
                                <Select
                                  data={MODALITY_OPTIONS}
                                  value={rate.modality}
                                  allowDeselect={false}
                                  onChange={(value) => {
                                    const modality = (value || "CREDIT") as RateModality;
                                    updateRateFields(acquirer.key, rate.key, {
                                      modality,
                                      installments:
                                        modality === "CREDIT" && Number(rate.installments) > 1
                                          ? Number(rate.installments)
                                          : 1,
                                      cardBrand: modality === "PIX" ? "" : rate.cardBrand,
                                    });
                                  }}
                                />
                              </Table.Td>
                              <Table.Td>
                                <Select
                                  data={
                                    rate.modality === "CREDIT"
                                      ? [
                                          { value: "CASH", label: "À vista" },
                                          { value: "INSTALLMENT", label: "Parcelado" },
                                        ]
                                      : [{ value: "CASH", label: "À vista" }]
                                  }
                                  value={paymentForm}
                                  allowDeselect={false}
                                  disabled={rate.modality !== "CREDIT"}
                                  onChange={(value) =>
                                    updateRate(
                                      acquirer.key,
                                      rate.key,
                                      "installments",
                                      value === "INSTALLMENT"
                                        ? Number(rate.installments) > 1
                                          ? Number(rate.installments)
                                          : 6
                                        : 1,
                                    )
                                  }
                                />
                              </Table.Td>
                              <Table.Td>
                                <NumberInput
                                  min={paymentForm === "INSTALLMENT" ? 2 : 1}
                                  max={36}
                                  decimalScale={0}
                                  allowDecimal={false}
                                  value={Number(rate.installments) || 1}
                                  suffix="x"
                                  disabled={paymentForm !== "INSTALLMENT"}
                                  onChange={(value) =>
                                    updateRate(
                                      acquirer.key,
                                      rate.key,
                                      "installments",
                                      value,
                                    )
                                  }
                                />
                              </Table.Td>
                              <Table.Td>
                                <TextInput
                                  value={rate.cardBrand}
                                  placeholder="Todas"
                                  onChange={(event) =>
                                    updateRate(
                                      acquirer.key,
                                      rate.key,
                                      "cardBrand",
                                      event.currentTarget.value,
                                    )
                                  }
                                />
                              </Table.Td>
                              <Table.Td>
                                <NumberInput
                                  min={0}
                                  max={100}
                                  decimalScale={4}
                                  fixedDecimalScale={false}
                                  value={rate.rate}
                                  suffix="%"
                                  onChange={(value) =>
                                    updateRate(
                                      acquirer.key,
                                      rate.key,
                                      "rate",
                                      value,
                                    )
                                  }
                                />
                              </Table.Td>
                              <Table.Td>
                                <NumberInput
                                  min={0}
                                  max={100}
                                  decimalScale={4}
                                  value={rate.tolerance}
                                  suffix=" p.p."
                                  onChange={(value) =>
                                    updateRate(
                                      acquirer.key,
                                      rate.key,
                                      "tolerance",
                                      value,
                                    )
                                  }
                                />
                              </Table.Td>
                              <Table.Td>
                                <ActionIcon
                                  color="red"
                                  variant="subtle"
                                  aria-label="Excluir taxa"
                                  onClick={() =>
                                    removeRate(acquirer.key, rate.key)
                                  }
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
              </Stack>
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
        Salvar adquirentes e taxas
      </Button>
    </Stack>
  );
}
