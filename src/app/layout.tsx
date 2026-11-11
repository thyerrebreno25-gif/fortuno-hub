import type { Metadata } from "next";
import {
  ColorSchemeScript,
  mantineHtmlProps,
} from "@mantine/core";

import "@mantine/core/styles.layer.css";
import "@mantine/notifications/styles.layer.css";
import "@mantine/dates/styles.layer.css";
import "@mantine/dropzone/styles.layer.css";
import "@fontsource-variable/inter";

import "./globals.css";
import "./design-foundation.css";
import {RecoveryLanding} from "@/components/session/recovery-landing";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Fortuno Hub",
  description:
    "Central de automação e gestão operacional da Fortuno",
  icons: {
    icon: [
      {
        url: "/brand/fortuno-icon-blue.png",
        type: "image/png",
        sizes: "512x298",
      },
    ],
    shortcut: "/brand/fortuno-icon-blue.png",
    apple: [
      {
        url: "/brand/fortuno-icon-blue.png",
        type: "image/png",
        sizes: "512x298",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript
          defaultColorScheme="light"
          localStorageKey="fortuno-theme"
        />
      </head>

      <body>
        <RecoveryLanding/>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
