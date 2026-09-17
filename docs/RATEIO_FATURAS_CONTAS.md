# Rateio de faturas por cadastro/CNPJ e conta financeira

Em Faturas, “Usar rateio por cadastro e conta” pode ser ativado antes ou depois de importar o arquivo. A tabela passa a exibir “Cadastro de destino” e “Conta de destino” ao lado da categoria. Uma fatura pode conter despesas de dois ou mais CNPJs ou usar várias contas de um mesmo CNPJ. Cada lançamento mantém seu valor; a opção não divide uma compra entre várias unidades nem aprende destinos automaticamente para o próximo mês.

Cada unidade precisa ter seu próprio cadastro ativo no Fortuno e um vínculo com a empresa correta no Conta Azul. O destino inicial é o cliente escolhido na importação. Ao trocar o cadastro em uma linha, a conta anterior é limpa; somente as contas ativas daquele destino podem ser selecionadas. O seletor mostra nome e CNPJ para diferenciar as unidades.

Para preencher contas em lote, escolha o cadastro e a conta em “Conta para os itens pendentes deste cadastro” e use “Preencher pendentes deste cadastro”: somente as linhas desse cadastro sem conta serão preenchidas, sem trocar destinos ou sobrescrever escolhas. Descrições iguais não obrigam destinos iguais. Atualizar o catálogo não substitui seleções indisponíveis silenciosamente.

O envio só é liberado quando todas as linhas têm conta ativa válida, além das validações existentes de totais, categorias, centros de custo e revisão. No modal de envio, confira o resumo por cadastro e conta, com despesas e créditos separados. Não é necessário escolher uma conta global nesse modo. Categorias e centros de custo são conferidos no catálogo de cada destino. Se os nomes da origem não existirem em uma unidade, selecione equivalentes dessa unidade no modal, independentemente das escolhas para as demais.

No Conta Azul, cada evento e sua parcela usam a integração e a conta escolhidas na linha. Contatos técnicos, categorias e centros de custo também pertencem à empresa de destino: identificadores não são compartilhados entre unidades. Ao marcar como liquidado, a baixa utiliza o mesmo cadastro e conta, com a data de pagamento informada. Créditos/estornos seguem a mesma regra. Nenhuma conta, categoria, fornecedor real ou centro de custo novo é criado por esta opção; o vínculo técnico automático já existente permanece.

## Retomada e compatibilidade

Todos os cadastros são verificados pelo servidor na organização do usuário, e precisam estar ativos e conectados. Contas e classificações são conferidas no catálogo de cada destino antes de preparar contatos ou criar lançamentos. O cadastro, nome e conta de destino são persistidos nos metadados de cada linha. O lote lógico permanece vinculado ao cliente de origem para manter a identidade da importação, mas todas as chamadas externas daquela linha usam o cliente de destino.

Retomadas utilizam o destino persistido e rejeitam alterações de cadastro, conta ou opção de rateio em um lote já iniciado, com erro 409. Não se altera a identidade do arquivo/linha para criar outro envio. Protocolos, busca de parcelas e baixas são consultados na integração da unidade correspondente. Uma falha numa unidade preserva os itens concluídos das demais; reenviar com os mesmos destinos continua somente os pendentes ou com falha.

Sem a opção, o fluxo atual continua usando um cliente e uma conta única. Envios anteriores sem metadados de cadastro continuam utilizando o cliente de origem; rateios antigos por conta continuam compatíveis. Adquirentes não recebem a nova opção. Não há migração de banco ou variável de ambiente nova.

Durante o envio, a sessão permanece ativa e ações conflitantes da fatura (novo arquivo, edição, exclusão, aprendizado e destinos) ficam desabilitadas; o restante da plataforma continua disponível.

A planilha única permanece no modelo atual, sem inventar coluna de conta financeira. Enquanto o rateio estiver ativo, sua exportação fica desabilitada com orientação para usar o envio direto ou desativar a opção. O histórico do envio direto registra a opção e os destinos de cada lançamento.
