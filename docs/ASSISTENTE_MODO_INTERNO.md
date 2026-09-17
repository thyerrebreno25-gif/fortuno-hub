# Assistente interna e aprendizado em Faturas

A Assistente inicia no **modo interno**, sem chamadas, uploads ou consumo da OpenAI. Ela interpreta comandos conhecidos e utiliza a base de ajuda ou consultas autorizadas do Fortuno/Conta Azul; não é uma IA de conversa livre. Perguntas fora desses fluxos não ativam a IA automaticamente. A opção “Usar IA externa” é explícita e continua sujeita aos limites da conta.

Exemplos:

- “Como importar uma fatura?”
- “Liste clientes”
- “Resuma a situação deste cliente”
- “Liste categorias deste cliente”
- “Centros de custo deste cliente”
- “Relatório financeiro deste cliente no mês passado”
- “Relatório financeiro deste cliente de 01/08/2026 a 31/08/2026”

Selecione o cliente no topo. Clientes nomeados só são consultados se a busca dentro do acesso do usuário encontrar uma única correspondência. Relatórios podem ser baixados em TXT e informam fontes e limitações: período por vencimento, até 1.000 eventos por direção e saldos atuais (não históricos nem comparados com saldos bancários). Não confirmam conciliação completa ou recorrências ausentes. Dados indisponíveis não são exibidos como zero. O chat interno não cria, liquida, exclui ou envia lançamentos financeiros.

Anexos compatíveis com o leitor determinístico de adquirentes podem ter seus totais resumidos. Outros arquivos são encaminhados às telas dos leitores específicos; layouts de adquirentes não reconhecidos continuam gerando chamados. No modo interno, nenhum arquivo é enviado à OpenAI.

## Aprender categorias na fatura aberta

Depois de importar uma fatura, **Aprender categorias** aparece junto de “Nova fatura”. O cliente precisa estar conectado ao Conta Azul. Escolha a conta/cartão, informe um período de vencimento de até 93 dias, conclua a consulta em lotes, revise conflitos e confirme.

O sistema salva regras por cliente para próximas importações e preenche categorias pendentes da fatura aberta. Preserva classificações existentes, centros já preenchidos e marcações de revisão. Só aceita categorias do catálogo atual do cliente e do tipo correto. Centros de custo aprendidos são aplicados quando essa opção estiver ativa e corresponderem à categoria. O aprendizado utiliza apenas leituras no Conta Azul e não depende da OpenAI.

A consulta/confirmação na tela de Faturas exige permissão de Importações (visualizar e importar ou editar), edição de Clientes, responsabilidade/escopo do cliente e conexão ativa. Sessões de aprendizado ficam arquivadas, separadas das conversas ativas, e são restritas ao proprietário, organização e cliente. Prévias sem confirmação expiram em 24 horas. Regras existentes são preservadas, inclusive criadas manualmente depois da prévia. Confirmações repetidas não duplicam regras.

Enquanto a consulta/salvamento está em andamento, a sessão permanece ativa e ações conflitantes da fatura ficam desabilitadas. Se a atualização da fatura falhar depois de salvar as regras, use “Aplicar à fatura aberta” na prévia confirmada.

Nenhuma variável nova ou migração de banco é necessária.
