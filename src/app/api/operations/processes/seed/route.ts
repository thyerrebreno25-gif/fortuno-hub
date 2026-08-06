import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOperations, getOperationMember } from "@/modules/operations/auth";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase();

const templates = [
  {
    name: "Conciliação de Recebimentos",
    department: "BPO | Recebimentos",
    description: "Conciliação diária dos recebimentos, validação de divergências e saldos.",
    subjectToFine: false,
    notifyClient: true,
    checklist: [
      "Acessar os extratos bancários e o sistema financeiro referentes ao período.",
      "Comparar as transações do extrato bancário com os lançamentos existentes no sistema.",
      "Identificar recebimentos que já possuam lançamentos registrados anteriormente.",
      "Verificar se valores, datas e centavos correspondem corretamente entre banco e sistema.",
      "Identificar recebimentos ausentes, duplicados ou registrados com valores incorretos.",
      "Buscar informações complementares no histórico de e-mails, WhatsApp e documentos do cliente.",
      "Registrar e encaminhar ao cliente possíveis dúvidas ou movimentações não identificadas.",
      "Verificar se os saldos inicial e final coincidem entre o extrato bancário e o sistema.",
      "Validar tarifas bancárias, rendimentos, estornos, devoluções e transferências internas.",
      "Confirmar que todas as movimentações do período foram conciliadas ou justificadas.",
    ],
  },
  {
    name: "Agenda de Pagamentos",
    department: "BPO | Pagamentos",
    description: "Preparação, validação, agendamento e comunicação da janela de pagamentos.",
    subjectToFine: true,
    notifyClient: true,
    checklist: [
      "Realizar conciliação, caso ainda não tenha sido feita.",
      "Verificar e-mail para aprovações e instruções.",
      "Verificar WhatsApp para aprovações e instruções.",
      "Confirmar se todas as solicitações recebidas foram lançadas no sistema.",
      "Exportar a relação de aprovações pendentes no banco.",
      "Validar novas despesas recebidas via DDA, e-mail ou mensagem do cliente.",
      "Verificar lançamentos de pagamentos previstos no sistema.",
      "Lançar os pagamentos no banco.",
      "Exportar a relação de pagamentos do ERP.",
      "Exportar a relação de aprovações pendentes no banco.",
      "Enviar as relações ao cliente com a mensagem padrão da agenda de pagamentos.",
      "Informar ao cliente eventual necessidade de transferência de valores.",
      "Conferir fatura e limite do cartão de crédito.",
    ],
  },
];

export async function POST() {
  const member = await getOperationMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!canManageOperations(member.role)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

  const result = [];
  for (const template of templates) {
    const process = await prisma.operationProcess.upsert({
      where: { organizationId_normalizedName: { organizationId: member.organizationId, normalizedName: normalize(template.name) } },
      create: {
        organizationId: member.organizationId,
        name: template.name,
        normalizedName: normalize(template.name),
        department: template.department,
        description: template.description,
        subjectToFine: template.subjectToFine,
        notifyClient: template.notifyClient,
        checklistTemplates: { create: template.checklist.map((title, position) => ({ title, mandatory: true, position })) },
      },
      update: {
        department: template.department,
        description: template.description,
        subjectToFine: template.subjectToFine,
        notifyClient: template.notifyClient,
      },
      include: { checklistTemplates: { orderBy: { position: "asc" } } },
    });
    if (!process.checklistTemplates.length) {
      await prisma.operationChecklistTemplate.createMany({
        data: template.checklist.map((title, position) => ({ processId: process.id, title, mandatory: true, position })),
      });
    }
    result.push(process.name);
  }
  return NextResponse.json({ created: result });
}
