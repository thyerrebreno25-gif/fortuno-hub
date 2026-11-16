# WhatsApp — operação e análise tática

## Fluxos de atendimento

- Transferir em lote: selecionar até 100 chamados abertos dos filtros atuais, escolher um setor, operador e observação interna. Operadores transferem seus chamados e os da fila; gestores autorizados podem transferir a equipe. A versão revisada (updatedAt), o vínculo do cliente, o responsável e o número conectado são conferidos novamente. Linhas alteradas são preservadas e retornadas como não transferidas. Não muda o cliente nem envia comentário ao cliente.
- Avisos de novas mensagens: apenas chamados próprios e fila para quem pode atender. Chamados de outros operadores não entram nesses avisos; alertas gerenciais de risco têm fluxo separado. A preferência de silenciar notificações é preservada.
- Pagamentos: blocos por cliente reúnem mensagens de vários grupos/contatos vinculados. Sem cliente, cada conversa permanece separada. Cada mensagem mantém sua conferência e criação de lançamento, sem baixar todos os alertas do bloco automaticamente.
- Menções: o editor e a mensagem salva exibem @Nome. No envio, apenas participantes selecionados e presentes no grupo são convertidos para @telefone e para o campo mentions do provedor. A conversão não altera o texto salvo no Hub. Não envolve IA externa.

## Monitoramento

Acesso apenas MASTER/ADMIN/MANAGER com permissão de visualizar WhatsApp, mantido no backend.

- Operacional: atendimentos que precisam de atenção no topo, fila e chamados abertos agora, tempo desde o início do conjunto de mensagens ainda sem resposta, riscos, referências de SLA, volume, equipe e clientes.
- Tático: respostas reais da pesquisa de satisfação, resolução total média e percentil 95, volume por dia da semana, dia do mês e hora, assuntos recorrentes por palavras-chave locais, clientes com mais mensagens e gargalos por setor, incluindo envios com falha/sem confirmação.

As referências iniciais de SLA são fila 15 minutos, primeira resposta 30 minutos e resolução 480 minutos, em tempo corrido. São referências operacionais padrão, não um SLA contratual informado pelo cliente. Avaliações sem observação suficiente são marcadas como sem avaliação; não entram no percentual de cumprimento. Espera pelo cliente não gera sinalização de demora de resolução.

Os alertas gerenciais consideram termos como urgente, urgência, importante, prioridade, reclamação, sem retorno e atrasado, com variações de caixa/acentos. São sinalizações por regras, não confirmação do sentido de uma mensagem. Esperas acima das referências e chamados longos também são sinalizados. A resposta do operador encerra o conjunto pendente; outra mensagem do cliente não reinicia a contagem desse conjunto. Alertas têm identificador estável e respeitam silenciamento.

## Escopo, limites e atualização

Distribuições e médias do período usam conversas iniciadas naquele período e sua situação atual. Reaberturas usam a mesma conversa e não representam novos tickets independentes nesse gráfico. A classificação de assuntos conta mensagens, podendo haver mais de um assunto por mensagem; mensagens não equivalem necessariamente a solicitações distintas. Falha/sem confirmação é status do envio e não avaliação de erro de um colaborador.

A fila e os riscos atuais são consultados separadamente, incluindo chamados abertos antes do período escolhido. Toda consulta é isolada por organização, número conectado, origem WhatsApp, atendimento canônico e marco de início da operação. Comentários internos e pesquisas automáticas não alimentam a demanda operacional.

Limites: 10.000 conversas do período, 2.000 mensagens recentes por conversa e 1.000 chamados ativos. A tela informa quando a consulta alcança os limites; filtros podem ser usados para reduzir a seleção. Texto de risco considera trechos das mensagens pendentes recentes, limitado para evitar ler todo o histórico em cada atualização.

Tela atualiza a cada 60 segundos enquanto visível. O resumo de chamados ativos tem cache de 30 segundos por organização/conta/filtros, compartilhado com alertas gerenciais, e usa índices existentes de mensagens. Não cria polling individual por colaborador nem consulta a Uazapi para calcular BI. Datas e agrupamentos usam America/Sao_Paulo. Não houve mudança de esquema nem dados de demonstração.

## Nome de participantes novos

Dados do grupo → Membros tenta resolver nomes conhecidos no perfil de grupo, agenda e histórico. Ao abrir Membros, consulta até seis perfis individuais sem nome, em pares, com timeout de 3,5 s por consulta e cache de dois minutos. O perfil de contato escolhe um nome real disponível em vez de deixar um telefone genérico ocultar o nome da agenda. Perfis adicionais do grupo são usados mesmo quando a lista legada de participantes vier vazia.

Na adição a grupos há nome opcional; preenchê-lo salva o contato na agenda antes da inclusão. Um participante sem nome também oferece ⋮ → Salvar nome do contato. Se o WhatsApp não disponibiliza o nome, o Hub não inventa a identidade da pessoa. Nenhum contato real foi alterado nos testes automatizados.
