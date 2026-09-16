# Aprendizado de categorias pelo histórico do Conta Azul

## Uso

1. Na Assistente, selecione um cliente conectado ao Conta Azul.
2. Clique em **Aprender categorias** e escolha a conta/cartão onde as compras foram lançadas individualmente.
3. Informe o período de **vencimento** dos lançamentos. O padrão é o mês anterior; o máximo por consulta é de 93 dias.
4. Clique em **Consultar histórico**. Se o histórico tiver mais de um lote, clique em **Concluir consulta** no cartão gerado na conversa. O progresso é atualizado até terminar.
5. Revise as descrições e categorias. Regras sem conflito ficam selecionadas; conflitos exigem seleção e escolha explícita da categoria. Regras existentes ficam protegidas.
6. Clique em **Confirmar aprendizado**. Abra novamente Faturas e importe a próxima fatura do cliente para aplicar as regras.

Também é possível pedir no chat: “Aprenda as categorias dos lançamentos do cartão Bradesco deste cliente do mês passado”. A assistente localizará a conta pelo catálogo e gerará o mesmo cartão de prévia. A confirmação do salvamento ocorre pelo botão do cartão, não por uma decisão do modelo.

## Garantias e limites

- O histórico é consultado somente com GET. Nenhum lançamento é criado, editado ou liquidado no Conta Azul.
- O botão não depende da OpenAI nem consome chamadas à inteligência. O pedido pelo chat usa a OpenAI apenas para conduzir a solicitação e recebe um resumo pequeno da consulta.
- O acesso é limitado à organização, ao usuário proprietário da conversa e aos clientes sob sua responsabilidade. Exige edição da Assistente e do cadastro de clientes, como o salvamento de regras de faturas.
- As regras são gravadas em `CategoryRule`, módulo `CREDIT_CARD_INVOICE`, exclusivamente para o cliente da prévia. Nenhuma migração de banco é necessária.
- Valores, datas e parcelas são normalizados pelo mesmo mecanismo usado pelo leitor de faturas. Descrições semelhantes com categorias diferentes são sinalizadas; não podem ser aprendidas simultaneamente de forma ambígua.
- Categorias e centros de custo são identificados pelos IDs do catálogo atual do cliente. Centros inconsistentes não são aprendidos. Categorias renomeadas/indisponíveis exigem nova prévia.
- Regras existentes, inclusive criadas após a prévia, nunca são atualizadas pelo aprendizado histórico. Confirmações repetidas e simultâneas são protegidas por versão e unicidade.
- Faturas consolidadas, pagamentos da fatura, saldo anterior, cancelados e parcelas sem categorias suficientes não produzem uma classificação automática de cada compra.
- Cada etapa consulta até 10 parcelas e salva o progresso. Uma etapa com falha não avança o cursor e pode ser repetida. Uma página repetida pela API interrompe a consulta.
- Uma prévia não confirmada expira em 24 horas. Consultas que atinjam 5.000 parcelas sem concluir são sinalizadas e não podem ser salvas; reduza o período.

## Verificação

Os testes cobrem extração dos IDs reais, agrupamento de OpenAI com valores variáveis, conflitos/rateio, preservação de regras, conta incorreta, retomada sem duplicação, permissão, organização/proprietário da conversa, expiração, confirmação repetida/concorrente e tratamento do limite da OpenAI sem repetição imediata.

O teste integrado com dados reais deve confirmar, em um cliente autorizado, que as regras selecionadas categorizam uma nova fatura e que os lançamentos originais no Conta Azul permanecem inalterados.
