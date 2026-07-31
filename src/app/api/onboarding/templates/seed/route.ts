import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOnboarding, getOnboardingMember } from "@/modules/onboarding/auth/onboarding-auth";

const structure = [
  ["Formalização e handover", [
    ["Dados cadastrais", [
      ["Empresa", "Validar CNPJ, razão social, ramo, localização e regime tributário", 35, null, false],
      ["Responsável", "Validar nome, CPF, nascimento, e-mails e telefone", 25, null, false],
    ]],
    ["Contrato", [["D4Sign", "Gerar contrato com duas testemunhas e acompanhar assinatura", 45, "Faça follow-up diário até a assinatura.", false]]],
    ["Transição", [["Handover", "Registrar contrato, empresa, perfil, expectativas, riscos e oportunidades", 50, null, false]]],
    ["Documentação", [["Notion", "Adicionar/atualizar as informações desta atividade no Notion", 15, null, true]]],
  ]],
  ["Estruturação financeira e digital", [
    ["Cora", [["Cobrança", "Cadastrar cliente, cobrança e taxa de implantação", 35, null, false]]],
    ["Gestta", [["Tarefas", "Criar fluxo, supervisor, operador e responsáveis", 45, null, false]]],
    ["Conta Azul", [["Cadastro", "Incluir no Painel da Contabilidade e vincular o usuário do BPO", 50, null, false]]],
    ["Holder", [["Parametrização", "Configurar código, tarefas, usuário externo e faturamento", 40, null, false]]],
    ["Documentação", [["Notion", "Atualizar e validar todas as informações no Notion", 15, null, true]]],
  ]],
  ["Cadastro e comunicação", [
    ["WhatsApp", [["Grupo oficial", "Criar grupo BPO | Empresa e salvar contatos no padrão", 20, null, false]]],
    ["E-mail", [["Canal oficial", "Definir e-mail, criar filtros e testar alertas", 30, null, false]]],
    ["Agendamento", [["Kickoff", "Agendar Kickoff com Comercial, Gerencial e Operação", 20, null, false]]],
    ["Documentação", [["Notion", "Registrar canais, contatos e reuniões no Notion", 15, null, true]]],
  ]],
  ["Kickoff", [
    ["Preparação", [["Revisão", "Revisar handover, contrato, expectativas e cronograma", 45, null, false]]],
    ["Reunião", [
      ["Transferência de confiança", "Apresentar equipe, cronograma, canais e próximos passos", 60, null, false],
      ["Janela de pagamentos", "Definir dias, horários, aprovação e responsáveis", 30, null, false],
    ]],
    ["Pós-reunião", [["Pendências", "Solicitar certificado, DDA, agendamento, extratos e meios de recebimento", 30, null, false]]],
    ["Documentação", [["Notion", "Adicionar ata, expectativas e pendências no Notion", 20, null, true]]],
  ]],
  ["Integrações e acessos", [
    ["Bancos", [
      ["Banco principal", "Validar consulta, extrato, DDA, agendamento e teste de acesso", 60, "Se não houver validação em 7 dias, marque uma reunião técnica.", false],
    ]],
    ["Certificado digital", [["A1/A3", "Validar tipo, titular, vencimento, acesso e armazenamento", 45, null, false]]],
    ["Meios de recebimento", [["Adquirentes e gateways", "Mapear integrações, Pix, boletos e plataformas", 75, null, false]]],
    ["Sistemas", [["Conta Azul, Gestta, Cora, Notion e Holder", "Testar acessos, permissões e integrações", 90, null, false]]],
    ["Documentação", [["Notion", "Atualizar acessos e integrações no Notion", 20, null, true]]],
  ]],
  ["Mapeamento operacional", [
    ["Contas a receber", [["Processos", "Mapear vendas, cobrança, recebimentos, notas, transferências e rendimentos", 90, null, false]]],
    ["Contas a pagar", [["Processos", "Mapear documentos, aprovação, empréstimos, recorrências, cartões e janela", 90, null, false]]],
    ["Documentação", [["Notion", "Registrar os processos mapeados no Notion", 25, null, true]]],
  ]],
  ["Implantação operacional", [
    ["Contas a receber", [
      ["Integração", "Integrar adquirentes e gateways ao Conta Azul", 120, null, false],
      ["Conciliação", "Conciliar competência inicial e validar inadimplência", 180, null, false],
    ]],
    ["Contas a pagar", [
      ["Cadastros", "Cadastrar empréstimos, parcelamentos, recorrências e contas previstas", 150, null, false],
      ["Acessos", "Validar DDA, operadores bancários e fluxo de faturas", 100, null, false],
    ]],
    ["Documentação", [["Notion", "Registrar regras, recorrências e particularidades no Notion", 25, null, true]]],
  ]],
  ["Saneamento e validação", [
    ["Saldos", [["Limpeza", "Ajustar saldos iniciais e limpar contas antigas", 180, "Nunca execute a primeira janela sobre saldos não validados.", false]]],
    ["Qualidade", [["Revisões", "Revisar duplicidades, categorias, vencidos, recebíveis e competência", 150, null, false]]],
    ["Cliente", [["Aprovação", "Obter validação formal dos ajustes", 45, null, false]]],
    ["Documentação", [["Notion", "Registrar ajustes e decisões no Notion", 25, null, true]]],
  ]],
  ["Primeira janela", [
    ["Execução", [["Pagamentos", "Preparar títulos, conferir vencimentos e realizar agendamentos", 180, null, false]]],
    ["Validação", [["Cliente", "Solicitar aprovação, acompanhar execução e registrar intercorrências", 90, null, false]]],
    ["Documentação", [["Notion", "Registrar a primeira janela e as intercorrências no Notion", 25, null, true]]],
  ]],
  ["Encerramento e transição", [
    ["Relatório", [["Descritivo", "Registrar dificuldades, customizações, acessos, rotinas e riscos", 120, null, false]]],
    ["Reunião de resultados", [["Entrega", "Apresentar estrutura, saneamento, pagamentos e operador definitivo", 90, null, false]]],
    ["Passagem para operação", [["Status", "Transferir responsabilidade e mover cliente para Operação", 45, null, false]]],
    ["Documentação", [["Notion", "Revisar e concluir toda a documentação no Notion", 30, null, true]]],
  ]],
] as const;

export async function POST() {
  const member = await getOnboardingMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!canManageOnboarding(member.role)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

  const existing = await prisma.onboardingTemplate.findFirst({ where: { organizationId: member.organizationId, name: "BPO Financeiro — Jornada de 30 dias" } });
  if (existing) return NextResponse.json({ template: existing, created: false });

  const template = await prisma.onboardingTemplate.create({
    data: {
      organizationId: member.organizationId,
      name: "BPO Financeiro — Jornada de 30 dias",
      description: "Template operacional Fortuno com SLA de 30 dias.",
      slaDays: 30,
      active: true,
      isDefault: true,
      categories: {
        create: structure.map(([categoryName, activities], categoryIndex) => ({
          name: categoryName,
          position: categoryIndex + 1,
          activities: {
            create: activities.map(([activityName, tasks], activityIndex) => ({
              name: activityName,
              position: activityIndex + 1,
              tasks: {
                create: tasks.map(([subcategory, title, estimatedMinutes, tip, isNotionReminder], taskIndex) => ({
                  subcategory,
                  title,
                  estimatedMinutes,
                  tip,
                  isNotionReminder,
                  position: taskIndex + 1,
                  mandatory: true,
                })),
              },
            })),
          },
        })),
      },
    },
  });

  return NextResponse.json({ template, created: true }, { status: 201 });
}
