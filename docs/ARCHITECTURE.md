# Arquitetura ConvertNow

Cada domínio possui sua própria rota, componentes, serviços, parsers, exportadores e testes. Parsers são registrados e versionados; nenhuma regra de banco deve ser colocada em outro módulo.

## Regra de isolamento

Uma alteração em `modules/brasilmed` não pode importar código de `modules/bank-statements`, `modules/invoices` ou `modules/acquirers`. Compartilhamento é permitido apenas em `modules/shared`.

## Evolução dos parsers

Cada novo layout recebe:

- identificador único;
- instituição;
- tipo;
- versão;
- fingerprints;
- arquivo real de fixture;
- total esperado;
- teste de regressão.
