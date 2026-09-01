import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findAuthorizedClient, getPurchaseInvoiceMember, getPurchaseInvoicePermission } from "@/modules/purchase-invoices/server/auth";
import { parseNfeXml } from "@/modules/purchase-invoices/server/nfe-parser";

const MAX_XML_SIZE = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.json({ error: "Sua sessão expirou." }, { status: 401 });
  const permission = await getPurchaseInvoicePermission(member);
  if (!permission.canImport) return NextResponse.json({ error: "Você não possui permissão para importar notas fiscais." }, { status: 403 });

  try {
    const formData = await request.formData();
    const clientId = String(formData.get("clientId") || "");
    const client = await findAuthorizedClient(member, clientId);
    if (!client) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (!files.length) return NextResponse.json({ error: "Selecione ao menos um XML de NF-e." }, { status: 400 });
    if (files.some((file) => file.size > MAX_XML_SIZE)) return NextResponse.json({ error: "Cada XML deve ter no máximo 8 MB." }, { status: 400 });

    const connection = await prisma.contaAzulConnection.findUnique({ where: { clientId } });
    const rules = await prisma.purchaseInvoiceRule.findMany({
      where: { clientId },
      orderBy: { lastUsedAt: "desc" },
    });
    const created: string[] = [];
    const duplicates: string[] = [];

    for (const file of files) {
      if (!/\.xml$/i.test(file.name) && !file.type.includes("xml")) {
        throw new Error(`${file.name}: envie o XML original da NF-e.`);
      }
      const xml = await file.text();
      const parsed = parseNfeXml(xml);
      const existing = await prisma.purchaseInvoice.findUnique({
        where: { clientId_sourceKey: { clientId, sourceKey: parsed.sourceKey } },
        select: { id: true },
      });
      if (existing) {
        duplicates.push(file.name);
        continue;
      }

      const supplierDocument = parsed.supplierDocument || "";
      const preparedItems = parsed.items.map((item) => {
        const productCode = item.productCode || "";
        const matchingRule =
          rules.find((rule) =>
            rule.supplierDocument === supplierDocument &&
            rule.productCode === productCode &&
            rule.normalizedDescription === item.normalizedDescription,
          ) ||
          (productCode
            ? rules.find((rule) => rule.supplierDocument === supplierDocument && rule.productCode === productCode)
            : undefined) ||
          rules.find((rule) =>
            rule.supplierDocument === supplierDocument &&
            rule.normalizedDescription === item.normalizedDescription,
          );
        return {
          ...item,
          contaAzulCategoryId: matchingRule?.contaAzulCategoryId || null,
          contaAzulCategoryName: matchingRule?.contaAzulCategoryName || null,
          contaAzulCostCenterId: matchingRule?.contaAzulCostCenterId || null,
          contaAzulCostCenterName: matchingRule?.contaAzulCostCenterName || null,
          learned: Boolean(matchingRule),
        };
      });
      const allCategorized = preparedItems.every((item) => item.contaAzulCategoryId);

      const invoice = await prisma.purchaseInvoice.create({
        data: {
          organizationId: member.organizationId,
          clientId,
          connectionId: connection?.active ? connection.id : null,
          createdById: member.userId,
          source: "XML_UPLOAD",
          sourceKey: parsed.sourceKey,
          accessKey: parsed.accessKey,
          number: parsed.number,
          series: parsed.series,
          supplierName: parsed.supplierName,
          supplierDocument: parsed.supplierDocument,
          issueDate: parsed.issueDate,
          competenceDate: parsed.issueDate,
          dueDate: parsed.dueDate,
          totalProducts: parsed.totalProducts,
          totalInvoice: parsed.totalInvoice,
          status: allCategorized ? "PENDING_REVIEW" : "PENDING_REVIEW",
          rawXml: xml,
          metadata: { ...parsed.metadata, originalName: file.name },
          items: { create: preparedItems },
        },
      });
      created.push(invoice.id);
    }

    return NextResponse.json({
      message: `${created.length} nota(s) importada(s)${duplicates.length ? ` e ${duplicates.length} duplicada(s) ignorada(s)` : ""}.`,
      created,
      duplicates,
    }, { status: 201 });
  } catch (error) {
    console.error("Erro ao importar NF-e:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível importar a NF-e." }, { status: 400 });
  }
}
