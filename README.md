# ConvertNow

Base robusta do sistema ConvertNow, criada do zero com Next.js, TypeScript, Prisma 7, PostgreSQL/Supabase e módulos independentes.

## Módulos

- Câmbio / Banco Central
- Extratos bancários → OFX
- Adquirentes → Conta Azul
- Faturas de cartão de crédito
- Conciliação BrasilMed
- Clientes e regras
- Histórico e auditoria
- Suporte
- Administração

## Inicialização

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

## Supabase

1. Crie um projeto no Supabase.
2. Copie URL, anon key e service role para `.env`.
3. Configure `DATABASE_URL` para o pooler e `DIRECT_URL` para conexão direta.
4. Execute as migrations do Prisma.

## Segurança

Nunca envie o arquivo `.env` para o Git. O ZIP inclui somente `.env.example`.

## Conciliação BrasilMed

A rota `/conciliacao-brasilmed` já contém:

- upload do PDF;
- leitura local pelo PDF.js;
- parser versionado;
- grade editável por funcionário;
- centro de custo, tipo de despesa e categoria;
- validação do Total Geral;
- exportação XLSX no formato de trabalho do Conta Azul.

O parser inicial está baseado no relatório `Relação Bancária Líquido Folha` enviado como referência e será ampliado por versões de layout.
