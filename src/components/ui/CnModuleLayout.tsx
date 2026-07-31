"use client";

import type { ReactNode } from "react";
import { Stack } from "@mantine/core";

import { CnPageHeader } from "./CnPageHeader";

type CnModuleLayoutProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  stats?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
};

export function CnModuleLayout({
  eyebrow,
  title,
  description,
  action,
  stats,
  toolbar,
  children,
}: CnModuleLayoutProps) {
  return (
    <Stack gap="xl">
      <CnPageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        action={action}
      />

      {stats}

      {toolbar}

      {children}
    </Stack>
  );
}