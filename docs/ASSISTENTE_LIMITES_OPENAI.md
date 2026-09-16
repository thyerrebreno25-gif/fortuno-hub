# Contexto e limites da Assistente Fortuno

## Redução de contexto

- Cada pergunta inicia uma nova resposta na OpenAI, com até oito mensagens anteriores e 12.000 caracteres de histórico. O histórico completo continua salvo e visível no Fortuno.
- As respostas anteriores são reduzidas a 1.800 caracteres. Anexos antigos entram apenas como nome e resumo determinístico; arquivos originais não são reenviados automaticamente. A assistente deve pedir o arquivo novamente se precisar de detalhes que não estejam no resumo.
- `previous_response_id` é utilizado somente para continuar as ferramentas da pergunta atual, nunca para encadear todas as perguntas de uma conversa antiga.
- Resultados de ferramentas são JSON válido limitado a 12.000 caracteres por resultado e 24.000 caracteres no conjunto da pergunta, com até vinte itens por lista. Se necessário, a amostra é reduzida ainda mais. Totais calculados pelas ferramentas não são recalculados sobre a amostra.
- Resultados reduzidos incluem `contextLimits.truncated` e os campos omitidos. A assistente deve declarar a limitação, não interpretar itens omitidos como ausentes e solicitar consultas menores quando necessário.
- No máximo quatro etapas de ferramentas por pergunta; a última continuação exige resposta textual. Consultas repetidas com os mesmos argumentos são reaproveitadas dentro da pergunta.
- A responsabilidade sobre os clientes do histórico é revalidada antes de reutilizar contexto. Snapshots internos de aprendizado não são enviados ao modelo.

## Avisos e diagnóstico

Erros de processamento temporário (`rate_limit_exceeded`, `rate_limit_error`, `slow_down`) são separados de falta de créditos (`credit_balance_exhausted`), limite de gastos do projeto/organização e limite de uso aprovado. `insufficient_quota` orienta verificar saldo e gastos; um código desconhecido não é apresentado como limite temporário confirmado.

Não há reenvio automático em caso de bloqueio. `Retry-After` numérico ou em formato de data é respeitado no aviso, inclusive quando maior que uma hora. Se um upload encontra bloqueio, não são feitos os uploads seguintes nem uma chamada de resposta com anexos incompletos.

As mensagens guardam em metadata:

- `openAiUsage`: modelo, quantidade de requisições, tokens informados pela API (entrada, saída, total e entrada em cache) e IDs de requisição. Em erro de continuação, conserva o consumo das respostas já recebidas; não estima consumo da chamada rejeitada.
- `openAiError`: status, tipo de bloqueio, código, tipo técnico, request ID e espera indicada pela API. Também é registrado nos logs do servidor.
- Não são registrados chaves, prompts ou mensagens brutas do provedor no diagnóstico. Os textos normais da conversa continuam no armazenamento já existente.

O botão **Aprender categorias** continua independente da OpenAI. Estas mudanças não aumentam limites da conta, não repõem créditos e não alteram o modelo configurado.

Referências: [erros da API](https://developers.openai.com/api/docs/guides/error-codes), [histórico de conversas](https://developers.openai.com/api/docs/guides/conversation-state), [limites de processamento](https://developers.openai.com/api/docs/guides/rate-limits).

## Validação local

Foram testados contexto limitado, preservação de totais, reaproveitamento de consultas, orçamento agregado das saídas, distinção dos bloqueios, consumo parcial, diagnóstico sem dados sensíveis, interrupção de uploads bloqueados e revalidação de acesso ao histórico. Os testes usam respostas simuladas: não consomem API nem consultam dados reais de clientes.

Em 16/09/2026, a suíte completa teve 243 testes aprovados e uma falha preexistente em `src/modules/brasilmed/parser.test.ts`. Os arquivos alterados passaram no ESLint. A checagem de tipos geral também possui erros preexistentes no mesmo teste BrasilMed; nenhuma alteração foi feita nesse módulo.

A causa do bloqueio de uma conta real só pode ser confirmada pelo diagnóstico de uma nova tentativa após a publicação ou pelos logs originais do provedor. Não é possível assegurar que esta redução elimine bloqueios por saldo ou gastos.
