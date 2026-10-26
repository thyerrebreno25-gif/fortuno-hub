# Notion — conexão e consulta

Tela: `/integracoes/notion`. Menu Notion e atalho no início, controlados pelo módulo NOTION na matriz de permissões. Master, Admin e Manager têm acesso por padrão; outros perfis precisam de liberação explícita. Contas CLIENT não acessam. `canManage` e `canView` são verificados separadamente em todas as rotas.

## Configurar

1. Criar uma conexão interna no Notion com capacidade de leitura de conteúdo.
2. Compartilhar apenas as páginas e bases desejadas com essa conexão: menu ••• da página → Conexões → adicionar a integração.
3. No Hub, abrir Notion → Conectar Notion e colar o token diretamente no campo protegido. O Hub valida `/users/me` e uma busca antes de salvar ou substituir uma credencial.
4. Liberar o módulo para os perfis da equipe que poderão consultar esse conteúdo compartilhado.

O token fica criptografado com AES-256-GCM na tabela NotionConnection, isolada por organização. Usa a chave de criptografia das integrações já existente (fallback para GMAIL_TOKEN_ENCRYPTION_KEY); não trocar essa chave ao configurar o Notion. Nunca cadastrar tokens no código, logs, URLs ou chat. A interface recebe apenas nome da integração, workspace e data da conferência. Desconectar remove só a credencial local, sem alterar páginas ou bases.

O build aplica a migração aditiva e idempotente `20261026010000_notion` por `scripts/ensure-notion.mjs`, com RLS e trava transacional. Não reaplica migrações históricas.

## Consulta

API fixada em `2026-03-11`. Busca por título, filtro páginas/bases e paginação de 50 registros. Bases usam `data_sources/{id}/query`, separadas do contêiner database. Propriedades e registros são apresentados em tabela; cada registro abre como página. Blocos filhos, tabelas e subpáginas são consultados sob demanda com paginação e navegação de retorno. Conteúdo textual é renderizado como texto React; não injeta HTML do Notion. Mídia e formatos não representados podem ser consultados por Abrir no Notion.

Somente endpoints de leitura do Notion são usados (GET para metadados/blocos, POST para busca e consulta). A integração não envia reuniões, altera tarefas nem escreve páginas. Conteúdo não é copiado para tabelas do Hub. Respostas de erro são traduzidas sem repassar mensagens do provedor que poderiam conter informações sensíveis; timeout e 429 são tratados sem loops de tentativas.

Referências oficiais:
- https://developers.notion.com/docs/authorization
- https://developers.notion.com/reference/versioning
- https://developers.notion.com/reference/post-search
- https://developers.notion.com/reference/query-a-data-source
