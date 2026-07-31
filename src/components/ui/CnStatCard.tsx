"use client";

import {
  Group,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";

import type { ReactNode } from "react";

import { CnCard } from "./CnCard";

type Props = {
  icon: ReactNode;

  label: string;

  value: string | number;

  subtitle?: string;
};

export function CnStatCard({
  icon,
  label,
  value,
  subtitle,
}: Props) {
  return (
    <CnCard>

      <Group justify="space-between">

        <Stack gap={2}>

          <Text
            size="sm"
            c="dimmed"
          >
            {label}
          </Text>

          <Text
            fw={700}
            fz={30}
          >
            {value}
          </Text>

          {subtitle && (
            <Text
              size="xs"
              c="dimmed"
            >
              {subtitle}
            </Text>
          )}

        </Stack>

        <ThemeIcon
          radius="xl"
          size={54}
          color="convertBlue.7"
        >
          {icon}
        </ThemeIcon>

      </Group>

    </CnCard>
  );
}