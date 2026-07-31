"use client";

import type { ReactNode } from "react";
import {
  Center,
  Loader,
  ScrollArea,
  Table,
  Text,
} from "@mantine/core";

export type CnDataTableColumn<T> = {
  key: string;
  title: string;
  width?: number | string;
  render: (item: T) => ReactNode;
};

type CnDataTableProps<T> = {
  columns: CnDataTableColumn<T>[];
  data: T[];
  rowKey: (item: T) => string;
  loading?: boolean;
  emptyMessage?: string;
};

export function CnDataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyMessage = "Nenhum registro encontrado.",
}: CnDataTableProps<T>) {
  if (loading) {
    return (
      <Center mih={240}>
        <Loader />
      </Center>
    );
  }

  if (data.length === 0) {
    return (
      <Center mih={240}>
        <Text c="dimmed">{emptyMessage}</Text>
      </Center>
    );
  }

  return (
    <ScrollArea>
      <Table
        highlightOnHover
        horizontalSpacing="lg"
        verticalSpacing="md"
        miw={900}
      >
        <Table.Thead>
          <Table.Tr>
            {columns.map((column) => (
              <Table.Th
                key={column.key}
                style={{ width: column.width }}
              >
                {column.title}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {data.map((item) => (
            <Table.Tr key={rowKey(item)}>
              {columns.map((column) => (
                <Table.Td key={column.key}>
                  {column.render(item)}
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}