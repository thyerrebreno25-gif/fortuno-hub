"use client";

import {
  Button,
  Stack,
  Switch,
  TextInput,
  Select,
} from "@mantine/core";
import { IconDeviceFloppy } from "@tabler/icons-react";

type Props = {
  name: string;
  document: string;
  active: boolean;
  operationalEmail: string;
  operationalEmailCc: string;
  cluster: "A" | "B" | "C";
  saving: boolean;
  onNameChange: (value: string) => void;
  onDocumentChange: (value: string) => void;
  onActiveChange: (value: boolean) => void;
  onOperationalEmailChange: (value: string) => void;
  onOperationalEmailCcChange: (value: string) => void;
  onClusterChange: (value: "A" | "B" | "C") => void;
  onSave: () => void;
};

export function ClientGeneralTab({
  name,
  document,
  active,
  operationalEmail,
  operationalEmailCc,
  cluster,
  saving,
  onNameChange,
  onDocumentChange,
  onActiveChange,
  onOperationalEmailChange,
  onOperationalEmailCcChange,
  onClusterChange,
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

      <TextInput
        type="email"
        label="E-mail operacional"
        description="Recebe automaticamente a conclusão das atividades."
        value={operationalEmail}
        onChange={(event) => onOperationalEmailChange(event.currentTarget.value)}
      />

      <Select
        label="Cluster do cliente"
        description="Define criticidade, prioridade e frequência futura de auditorias."
        data={[{ value: "A", label: "Cluster A — alta criticidade" }, { value: "B", label: "Cluster B — criticidade intermediária" }, { value: "C", label: "Cluster C — operação padrão" }]}
        value={cluster}
        onChange={(value) => onClusterChange((value || "C") as "A" | "B" | "C")}
      />

      <TextInput
        label="E-mails em cópia"
        description="Separe vários endereços por vírgula."
        value={operationalEmailCc}
        onChange={(event) => onOperationalEmailCcChange(event.currentTarget.value)}
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
