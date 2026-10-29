"use client";
import { IntegratedOverview } from "@/modules/dashboard/integrated-overview";

import { navigationGroup, navigationGroups } from "@/components/navigation-groups";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconActivity,
  IconBrain,
  IconArrowRight,
  IconBell,
  IconBrandWhatsapp,
  IconBuildingBank,
  IconCards,
  IconChartBar,
  IconClipboardCheck,
  IconFileAnalytics,
  IconFileInvoice,
  IconHeadset,
  IconHistory,
  IconLink,
  IconMail,
  IconRocket,
  IconSearch,
  IconSettings,
  IconUsers,
  IconWorldDollar,
} from "@tabler/icons-react";
import { NoticeHomePanel } from "@/components/notices/notice-home-panel";
import styles from "./inicio.module.css";

type Permission = {
  canView?: boolean;
};

type PermissionsResponse = {
  role: string;
  isTeamLeader?: boolean;
  permissions: Record<string, Permission>;
};

type Feature = {
  title: string;
  description: string;
  href: string;
  moduleCode: string;
  group: string;
  icon: React.ReactNode;
  badge?: string;
};

const features: Feature[] = [
  { title: "Conta Azul", description: "Gerencie as conexões das empresas e acompanhe a autorização de acesso aos dados financeiros.", href: "/integracoes/conta-azul", moduleCode: "PURCHASE_INVOICES", group: "Administração", icon: <IconLink size={24} /> },
  { title: "Rendimentos de aplicações", description: "Importe extratos de aplicações, confira saldos e envie vendas de rendimento com baixa na conta selecionada do CA.", href: "/rendimentos", moduleCode: "INVESTMENT_INCOME", group: "Operação financeira", icon: <IconBuildingBank size={24} />, badge: "Integrado" },
  { title: "Importação de contratos", description: "Leia contratos em lote e revise compradores, valores, vencimentos e a programação das vendas. Disponível para testes sem envio.", href: "/contratos", moduleCode: "CONTRACT_IMPORTS", group: "Operação financeira", icon: <IconFileInvoice size={24} />, badge: "Testes" },
  { title: "Gestão", description: "Acompanhe vencidos, importações, validação de saldo e conciliações por cliente.", href: "/gestao", moduleCode: "MANAGEMENT", group: "Visão geral", icon: <IconChartBar size={24} />, badge: "Novo" },
  { title: "Gestão de tarefas", description: "Organize tarefas, rotinas recorrentes, responsáveis e prazos da operação.", href: "/operacoes", moduleCode: "OPERATIONS", group: "Atendimento e clientes", icon: <IconClipboardCheck size={24} /> },
  { title: "Notion", description: "Consulte páginas, bases e documentos compartilhados com sua integração.", href: "/integracoes/notion", moduleCode: "NOTION", group: "Atendimento e clientes", icon: <IconFileAnalytics size={24} /> },
  { title: "Central de Reuniões", description: "Pautas, notas, metas e checklist por colaborador, conectados à agenda.", href: "/reunioes", moduleCode: "MEETINGS", group: "Atendimento e clientes", icon: <IconUsers size={24} /> },
  { title: "Agenda", description: "Seus compromissos, reuniões e prazos, com conexão individual ao Google Agenda.", href: "/agenda", moduleCode: "CALENDAR", group: "Atendimento e clientes", icon: <IconClipboardCheck size={24} /> },
  { title: "Mapeamento Operacional", description: "Consulte processos AS IS / TO BE e priorize atividades pela matriz GUT.", href: "/mapeamento-operacional", moduleCode: "OPERATIONAL_MAPPING", group: "Atendimento e clientes", icon: <IconActivity size={24} /> },
  {
    title: "Assistente Fortuno",
    description:
      "Tire dúvidas, consulte clientes conectados, analise arquivos e solicite auditorias preliminares.",
    href: "/assistente",
    moduleCode: "ASSISTANT",
    group: "Visão geral",
    icon: <IconBrain size={24} />,
    badge: "Inteligente",
  },
  {
    title: "Dashboard",
    description:
      "Acompanhe indicadores, visão operacional e informações consolidadas da plataforma.",
    href: "/dashboard",
    moduleCode: "DASHBOARD",
    group: "Visão geral",
    icon: <IconChartBar size={24} />,
  },
  {
    title: "Avisos",
    description:
      "Acompanhe alertas de clientes, lembretes, notas pessoais e confirmações de leitura.",
    href: "/avisos",
    moduleCode: "NOTICES",
    group: "Visão geral",
    icon: <IconBell size={24} />,
  },
  {
    title: "Auditoria",
    description:
      "Analise relatórios, identifique inconsistências e direcione correções para a operação.",
    href: "/auditoria",
    moduleCode: "AUDIT",
    group: "Visão geral",
    icon: <IconClipboardCheck size={24} />,
    badge: "Gestão",
  },
  {
    title: "Extratos",
    description:
      "Importe, leia e converta extratos bancários para apoiar as rotinas financeiras.",
    href: "/extratos",
    moduleCode: "IMPORTS",
    group: "Operação financeira",
    icon: <IconBuildingBank size={24} />,
  },
  {
    title: "Faturas",
    description:
      "Processe faturas de cartões e organize os lançamentos para a operação.",
    href: "/faturas",
    moduleCode: "IMPORTS",
    group: "Operação financeira",
    icon: <IconCards size={24} />,
  },
  {
    title: "Notas de compra",
    description:
      "Importe NF-e, revise itens e parcelas e gere as despesas diretamente no Conta Azul.",
    href: "/notas-fiscais",
    moduleCode: "PURCHASE_INVOICES",
    group: "Operação financeira",
    icon: <IconFileInvoice size={24} />,
    badge: "Integrado",
  },
  {
    title: "Adquirentes",
    description:
      "Analise recebimentos, vendas, tarifas e informações das adquirentes.",
    href: "/adquirentes",
    moduleCode: "IMPORTS",
    group: "Operação financeira",
    icon: <IconActivity size={24} />,
  },
  {
    title: "Conferência de vendas",
    description:
      "Compare a planilha de vendas com os recebimentos e categorias registrados no Conta Azul.",
    href: "/conferencia-vendas",
    moduleCode: "SALES_RECONCILIATION",
    group: "Operação financeira",
    icon: <IconClipboardCheck size={24} />,
    badge: "Conferência",
  },
  {
    title: "Conta Azul",
    description:
      "Vincule as empresas dos clientes e acompanhe todas as conexões em um só lugar.",
    href: "/integracoes/conta-azul",
    moduleCode: "PURCHASE_INVOICES",
    group: "Operação financeira",
    icon: <IconLink size={24} />,
    badge: "Integração",
  },
  {
    title: "Motor Cambial",
    description:
      "Execute conversões cambiais e utilize as ferramentas de apoio a operações em moeda estrangeira.",
    href: "/motor-cambial",
    moduleCode: "MOTOR_EXCHANGE",
    group: "Operação financeira",
    icon: <IconWorldDollar size={24} />,
  },
  {
    title: "Clientes",
    description:
      "Consulte e mantenha cadastros, contas, cartões e configurações dos clientes.",
    href: "/clientes",
    moduleCode: "CLIENTS",
    group: "Atendimento e clientes",
    icon: <IconUsers size={24} />,
  },
  {
    title: "Central WhatsApp",
    description:
      "Atenda clientes, organize a fila e acompanhe responsáveis, tempos e satisfação em um só lugar.",
    href: "/whatsapp",
    moduleCode: "WHATSAPP",
    group: "Atendimento e clientes",
    icon: <IconBrandWhatsapp size={24} />,
    badge: "Novo",
  },
  {
    title: "Central de e-mails",
    description: "Acesse a caixa de atendimento, distribua e-mails e acompanhe respostas e pendências da equipe.",
    href: "/atendimento",
    moduleCode: "SERVICE_CENTER",
    group: "Atendimento e clientes",
    icon: <IconMail size={24} />,
  },
  {
    title: "Onboarding",
    description:
      "Conduza a implantação de novos clientes e acompanhe as etapas do processo.",
    href: "/onboarding",
    moduleCode: "ONBOARDING",
    group: "Atendimento e clientes",
    icon: <IconRocket size={24} />,
  },
  {
    title: "Relatórios",
    description:
      "Acesse relatórios e informações consolidadas para análise e tomada de decisão.",
    href: "/relatorios",
    moduleCode: "REPORTS",
    group: "Análises",
    icon: <IconFileAnalytics size={24} />,
  },
  {
    title: "Histórico",
    description:
      "Consulte registros anteriores e acompanhe o histórico das atividades realizadas.",
    href: "/historico",
    moduleCode: "HISTORY",
    group: "Análises",
    icon: <IconHistory size={24} />,
  },
  {
    title: "Suporte",
    description:
      "Acesse os canais e recursos de apoio para dúvidas e necessidades operacionais.",
    href: "/suporte",
    moduleCode: "SUPPORT",
    group: "Sistema",
    icon: <IconHeadset size={24} />,
  },
  {
    title: "Configurações",
    description:
      "Gerencie usuários, permissões e demais configurações administrativas do Fortuno Hub.",
    href: "/configuracoes",
    moduleCode: "SETTINGS",
    group: "Sistema",
    icon: <IconSettings size={24} />,
  },
].map(feature => ({ ...feature, group: navigationGroup(feature.href) }));

const groupOrder = navigationGroups;

export default function InicioPage() {
  const [data, setData] =
    useState<PermissionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;

    fetch("/api/permissions/me", {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            payload.error ||
              "Não foi possível carregar suas permissões.",
          );
        }

        if (active) {
          setData(payload);
        }
      })
      .catch(() => {
        if (active) {
          setData({
            role: "",
            permissions: {},
          });
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const visibleFeatures = useMemo(() => {
    if (!data) return [];

    const normalizedSearch =
      search.trim().toLowerCase();

    return features
      .filter(
        (feature) =>
          data.permissions?.[feature.moduleCode]
            ?.canView !== false,
      )
      .map((feature) => {
        if (
          feature.moduleCode === "AUDIT" &&
          data.role === "OPERATOR" &&
          !data.isTeamLeader
        ) {
          return {
            ...feature,
            title: "Minhas Auditorias",
            description:
              "Veja os apontamentos enviados pela supervisão, registre as correções e devolva para validação.",
            href: "/auditoria/minhas",
            badge: "Operador",
          };
        }

        return feature;
      })
      .filter((feature) => {
        if (!normalizedSearch) return true;

        return [
          feature.title,
          feature.description,
          feature.group,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      });
  }, [data, search]);

  if (loading) {
    return (
      <Group justify="center" py={80}>
        <Loader />
      </Group>
    );
  }

  return (
    <Stack gap={28} className={styles.page}>
      <Paper
        radius="lg"
        p={{ base: "lg", md: 28 }}
        className={styles.hero}
      >
        <div className={styles.heroLayout}>
          <Stack gap="md" className={styles.heroContent}>
            <div>
              <Text
                size="xs"
                fw={800}
                c="blue"
                tt="uppercase"
                lts={1.2}
              >
                Fortuno Hub
              </Text>

              <Title
                order={1}
                mt={4}
                className={styles.heroTitle}
              >
                O que você deseja fazer hoje?
              </Title>
              <Text c="dimmed" mt="sm">
                Encontre todas as telas do Fortuno Hub e veja o que você pode fazer em cada uma.
              </Text>
            </div>

            <TextInput
              size="md"
              radius="md"
              placeholder="Buscar uma funcionalidade..."
              leftSection={<IconSearch size={18} />}
              value={search}
              onChange={(event) =>
                setSearch(event.currentTarget.value)
              }
              maw={620}
              className={styles.search}
            />
          </Stack>

          {data?.permissions?.NOTICES?.canView !== false && <NoticeHomePanel />}
        </div>
      </Paper>

      <IntegratedOverview />

      {groupOrder.map((group) => {
        const groupFeatures =
          visibleFeatures.filter(
            (feature) =>
              feature.group === group,
          );

        if (groupFeatures.length === 0) {
          return null;
        }

        return (
          <Stack key={group} gap={12} className={styles.featureSection}>
            <Text
              size="xs"
              fw={800}
              c="dimmed"
              tt="uppercase"
              lts={1}
              className={styles.sectionTitle}
            >
              {group}
            </Text>

            <SimpleGrid
              cols={{
                base: 1,
                sm: 2,
                lg: 3,
                xl: 4,
              }}
              spacing="md"
            >
              {groupFeatures.map((feature) => (
                <Paper
                  key={`${feature.title}-${feature.href}`}
                  component={Link}
                  href={feature.href as Route}
                  withBorder
                  radius="md"
                  p="lg"
                  className={styles.featureCard}
                >
                  <Group
                    justify="space-between"
                    align="flex-start"
                  >
                    <ThemeIcon
                      size={42}
                      radius="md"
                      variant="light"
                    >
                      {feature.icon}
                    </ThemeIcon>

                    {feature.badge && (
                      <Badge variant="light">
                        {feature.badge}
                      </Badge>
                    )}
                  </Group>

                  <Title order={4} mt="md" className={styles.cardTitle}>
                    {feature.title}
                  </Title>

                  <Text size="sm" c="dimmed" mt="xs">
                    {feature.description}
                  </Text>

                  <Group gap={6} mt="md" className={styles.cardAction}>
                    <Text
                      size="sm"
                      fw={700}
                      c="blue"
                    >
                      Acessar
                    </Text>
                    <IconArrowRight
                      size={15}
                      color="var(--mantine-color-blue-6)"
                    />
                  </Group>
                </Paper>
              ))}
            </SimpleGrid>
          </Stack>
        );
      })}

      {visibleFeatures.length === 0 && (
        <Paper withBorder radius="lg" p="xl">
          <Text fw={700}>
            Nenhuma funcionalidade encontrada.
          </Text>
          <Text size="sm" c="dimmed" mt={4}>
            Tente outro termo ou solicite ao
            administrador a liberação dos módulos
            necessários.
          </Text>
        </Paper>
      )}

    </Stack>
  );
}
