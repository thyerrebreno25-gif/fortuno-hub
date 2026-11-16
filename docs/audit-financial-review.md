# Auditoria financeira — regras e encerramento

A análise automática é uma revisão assistida. Nenhuma regra altera lançamentos no Conta Azul. O gestor confirma as evidências antes de encaminhar ajustes.

## Comparação

- Padrão: fechamento do mês anterior; três meses anteriores completos como histórico (configurável entre 3 e 12), inclusive cruzando a virada do ano.
- Datas futuras não são aceitas. Recorrências de mês em andamento só são cobradas até o dia atual. Variações de valor são comparadas em meses completos.
- Serviços mensais identificados por descrição/fornecedor: competência do mês anterior ao pagamento. Quando a baixa não está disponível, o vencimento é usado e essa limitação aparece na evidência.
- Compra ou pagamento avulso: competência no dia exato do pagamento. Uma forma PIX não transforma aluguel/serviço mensal em compra avulsa. Data de baixa desconhecida ou pagamentos em vários dias exigem conferência manual.
- Categorias são comparadas independentemente de existir um padrão de competência. Uma nova categoria não altera a identidade do pagamento usada na comparação.
- Obrigação presente nos dois últimos meses do histórico e ausente no intervalo esperado gera possível pagamento faltante. Impostos com identificação IRPJ, CSLL, COFINS, PIS e IRRF são separados.
- Variação padrão: pelo menos 25% e R$ 100 de diferença entre totais mensais da mesma obrigação; percentual configurável. Reajustes legítimos podem ser justificados pelo gestor.
- Vencidos representam a situação atual dos títulos cujo vencimento está no período ou no histórico consultado; não são uma reconstrução de sua situação passada.

## Saldos

Saldo zero aplica-se somente a contas transitórias: meios de recebimento, adquirentes e contas reconhecidas por tipo/nome. Contas correntes, investimentos, aplicações, poupança e caixa ficam fora dessa regra. Contas de tipo desconhecido sem identificação de adquirente não são presumidas transitórias.

A API pública fornece saldo atual. O fechamento passado é reconstituído desfazendo baixas, transferências e saldos iniciais posteriores. São exigidas páginas completas e saldo atual estável; falhas, volume excessivo, prazo excedido e fechamento do dia em andamento geram ponto de conferência manual, nunca saldo zero. Para encontrar parcelas pagas depois do fechamento a consulta combina pagamento e alteração, respeitando os limites de datas da API. Períodos antigos além desse limite não são certificados automaticamente.

As chamadas de um cliente são sequenciais para respeitar refresh token rotativo, com orçamento de execução e limites de paginação. A consulta de datas de baixa é limitada a 60 parcelas/45 segundos; o restante mantém a evidência de indisponibilidade.

Relatórios PDF exigem pelo menos três meses consecutivos de lançamentos. Este modo complementar conserva suas regras próprias de extrato/DRE; não certifica saldos individuais ou datas de baixa inexistentes no PDF.

## Fluxo e relatório

1. Gestor inicia ou retoma a auditoria em Check das auditorias → Abrir checklist / finalizar.
2. Revisa checklist e encaminha apontamentos aos operadores.
3. Operador registra correção e devolve para validação.
4. Gestor valida ou devolve ajustes; pontos descartados precisam de justificativa.
5. Finalizar auditoria exige todos os apontamentos validados/descartados e checklist obrigatório revisado. Uma não conformidade precisa de correção vinculada encerrada.
6. O fechamento grava um retrato dos dados no servidor: cliente, período, critérios, limitações, correções, responsáveis, interações e observações. Edições posteriores desses itens ficam bloqueadas; a exclusão integral segue a permissão administrativa já existente.
7. Ver relatório / PDF apresenta o relatório preservado e permite baixar o PDF com seções por resultado e responsável.

Auditorias encerradas antes desta funcionalidade não possuem retrato final retroativo. Gestores acessam apenas auditorias sob sua responsabilidade; administradores/master podem acessar as da organização. Operadores não têm acesso ao relatório gerencial.
