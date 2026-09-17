# Rateio de faturas por conta financeira

Em Faturas, “Usar rateio por conta financeira” pode ser ativado antes ou depois de importar o arquivo. A tabela passa a exibir “Conta de destino” ao lado da categoria. Cada lançamento mantém seu valor, categoria e centro de custo; a opção não divide uma compra entre várias contas nem aprende destinos automaticamente para o próximo mês.

As contas são consultadas no Conta Azul do cliente escolhido. Se houver muitos itens, selecione uma conta em “Conta para preencher os itens sem destino” e use “Preencher pendentes”: somente os itens sem conta serão preenchidos. Depois ajuste os destinos de cada linha. Descrições iguais não obrigam destinos iguais. Atualizar o catálogo não substitui seleções indisponíveis silenciosamente.

O envio só é liberado quando todas as linhas têm conta ativa válida, além das validações existentes de totais, categorias, centros de custo e revisão. No modal de envio, confira o resumo por conta, com despesas e créditos separados. Não é necessário escolher uma conta global nesse modo.

No Conta Azul, cada evento e sua parcela usam a conta escolhida na linha. Ao marcar como liquidado, a baixa utiliza o mesmo destino e a data de pagamento informada. Créditos/estornos seguem a mesma regra. Nenhuma conta, categoria, fornecedor real ou centro de custo novo é criado por esta opção; o vínculo técnico automático já existente permanece.

## Retomada e compatibilidade

As contas são verificadas pelo servidor no catálogo atual do cliente antes de preparar o envio. O destino é persistido nos metadados de cada linha. Retomadas utilizam esse registro e rejeitam alterações de contas ou da opção de rateio em um lote já iniciado, com erro 409, sem mudar a identidade do arquivo/linha para criar outro envio. A busca de parcelas também fica restrita à conta da linha.

Sem a opção, o fluxo atual continua usando uma conta única. Envios anteriores sem metadados de rateio continuam utilizando a conta do lote. Adquirentes não recebem a nova opção. Não há migração de banco ou variável de ambiente nova.

Durante o envio, a sessão permanece ativa e ações conflitantes da fatura (novo arquivo, edição, exclusão, aprendizado e destinos) ficam desabilitadas; o restante da plataforma continua disponível.

A planilha única permanece no modelo atual, sem inventar coluna de conta financeira. Enquanto o rateio estiver ativo, sua exportação fica desabilitada com orientação para usar o envio direto ou desativar a opção. O histórico do envio direto registra a opção e os destinos de cada lançamento.
