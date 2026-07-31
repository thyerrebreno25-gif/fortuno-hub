"use client";

import {
  Card,
  type CardProps,
} from "@mantine/core";

export function CnCard({
  children,
  ...props
}: CardProps) {
  return (
    <Card
      radius="lg"
      shadow="xs"
      withBorder
      p="lg"
      {...props}
    >
      {children}
    </Card>
  );
}