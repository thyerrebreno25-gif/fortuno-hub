"use client";

import {
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";

import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function CnPageHeader({
  eyebrow,
  title,
  description,
  action,
}: Props) {
  return (
    <Group
      justify="space-between"
      align="end"
      mb="xl"
    >
      <Stack gap={4}>
        {eyebrow && (
          <Text
            size="xs"
            fw={700}
            c="convertBlue.7"
            tt="uppercase"
            style={{
              letterSpacing: 1.2,
            }}
          >
            {eyebrow}
          </Text>
        )}

        <Title order={2}>
          {title}
        </Title>

        {description && (
          <Text
            c="dimmed"
            maw={700}
          >
            {description}
          </Text>
        )}
      </Stack>

      {action}
    </Group>
  );
}