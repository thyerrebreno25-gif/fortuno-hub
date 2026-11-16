# Participantes de grupos do WhatsApp

Em Dados do grupo → Membros, é possível adicionar um telefone com DDI/DDD ou remover um participante pelo menu de três pontos, com confirmação. O cadastro de contatos na agenda continua separado, em Contatos e grupos → Novo contato.

A adição permite selecionar até 25 grupos por operação. A busca consulta os grupos da agenda do número atualmente conectado. Cada grupo é processado sequencialmente em uma requisição independente; o resultado mostra confirmações e recusas por grupo. Não abre nem reabre chamados para gerenciar grupos da agenda. Mantenha a tela aberta durante o processamento; sair interrompe o agendamento dos próximos grupos, mas uma requisição já enviada pode concluir.

Exige permissão de visualizar/editar WhatsApp no Hub e ser gestor/administrador/master, ter canManage, ou ser o operador responsável por um chamado ativo do grupo. Para grupos da agenda sem atendimento, somente os gestores autorizados passam nessa regra. O número conectado também precisa ser administrador do grupo no WhatsApp, conferido novamente pela API antes de cada alteração. Não é permitido remover o proprietário nem o próprio número conectado quando identificados.

O backend aceita somente adição e remoção, usa o grupo da conversa ou da entrada de agenda validada pela organização/instância/número, consulta membros e direitos atuais, verifica novamente a conta após a consulta remota e registra tentativa/resultado em AuditLog. Uma chave por operação/grupo impede repetir a mesma solicitação. Não há repetição automática após timeout; confira os membros antes de uma nova tentativa. Nenhum token ou código de convite é exposto ao navegador.

Um HTTP 200 da Uazapi não significa que todos os participantes foram adicionados. O Hub exige `groupUpdated[].Error === 0` para o participante esperado. Recusas por privacidade são mostradas; convites individuais não são enviados automaticamente. A leitura do perfil usa cache de 120 segundos com invalidação por grupo após alteração, e o botão Atualizar membros consulta o WhatsApp diretamente.

Contrato consultado em 16/11/2026:
- https://docs.uazapi.com/reference/updateGroupParticipants.md
- https://docs.uazapi.com/reference/getGroupInfo.md
- https://docs.uazapi.com/reference/schemas/GroupParticipant.md

Validação automatizada usa respostas simuladas da Uazapi; não adiciona nem remove contatos reais.
