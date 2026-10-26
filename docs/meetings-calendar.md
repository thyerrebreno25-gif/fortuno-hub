# Central de Reuniões e Agenda

## Uso

- Reuniões: `/reunioes`. Tipos sugeridos ou personalizados, participantes da organização, pauta/ata, notas da equipe e checklist com responsável e prazo.
- Agenda: `/agenda`, sempre pessoal. Reuniões criam eventos para todos os participantes; entregas criam eventos de 30 minutos no prazo combinado para o responsável.
- Concluir uma entrega marca o evento concluído e desativa os lembretes. Reabrir volta a alertar. Reatribuir cancela o evento anterior e cria o do novo responsável.
- Cancelar reunião cancela seus eventos e suspende lembretes; realizar a reunião não encerra entregas pendentes.
- “Preparar próxima reunião” preenche uma nova reunião (+1 dia para Daily; +7 dias para os demais tipos). Ela só é criada ao salvar. Não existe série recorrente infinita.
- Organizadores e gestores editam reuniões; participantes consultam as reuniões em que estão incluídos, adicionam notas e gerenciam suas próprias entregas. Gestores podem acompanhar o conjunto da organização. Novos módulos MEETINGS e CALENDAR estão na matriz de permissões.

## Implantação

O build aplica apenas a migração aditiva e idempotente `20261026000000_meetings_calendar`, com trava transacional, chaves estrangeiras e RLS. Não recria tabelas existentes e não reaplica migrações históricas. Requer DIRECT_URL ou DATABASE_URL no ambiente da Vercel. O cliente Prisma é gerado no build.

## E-mail e lembretes

Usa `RESEND_API_KEY` e um remetente verificado em `MEETINGS_FROM_EMAIL` (ou o remetente operacional existente). Ações do produto enfileiram convites e avisos por destinatário; envio é individual, com chave de idempotência e tentativa posterior em falhas. Nunca envia durante os testes automatizados.

Configure `CRON_SECRET` aleatório na Vercel para habilitar `/api/cron/meeting-reminders`. A Vercel envia esse valor como Bearer. Agendamento: `0 12 * * *`, alvo diário às 09h de Brasília. O job cria lembretes para as próximas 24h e entregas atrasadas, reenvia filas pendentes e tenta sincronizar eventos do Google. Jobs limitam o tamanho e tempo do lote; filas grandes podem precisar de execução adicional autenticada. Não expor o segredo no navegador nem aceitar User-Agent como autenticação.

Os avisos no sino são calculados a cada atualização do Hub (30 segundos na tela ativa), independentemente de cron/e-mail, e deixam de aparecer quando a tarefa é concluída. IDs de lembretes são renovados por dia em America/Sao_Paulo. Resumos de reunião/GUT e os novos módulos também aparecem no dashboard e nos relatórios relacionados.

## Google Agenda — configurar depois

1. Ativar Google Calendar API em um projeto Google Cloud e configurar a tela de consentimento para os colaboradores.
2. Criar credencial OAuth de aplicação Web e autorizar a URL exata de retorno.
3. Configurar na Vercel:
   - `GOOGLE_CALENDAR_CLIENT_ID`
   - `GOOGLE_CALENDAR_CLIENT_SECRET`
   - `GOOGLE_CALENDAR_REDIRECT_URI=https://app.hubsuporte.shop/api/calendar/google/callback`
   - `NEXT_PUBLIC_APP_URL=https://app.hubsuporte.shop`
   - `INTEGRATION_TOKEN_ENCRYPTION_KEY` de 32 bytes em hex/base64 (pode usar a chave já existente; fallback para GMAIL_TOKEN_ENCRYPTION_KEY).
4. Cada colaborador abre Minha Agenda e autoriza a própria conta.

Escopo: `https://www.googleapis.com/auth/calendar.events`. Escrita no calendário principal. Autorização com state de uso único ligado à sessão, cookie HttpOnly, PKCE e refresh token criptografado em AES-256-GCM. Tokens nunca são retornados à interface.

Eventos do Hub vão para o Google após alterações; falhas ficam visíveis e podem ser tentadas por “Sincronizar agora” ou pelo job. Eventos externos são consultados no intervalo visível, com paginação, sem duplicar os que vieram do Hub. O Google não altera o checklist do Hub: edite reuniões e entregas na central. Desconectar apaga a credencial local e para sincronizações futuras, mas mantém os eventos já enviados no Google. Não usa a integração Gmail para ganhar acesso automático à agenda.

Documentação: https://developers.google.com/identity/protocols/oauth2/web-server e https://developers.google.com/workspace/calendar/api/v3/reference/events

## Gravações e transcrição

Configurações: `SUPABASE_SERVICE_ROLE_KEY`, URL/chave pública do Supabase existentes, `OPENAI_API_KEY` e `OPENAI_MEETING_TRANSCRIPTION_MODEL` (padrão `gpt-transcribe`). Custos de armazenamento/transcrição são da conta do serviço.

Bucket `meeting-recordings` privado, criado na primeira solicitação de upload. Acesso apenas por URL assinada após checar sessão, organização e participação. O áudio é enviado diretamente ao armazenamento, evitando o limite de corpo das funções da Vercel. A confirmação verifica o tamanho real antes de processar. Até 24.000.000 bytes por arquivo; gravação de microfone para em até 60 minutos e pode ser baixada localmente antes do envio.

Exige confirmação de ciência dos participantes. Grava o microfone local, não captura automaticamente o áudio remoto do Meet/Teams e não gera vídeo. Para chamadas remotas, pode-se anexar o áudio gravado pela plataforma. Transcrição é automática depois do upload quando há API configurada, com nova tentativa manual em falhas e preservação do áudio. Não cria tarefas automaticamente a partir de possíveis interpretações da transcrição.

Documentação: https://developers.openai.com/api/docs/guides/speech-to-text
