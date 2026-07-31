import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

function cleanDocument(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\D/g, "");
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authenticationError,
    } = await supabase.auth.getUser();

    if (authenticationError || !user || !user.email) {
      return NextResponse.json(
        {
          error: "Sua sessão expirou. Entre novamente.",
        },
        {
          status: 401,
        },
      );
    }

    const body = await request.json();

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    const document = cleanDocument(body.document);

    if (name.length < 3) {
      return NextResponse.json(
        {
          error: "Informe um nome de organização válido.",
        },
        {
          status: 400,
        },
      );
    }

    if (document && document.length !== 14) {
      return NextResponse.json(
        {
          error: "O CNPJ deve conter 14 números.",
        },
        {
          status: 400,
        },
      );
    }

    const existingMembership =
      await prisma.organizationMember.findFirst({
        where: {
          userId: user.id,
        },
        select: {
          organizationId: true,
        },
      });

    if (existingMembership) {
      return NextResponse.json(
        {
          error: "Você já pertence a uma organização.",
        },
        {
          status: 409,
        },
      );
    }

    if (document) {
      const organizationWithSameDocument =
        await prisma.organization.findUnique({
          where: {
            document,
          },
          select: {
            id: true,
          },
        });

      if (organizationWithSameDocument) {
        return NextResponse.json(
          {
            error: "Já existe uma organização cadastrada com este CNPJ.",
          },
          {
            status: 409,
          },
        );
      }
    }

    const userName =
      typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name.trim()
        : null;

    const organization = await prisma.$transaction(
      async (transaction) => {
        await transaction.user.upsert({
          where: {
            id: user.id,
          },
          update: {
            email: user.email!,
            name: userName || undefined,
          },
          create: {
            id: user.id,
            email: user.email!,
            name: userName,
          },
        });

        const createdOrganization =
          await transaction.organization.create({
            data: {
              name,
              document: document || null,
            },
          });

        await transaction.organizationMember.create({
          data: {
            organizationId: createdOrganization.id,
            userId: user.id,
            role: "MASTER",
          },
        });

        return createdOrganization;
      },
    );

    return NextResponse.json(
      {
        message: "Organização criada com sucesso.",
        organization,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error("Erro ao criar organização:", error);

    return NextResponse.json(
      {
        error: "Não foi possível criar a organização.",
      },
      {
        status: 500,
      },
    );
  }
}