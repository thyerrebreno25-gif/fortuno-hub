"use client";

import {
  Button,
  Stack,
  Switch,
  TextInput,
} from "@mantine/core";
import { IconDeviceFloppy } from "@tabler/icons-react";

type Props = {
  name: string;
  document: string;
  active: boolean;
  saving: boolean;
  onNameChange: (value: string) => void;
  onDocumentChange: (value: string) => void;
  onActiveChange: (value: boolean) => void;
  onSave: () => void;
};

export function ClientGeneralTab({
  name,
  document,
  active,
  saving,
  onNameChange,
  onDocumentChange,
  onActiveChange,
  onSave,
}: Props) {
  return (
    <Stack maw={700}>
      <TextInput
        label="Nome do cliente"
        value={name}
        onChange={(event) =>
          onNameChange(event.currentTarget.value)
        }
        required
      />

      <TextInput
        label="CNPJ"
        value={document}
        onChange={(event) =>
          onDocumentChange(event.currentTarget.value)
        }
        required
      />

      <Switch
        label="Cliente ativo"
        description="Clientes inativos não aparecem nas novas importações."
        checked={active}
        onChange={(event) =>
          onActiveChange(event.currentTarget.checked)
        }
      />

      <Button
        leftSection={<IconDeviceFloppy size={17} />}
        onClick={onSave}
        loading={saving}
        w="fit-content"
      >
        Salvar dados gerais
      </Button>
    </Stack>
  );
}
