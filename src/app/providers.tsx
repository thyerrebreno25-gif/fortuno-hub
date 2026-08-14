"use client";

import { useState, type ReactNode } from "react";
import { MantineProvider, createTheme } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

const appFontFamily =
  '"Inter Variable", Inter, "Segoe UI", Roboto, Arial, sans-serif';

const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",

  colors: {
    convertBlue: [
      "#eef3ff",
      "#dce6ff",
      "#b8cdff",
      "#91b1ff",
      "#6c98ff",
      "#5086ff",
      "#3979ff",
      "#2768ef",
      "#1858df",
      "#0649c7",
    ],
  },

  fontFamily: appFontFamily,

  headings: {
    fontFamily: appFontFamily,
    fontWeight: "700",
  },
});

export default function Providers({
  children,
}: {
  children: ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },

          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider
        theme={theme}
        defaultColorScheme="light"
      >
        <ModalsProvider>
          <Notifications
            position="top-right"
            limit={4}
          />

          {children}
        </ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}
