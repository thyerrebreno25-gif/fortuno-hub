# Revisão automática local de mensagens

A revisão do WhatsApp é executada no navegador após 300 ms sem digitar, tanto em respostas quanto em comentários internos. Não chama APIs do Hub nem da OpenAI; funciona sem chave, saldo ou conexão com o provedor de IA. O endpoint antigo retorna 410 e não lê o rascunho, evitando chamadas externas de abas ainda na versão anterior.

As regras sugerem acentos e correções de erros comuns, abreviações, espaços, pontuação e alguns casos específicos de concordância. Sugestões de reformulação são limitadas a saudações e pedidos de cortesia. Não é um modelo de linguagem nem um verificador gramatical completo. O corretor ortográfico nativo continua disponível conforme as configurações do navegador.

Valores, datas, documentos, links, e-mails, menções, identificadores alfanuméricos, chaves de pagamento rotuladas e blocos de código são protegidos antes das regras. Palavras capitalizadas podem ser nomes e não recebem correção ampla de dicionário. O original é mantido e o operador aplica a sugestão antes de enviar; nada é enviado ou salvo automaticamente. Textos acima de 5.000 caracteres e expansões além desse limite não são propostos.

O menu da revisão permite desativar/ativar; somente essa preferência fica no localStorage (fortuno:whatsapp:local-review), nunca o rascunho. Resultados são exibidos apenas se ainda correspondem ao texto atual. Permissões e assunção do chamado continuam sendo aplicadas pelo compositor e pelo envio existente.
