"use client";

import type { ReactNode } from "react";
import { Group, TextInput } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";

type Props = {
  search: string;
  onSearchChange(value: string): void;

  placeholder?: string;

  left?: ReactNode;

  right?: ReactNode;
};

export function CnToolbar({
  search,
  onSearchChange,
  placeholder = "Pesquisar...",
  left,
  right,
}: Props) {
  return (
    <Group justify="space-between">

      <Group>

        <TextInput
          value={search}
          placeholder={placeholder}
          leftSection={<IconSearch size={16} />}
          onChange={(e) =>
            onSearchChange(e.currentTarget.value)
          }
          w={340}
        />

        {left}

      </Group>

      {right}

    </Group>
  );
}