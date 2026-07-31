"use client";

import {
  Button,
  type ButtonProps,
} from "@mantine/core";

export function CnButton({
  children,
  ...props
}: ButtonProps) {
  return (
    <Button
      radius="md"
      size="md"
      color="convertBlue.7"
      fw={600}
      {...props}
    >
      {children}
    </Button>
  );
}