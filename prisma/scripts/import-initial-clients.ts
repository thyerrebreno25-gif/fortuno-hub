import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { INITIAL_CLIENTS } from "../data/initial-clients";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL não encontrada no arquivo .env");
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

const ORGANIZATION_ID = "cmrunh6960000l8pt6kvfk64l";

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizeDocument(document: string): string {
  return document.replace(/\D/g, "");
}

async function main(): Promise<void> {
  console.log("\nIniciando carga inicial de clientes...\n");

  const organization = await prisma.organization.findUnique({
    where: { id: ORGANIZATION_ID },
    select: { id: true },
  });

  if (!organization) {
    throw new Error(
      `Organização não encontrada: ${ORGANIZATION_ID}`,
    );
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of INITIAL_CLIENTS) {
    const name = item.name.trim();
    const normalizedName = normalizeName(name);
    const document = normalizeDocument(item.document);

    try {
      if (document.length !== 14) {
        failed += 1;
        console.error(
          `✖ Documento inválido: ${name} (${item.document})`,
        );
        continue;
      }

      const existingClient = await prisma.client.findFirst({
        where: {
          organizationId: ORGANIZATION_ID,
          OR: [
            { document },
            { normalizedName },
          ],
        },
        select: {
          id: true,
          name: true,
          document: true,
        },
      });

      if (existingClient) {
        skipped += 1;
        console.log(
          `↷ Ignorado: ${name} — já cadastrado como ${existingClient.name}`,
        );
        continue;
      }

      await prisma.client.create({
        data: {
          organizationId: ORGANIZATION_ID,
          name,
          normalizedName,
          document,
          active: true,
        },
      });

      created += 1;
      console.log(`✔ Criado: ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`✖ Erro ao criar: ${name}`, error);
    }
  }

  console.log("\n────────────────────────────────────────");
  console.log(`Criados:   ${created}`);
  console.log(`Ignorados: ${skipped}`);
  console.log(`Erros:     ${failed}`);
  console.log("────────────────────────────────────────\n");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("\nFalha na carga inicial de clientes:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
