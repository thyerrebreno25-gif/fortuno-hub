import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  ClientConflictError,
  ClientPermissionError,
  clientService,
} from "@/modules/clients/services/client.service";
import { type AuthenticatedMember } from "@/modules/clients/types/client.types";
import {
  ClientValidationError,
  validateCreateClientPayload,
} from "@/modules/clients/validations/client.validation";
import { getRolePermissions } from "@/modules/permissions/permissions";

async function getAuthenticatedMember(): Promise<AuthenticatedMember | null> {
  const supabase = await createSupabaseClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const membership = await prisma.organizationMember.findFirst({
    where: {
      userId: user.id,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      userId: true,
      organizationId: true,
      role: true,
    },
  });

  if (!membership) {
    return null;
  }

  return membership;
}

function parsePositiveInteger(
  value: string | null,
  fallback: number,
  maximum?: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  if (maximum) {
    return Math.min(parsed, maximum);
  }

  return parsed;
}

export async function GET(request: Request) {
  try {
    const member = await getAuthenticatedMember();

    if (!member) {
      return NextResponse.json(
        {
          error:
            "Sua sessão expirou ou você não pertence a uma organização.",
        },
        {
          status: 401,
        },
      );
    }

    const permissions = await getRolePermissions(
      member.organizationId,
      member.role,
    );

    if (!permissions.CLIENTS.canView) {
      return NextResponse.json(
        { error: "Você não possui permissão para visualizar clientes." },
        { status: 403 },
      );
    }

    const url = new URL(request.url);

    const page = parsePositiveInteger(
      url.searchParams.get("page"),
      1,
    );

    const pageSize = parsePositiveInteger(
      url.searchParams.get("pageSize"),
      10,
      100,
    );

    const search = url.searchParams.get("search")?.trim() || "";

    const requestedStatus = url.searchParams.get("status");

    const status =
      requestedStatus === "active" ||
      requestedStatus === "inactive" ||
      requestedStatus === "all"
        ? requestedStatus
        : "active";

    const result = await clientService.list({
      organizationId: member.organizationId,
      search,
      status,
      page,
      pageSize,
    });

    return NextResponse.json({
      ...result,
      permission: permissions.CLIENTS,
    });
  } catch (error) {
    console.error("Erro ao listar clientes:", error);

    return NextResponse.json(
      {
        error: "Não foi possível carregar os clientes.",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(request: Request) {
  try {
    const member = await getAuthenticatedMember();

    if (!member) {
      return NextResponse.json(
        {
          error:
            "Sua sessão expirou ou você não pertence a uma organização.",
        },
        {
          status: 401,
        },
      );
    }

    const body = await request.json();

    const input = validateCreateClientPayload(body);

    const client = await clientService.create(member, input);

    return NextResponse.json(
      {
        message: "Cliente cadastrado com sucesso.",
        client,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    if (error instanceof ClientValidationError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 400,
        },
      );
    }

    if (error instanceof ClientPermissionError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 403,
        },
      );
    }

    if (error instanceof ClientConflictError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 409,
        },
      );
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        {
          error: "O corpo da requisição possui um formato inválido.",
        },
        {
          status: 400,
        },
      );
    }

    console.error("Erro ao cadastrar cliente:", error);

    return NextResponse.json(
      {
        error: "Não foi possível cadastrar o cliente.",
      },
      {
        status: 500,
      },
    );
  }
}
